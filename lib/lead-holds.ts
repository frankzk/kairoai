// Reserva de un lead mientras una asesora lo tiene abierto.
//
// Pedido de la dueña: "cuando una asesora tiene abierto el Lead, otra asesora
// no lo pueda abrir, y avise con un popup quién tiene retenido el lead. Máximo
// 10 minutos puede tener retenido el lead; pasados esos minutos, se suelta."
//
// Módulo PURO (sin base, sin Node, sin navegador): reglas, textos y formato.
// Lo usan la ruta /api/leads/[leadId]/hold, las rutas que escriben un lead
// (lib/lead-holds-server.ts), el tablero y los tests (tests/lead-holds.test.ts).
//
// Las reglas de decideAcquire son las mismas que aplica en una sentencia la
// función lead_hold_acquire de la migración 20261128120000_lead_holds.sql:
//   - Sin reserva o reserva vencida: la toma quien abre, por LEAD_HOLD_MINUTES.
//   - Reserva vigente de la misma persona: se mantiene, NO se alarga.
//   - Reserva vigente de otra persona: bloquea; supervisión puede quitársela.

/** Lo máximo que una persona retiene un lead. Único lugar donde vive el número. */
export const LEAD_HOLD_MINUTES = 10;
export const LEAD_HOLD_MS = LEAD_HOLD_MINUTES * 60_000;
export const LEAD_HOLD_TTL_SECONDS = LEAD_HOLD_MINUTES * 60;

/** Fila de lead_holds tal como la devuelve la base. */
export interface LeadHold {
  lead_id: number;
  holder_user_id: number;
  holder_name: string;
  acquired_at: string;
  expires_at: string;
}

export type AcquireDecision =
  | { kind: "acquired"; hold: LeadHold }
  | { kind: "kept"; hold: LeadHold }
  | { kind: "taken_over"; hold: LeadHold; previous: LeadHold }
  | { kind: "blocked"; hold: LeadHold };

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/** Vigente: vence después de `now`. Una fecha inválida cuenta como vencida. */
export function holdActive(hold: Pick<LeadHold, "expires_at"> | null | undefined, now: number): boolean {
  if (!hold) return false;
  const t = ms(hold.expires_at);
  return Number.isFinite(t) && t > now;
}

/** Modelo de lead_hold_acquire (la base decide; esto documenta y se prueba). */
export function decideAcquire(
  existing: LeadHold | null,
  me: { id: number; name: string },
  leadId: number,
  now: number,
  takeover: boolean
): AcquireDecision {
  const fresh = (): LeadHold => ({
    lead_id: leadId,
    holder_user_id: me.id,
    holder_name: me.name,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + LEAD_HOLD_MS).toISOString(),
  });
  if (!existing || !holdActive(existing, now)) return { kind: "acquired", hold: fresh() };
  if (existing.holder_user_id === me.id) return { kind: "kept", hold: existing };
  if (takeover) return { kind: "taken_over", hold: fresh(), previous: existing };
  return { kind: "blocked", hold: existing };
}

/**
 * La reserva que impide escribir a `userId`, o null. Sin fila, vencida o
 * propia: se puede escribir (si la reserva falló o venció y nadie la tomó, la
 * asesora sigue trabajando como siempre).
 */
export function blockingHold(hold: LeadHold | null, userId: number, now: number): LeadHold | null {
  if (!hold || !holdActive(hold, now)) return null;
  return hold.holder_user_id === userId ? null : hold;
}

/** Puede abrir de todos modos (y quitar la reserva): supervisión de Leads. */
export function canTakeOverHold(permisos: readonly string[]): boolean {
  return permisos.includes("leads_equipo");
}

// ─── Textos ──────────────────────────────────────────────────────────────────

/** HH:MM (24 h) en la zona horaria de la tienda. */
export function formatHoldTime(iso: string, timeZone: string): string {
  const t = ms(iso);
  if (!Number.isFinite(t)) return "--:--";
  try {
    return new Intl.DateTimeFormat("es-CR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(t));
  } catch {
    return "--:--";
  }
}

/** Minutos que faltan, redondeados hacia arriba; 0 si ya venció. */
export function minutesLeft(expiresIso: string, now: number): number {
  const t = ms(expiresIso);
  if (!Number.isFinite(t) || t <= now) return 0;
  return Math.ceil((t - now) / 60_000);
}

/** Primer nombre para la etiqueta de la tarjeta ("Ana" de "Ana Pérez"). */
export function holderFirstName(name: string): string {
  const first = String(name ?? "").trim().split(/\s+/)[0];
  return first || "Otra persona";
}

function nombre(hold: Pick<LeadHold, "holder_name">): string {
  return String(hold.holder_name ?? "").trim() || "Otra persona";
}

/** Partes del aviso de lead ocupado (el modal pone el nombre en negrita). */
export function blockedNoticeParts(hold: LeadHold, now: number, timeZone: string) {
  const mins = minutesLeft(hold.expires_at, now);
  return {
    holder: nombre(hold),
    since: formatHoldTime(hold.acquired_at, timeZone),
    until: formatHoldTime(hold.expires_at, timeZone),
    minutes: mins,
    /** "(en 3 min)" o "(en menos de 1 min)"; vacío si ya venció. */
    inText: mins <= 0 ? "" : `(en ${mins} min)`,
  };
}

/** "Este lead lo tiene abierto Ana desde las 14:05. Se libera a las 14:15 (en 7 min)." */
export function blockedNoticeText(hold: LeadHold, now: number, timeZone: string): string {
  const p = blockedNoticeParts(hold, now, timeZone);
  return (
    `Este lead lo tiene abierto ${p.holder} desde las ${p.since}. ` +
    `Se libera a las ${p.until}${p.inText ? ` ${p.inText}` : ""}.`
  );
}

/** Mensaje del 409 cuando otra persona tiene el lead abierto. */
export function writeConflictText(hold: LeadHold, now: number, timeZone: string): string {
  return `${blockedNoticeText(hold, now, timeZone)} No se guardó tu cambio.`;
}

/** Indicador discreto dentro de la ficha. */
export function heldByMeText(hold: Pick<LeadHold, "expires_at">, timeZone: string): string {
  return `Lo tienes reservado hasta las ${formatHoldTime(hold.expires_at, timeZone)}`;
}

export const HOLD_EXPIRED_TEXT = "Tu reserva terminó: otra asesora ya puede abrir este lead";

/** Otra persona abrió el lead después de que venció (o se lo quitó supervisión). */
export function holdLostText(hold: LeadHold, timeZone: string): string {
  return (
    `${nombre(hold)} abrió este lead a las ${formatHoldTime(hold.acquired_at, timeZone)}: ` +
    "tus cambios ya no se guardan. Cierra la ficha."
  );
}

// ─── Respuestas de la API (el navegador no confía en la forma) ──────────────

export function parseLeadHold(value: unknown): LeadHold | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const leadId = Number(v.lead_id);
  const holder = Number(v.holder_user_id);
  if (!Number.isSafeInteger(leadId) || leadId <= 0 || !Number.isSafeInteger(holder) || holder < 0) return null;
  if (typeof v.acquired_at !== "string" || typeof v.expires_at !== "string") return null;
  if (!Number.isFinite(Date.parse(v.acquired_at)) || !Number.isFinite(Date.parse(v.expires_at))) return null;
  return {
    lead_id: leadId,
    holder_user_id: holder,
    holder_name: typeof v.holder_name === "string" ? v.holder_name : "",
    acquired_at: v.acquired_at,
    expires_at: v.expires_at,
  };
}

/** Lo que el tablero sabe de las reservas de otras personas (badge). */
export interface BoardHold {
  lead_id: number;
  holder_name: string;
  expires_at: string;
}
