// Reglas de la auditoria de despacho: encuentra paquetes cuyo estado real en el
// courier no coincide con lo que muestra el CRM, y paquetes que llevan
// demasiado tiempo detenidos en un mismo punto.
//
// El caso que la origino: iComfly deja de recibir eventos cuando el paquete
// pasa al distribuidor de ultima milla (RC-0 "Entregado a Distribuidor"), asi
// que se queda congelado en "En_Reparto"/"Novedad" aunque el paquete ya se haya
// entregado o devuelto. Nadie lo veia porque en el CRM esos paquetes se ven
// igual que uno sano.
//
// Modulo PURO (sin BD ni red) para poder testear los umbrales.

import { isWynIncidentCode } from "./wyn";

export type AuditKind = "desfase" | "estancado";
export type AuditSeverity = "alta" | "media";

/**
 * Estados del CRM que significan "el paquete sigue circulando". Si el courier
 * ya cerro el paquete y el CRM muestra uno de estos, hay desfase.
 */
export const CRM_EN_CIRCULACION = new Set([
  "En_Reparto",
  "Novedad",
  "Confirmada",
  "Enviada",
  "Pendiente",
]);

/** Estados del courier que ya no cambian: el paquete termino su viaje. */
export const COURIER_TERMINAL = new Set(["delivered", "returned", "not_delivered"]);

export interface AuditInput {
  guide_number: string;
  order_name: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  /** Estado normalizado segun el courier (delivered/returned/en_route/...). */
  courier_status: string;
  /** Codigo del ultimo evento del courier (OC-1, RC-0, LM-7, PF-1...). */
  courier_code: string;
  /** Descripcion del ultimo evento, para mostrar. */
  courier_event: string;
  /** Fecha del ultimo evento del courier (ISO). */
  latest_at: string | null;
  crm_status: string;
  /** Cuando se leyo por ultima vez el CRM: el desfase se juzga contra esta foto. */
  crm_synced_at: string | null;
}

export interface AuditFinding extends AuditInput {
  kind: AuditKind;
  severity: AuditSeverity;
  /** Que esta pasando. */
  reason: string;
  /** Que hay que hacer. */
  action: string;
  /** Dias desde el ultimo movimiento del courier. */
  days_stuck: number;
}

const DAY_MS = 86_400_000;

export function daysSince(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/**
 * Umbrales de "detenido demasiado tiempo", por etapa. Salen de como se ve un
 * envio sano: del traspaso al distribuidor a la entrega pasan ~4 dias, y una
 * etiqueta impresa entra a bodega el mismo dia o al siguiente.
 */
export interface StallRule {
  id: string;
  matches: (code: string) => boolean;
  days: number;
  severity: AuditSeverity;
  reason: string;
  action: string;
}

export const STALL_RULES: StallRule[] = [
  {
    id: "nunca_despachado",
    // OC-1: la etiqueta se genero pero el paquete nunca entro a la red.
    matches: (code) => code === "OC-1",
    days: 3,
    severity: "alta",
    reason: "Etiqueta impresa, pero el paquete nunca entro a la red del courier.",
    action: "Buscarlo en bodega: no esta demorado, no se despacho.",
  },
  {
    id: "perdido_ultima_milla",
    // RC-0: quedo en manos del distribuidor y dejo de reportar.
    matches: (code) => code === "RC-0",
    days: 10,
    severity: "alta",
    reason: "En el distribuidor de ultima milla sin un solo evento nuevo.",
    action: "Reclamo formal al courier: un envio normal se entrega en ~4 dias desde aca.",
  },
  {
    id: "incidencia_sin_resolver",
    matches: (code) => isWynIncidentCode(code),
    days: 7,
    severity: "alta",
    reason: "Incidencia de entrega sin resolver.",
    action: "Contactar al cliente hoy: en este punto el paquete termina devuelto.",
  },
  {
    id: "sin_movimiento",
    matches: () => true,
    days: 14,
    severity: "media",
    reason: "Sin movimiento en el courier.",
    action: "Consultar al courier por el estado del envio.",
  },
];

function stallRuleFor(code: string): StallRule {
  return STALL_RULES.find((rule) => rule.matches(code)) ?? STALL_RULES[STALL_RULES.length - 1];
}

/** Texto del desfase segun lo que el courier ya cerro. */
function desfaseTexts(courierStatus: string): { reason: string; action: string; severity: AuditSeverity } {
  if (courierStatus === "delivered") {
    return {
      severity: "media",
      reason: "El courier ya lo entrego, pero el CRM lo muestra en circulacion.",
      action: "Marcarlo como entregado en el CRM; no requiere gestion.",
    };
  }
  return {
    severity: "alta",
    reason: "El courier ya lo devolvio, pero el CRM lo muestra en circulacion.",
    action: "Marcarlo como devuelto en el CRM: cuenta como venta en curso y no lo es.",
  };
}

/**
 * Clasifica una fila. Devuelve null si no hay nada que reportar.
 * Un paquete cerrado por el courier se evalua solo por desfase: ya no tiene
 * sentido medirle tiempo detenido.
 */
export function auditRow(row: AuditInput, now: number = Date.now()): AuditFinding | null {
  const days = daysSince(row.latest_at, now);

  if (COURIER_TERMINAL.has(row.courier_status)) {
    if (!CRM_EN_CIRCULACION.has(row.crm_status)) return null;
    const { reason, action, severity } = desfaseTexts(row.courier_status);
    return { ...row, kind: "desfase", severity, reason, action, days_stuck: days };
  }

  const rule = stallRuleFor(String(row.courier_code ?? "").trim().toUpperCase());
  if (days < rule.days) return null;
  return {
    ...row,
    kind: "estancado",
    severity: rule.severity,
    reason: rule.reason,
    action: rule.action,
    days_stuck: days,
  };
}

export interface AuditSummary {
  desfase_entregado: number;
  desfase_devuelto: number;
  /** Monto que el CRM cuenta como venta en curso y en realidad ya se devolvio. */
  monto_devuelto_mal_contado: number;
  estancados: number;
  total: number;
}

export function auditRows(rows: AuditInput[], now: number = Date.now()): {
  findings: AuditFinding[];
  summary: AuditSummary;
} {
  const findings = rows
    .map((row) => auditRow(row, now))
    .filter((f): f is AuditFinding => f !== null)
    // Lo mas grave primero; dentro de cada grupo, lo mas viejo primero.
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "alta" ? -1 : 1;
      return b.days_stuck - a.days_stuck;
    });

  const isDevuelto = (f: AuditFinding) =>
    f.kind === "desfase" && f.courier_status !== "delivered";

  return {
    findings,
    summary: {
      desfase_entregado: findings.filter(
        (f) => f.kind === "desfase" && f.courier_status === "delivered"
      ).length,
      desfase_devuelto: findings.filter(isDevuelto).length,
      monto_devuelto_mal_contado: Math.round(
        findings.filter(isDevuelto).reduce((sum, f) => sum + (Number(f.amount) || 0), 0)
      ),
      estancados: findings.filter((f) => f.kind === "estancado").length,
      total: findings.length,
    },
  };
}
