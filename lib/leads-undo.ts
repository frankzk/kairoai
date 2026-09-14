// Las reglas de "deshacer la ultima gestion", sin base de datos.
//
// Aqui vive lo que decide SI se puede deshacer y QUE se restaura. La capa de
// datos (lib/leads.ts) solo lee las dos filas que estas funciones necesitan,
// aplica lo que devuelven y escribe la fila de auditoria. Separado asi porque
// esta es la parte que no se puede probar contra produccion: un Deshacer que
// revierte la gestion equivocada es un segundo error, y silencioso.

import type { LeadCategory, StatusSource } from "@/lib/leads-types";

/**
 * Los campos del lead que una gestion sobreescribe. Es exactamente lo que hay
 * que guardar para poder deshacerla: ni uno mas —no es una copia del lead— ni
 * uno menos.
 *
 * Si `applyDisposition` alguna vez toca un campo nuevo, tiene que entrar aqui:
 * de lo contrario Deshacer dejaria el lead a medio revertir, que es peor que
 * no tener Deshacer.
 */
export const CAMPOS_DE_GESTION = [
  "status",
  "category",
  "status_source",
  "auto_reason",
  "needs_attention",
  "closed_by",
  "next_followup_at",
] as const;

export interface GestionSnapshot {
  status: string;
  category: LeadCategory;
  status_source: StatusSource;
  auto_reason: string | null;
  needs_attention: boolean;
  closed_by: number | null;
  next_followup_at: string | null;
}

/**
 * Los tipos de fila del historial que MUEVEN el estado del lead.
 *
 * `note` (un WhatsApp enviado desde la ficha) y `phone` no estan: no tocan
 * ninguno de los CAMPOS_DE_GESTION, asi que escribir un mensaje justo despues
 * de gestionar no tiene por que bloquear el Deshacer.
 */
export const KINDS_QUE_MUEVEN_EL_ESTADO = ["state_change", "system", "sale", "undo"];

/** Cuanto tiempo despues de gestionar se acepta un Deshacer. */
export const VENTANA_DESHACER_MS = 10 * 60_000;

/** La fila del historial que se quiere deshacer, como vuelve de la base. */
export interface FilaDeHistorial {
  id: number;
  kind: string;
  prev_state: unknown;
  new_status: string | null;
  occurred_at: string;
}

export type DecisionDeshacer =
  | { ok: true; previo: GestionSnapshot }
  | { ok: false; reason: string };

/**
 * Valida la instantanea que vuelve de la base.
 *
 * Es JSONB: el tipo que declara TypeScript no prueba NADA sobre lo que hay
 * guardado de verdad. Si falta un campo se devuelve null y no se deshace,
 * porque restaurar campos a medias deja el lead peor que antes de deshacer.
 */
export function parseGestionSnapshot(value: unknown): GestionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  for (const campo of CAMPOS_DE_GESTION) {
    if (!(campo in obj)) return null;
  }
  if (typeof obj.status !== "string" || typeof obj.category !== "string") return null;
  if (typeof obj.status_source !== "string") return null;
  if (typeof obj.needs_attention !== "boolean") return null;
  return {
    status: obj.status,
    category: obj.category as LeadCategory,
    status_source: obj.status_source as StatusSource,
    auto_reason: (obj.auto_reason ?? null) as string | null,
    needs_attention: obj.needs_attention,
    closed_by: (obj.closed_by ?? null) as number | null,
    next_followup_at: (obj.next_followup_at ?? null) as string | null,
  };
}

/**
 * Los tres candados de Deshacer, en orden.
 *
 *   1. La fila tiene que ser una gestion con instantanea. Las gestiones
 *      anteriores a la migracion 0036 no la tienen y no se pueden revertir.
 *   2. Tiene que ser la ULTIMA cosa que movio el estado de este lead. Si
 *      despues paso algo mas —el cruce con Shopify lo marco ganado, por
 *      ejemplo— revertir borraria ese cambio sin decirlo.
 *   3. Tiene que ser reciente. A los 10 minutos ya no es un clic equivocado.
 *
 * El orden importa para el mensaje: primero lo que es imposible, despues lo
 * que cambio, y al final lo que solo caduco.
 */
export function decidirDeshacer(args: {
  fila: FilaDeHistorial | null;
  ultimoIdQueMovioElEstado: number | null;
  nowMs: number;
  ventanaMs?: number;
}): DecisionDeshacer {
  const { fila, ultimoIdQueMovioElEstado, nowMs } = args;
  const ventanaMs = args.ventanaMs ?? VENTANA_DESHACER_MS;

  if (!fila) return { ok: false, reason: "Esa gestión ya no existe." };

  const previo = parseGestionSnapshot(fila.prev_state);
  if (fila.kind !== "state_change" || !previo) {
    return { ok: false, reason: "Esa gestión no se puede deshacer." };
  }

  if (ultimoIdQueMovioElEstado !== fila.id) {
    return {
      ok: false,
      reason: "El lead cambió después de esa gestión: revisá el historial antes de deshacer.",
    };
  }

  const ocurrio = new Date(fila.occurred_at).getTime();
  if (!Number.isFinite(ocurrio) || nowMs - ocurrio > ventanaMs) {
    return { ok: false, reason: "Pasó demasiado tiempo para deshacer esta gestión." };
  }

  return { ok: true, previo };
}
