// Logica pura del Estado de Despacho. Sin acceso a DB ni a red: recibe pedidos
// de iComfly ya normalizados + el catalogo de planilla y produce el sub-estado
// de despacho, la atribucion por persona y la marca de standby.
//
// Reusada por la ruta de sync (servidor) y testeable de forma aislada.

import { normalizeMatchKey } from "./order-matching";
import { moovinTransitPhase } from "./moovin-status";
import type { MoovinTrackingRow, IcomflyOrderRecord } from "./finance-types";

// ─── Configuracion (pendiente de confirmar con iComfly) ──────────────────────
// Cual campo de `atribucion` representa la "solicitud de despacho" de la asesora
// (genera la guia de transporte). PENDIENTE de confirmar con iComfly si es
// `genero_guia` o `envio`. Se deja como constante para poder cambiarlo sin
// tocar el resto de la logica.
export const DISPATCH_REQUEST_FIELD: "genero_guia" | "envio" = "genero_guia";

// Hora de corte del turno de almacen (hora de Costa Rica, UTC-6 sin horario de
// verano). Un "despacho solicitado" sin guia final a esta hora cae en standby.
export const WAREHOUSE_CUTOFF_HOUR_CR = 15;

// Zona horaria de la operacion.
export const CR_TZ = "America/Costa_Rica";

// Estados/textos de iComfly (normalizados) que implican que la GUIA FINAL ya
// existe (almacen despacho). Tolerante: se compara por inclusion de subcadena.
const FINAL_GUIDE_STATUS_HINTS = [
  "guia_generada",
  "guiagenerada",
  "enviado",
  "en_ruta",
  "enruta",
  "entregado",
  "despachado",
  "shipped",
  "delivered",
];

// ─── Tipos normalizados de iComfly ───────────────────────────────────────────

export interface AttributionActor {
  userId: number | null;
  name: string;
  email: string;
  at: string | null;
}

export interface NormalizedIcomflyOrder {
  storeId: number;
  icomflyOrderId: string;
  orderNumber: string;
  shopifyDisplayNumber: string;
  status: string;
  carrierName: string;
  trackingNumber: string;
  shippedAt: string | null;
  createdAt: string | null;
  attribution: Partial<Record<"creo" | "confirmo" | "genero_guia" | "envio" | "cancelo", AttributionActor>>;
}

export type DispatchState = "pendiente" | "despacho_solicitado" | "despachado";

// Persona de la planilla para el match (subconjunto de payroll_staff).
export interface StaffLike {
  id: number;
  name: string;
  email?: string | null;
  icomfly_user_id?: number | null;
}

// Fila lista para upsert en icomfly_orders (sin synced_at).
export interface IcomflyOrderRow {
  store_id: number;
  icomfly_order_id: string;
  order_number: string;
  shopify_display_number: string;
  status: string;
  carrier_name: string;
  tracking_number: string;
  shipped_at: string | null;
  icomfly_created_at: string | null;
  dispatch_state: DispatchState;
  is_standby: boolean;
  confirmed_by_user_id: number | null;
  confirmed_by_name: string;
  confirmed_by_email: string;
  confirmed_at: string | null;
  confirmed_by_staff_id: number | null;
  requested_by_user_id: number | null;
  requested_by_name: string;
  requested_by_email: string;
  requested_at: string | null;
  requested_by_staff_id: number | null;
  guide_final_at: string | null;
  guide_final_source: "" | "icomfly" | "boxful";
  raw_attribution: Record<string, unknown>;
}

// ─── Normalizacion de nombres (match con planilla) ───────────────────────────

export function normalizePersonName(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// Resuelve el payroll_staff.id de una persona atribuida en iComfly. Prioridad:
// icomfly_user_id -> email -> nombre normalizado. Devuelve null si no hay match.
export function matchStaff(
  actor: Pick<AttributionActor, "userId" | "name" | "email"> | null | undefined,
  staff: StaffLike[]
): number | null {
  if (!actor) return null;
  if (actor.userId != null) {
    const byId = staff.find((s) => s.icomfly_user_id != null && Number(s.icomfly_user_id) === Number(actor.userId));
    if (byId) return byId.id;
  }
  const email = (actor.email || "").trim().toLowerCase();
  if (email) {
    const byEmail = staff.find((s) => (s.email || "").trim().toLowerCase() === email);
    if (byEmail) return byEmail.id;
  }
  const name = normalizePersonName(actor.name || "");
  if (name) {
    const byName = staff.find((s) => normalizePersonName(s.name) === name);
    if (byName) return byName.id;
  }
  return null;
}

// ─── Deteccion de guia final (almacen) ───────────────────────────────────────

export interface GuideFinalSignal {
  exists: boolean;
  at: string | null;
  source: "" | "icomfly" | "boxful";
}

function statusImpliesFinalGuide(status: string): boolean {
  const s = normalizeMatchKey(status).replace(/[^a-z0-9]/g, "_");
  return FINAL_GUIDE_STATUS_HINTS.some((hint) => s.includes(hint));
}

// boxfulDispatched: claves de pedido (normalizeMatchKey) que ya tienen guia en
// la data de Boxful que kairoai importa. Senal de validacion/respaldo.
export function detectGuideFinal(
  order: NormalizedIcomflyOrder,
  boxfulDispatched?: Set<string>
): GuideFinalSignal {
  // iComfly primario: tracking / shipped / estado.
  if (order.trackingNumber.trim() || order.shippedAt || statusImpliesFinalGuide(order.status)) {
    return { exists: true, at: order.shippedAt ?? null, source: "icomfly" };
  }
  // Boxful como respaldo: el pedido aparece con guia en la logistica importada.
  if (boxfulDispatched && boxfulDispatched.size) {
    for (const key of orderMatchKeys(order)) {
      if (boxfulDispatched.has(key)) return { exists: true, at: null, source: "boxful" };
    }
  }
  return { exists: false, at: null, source: "" };
}

function orderMatchKeys(order: NormalizedIcomflyOrder): string[] {
  return Array.from(
    new Set(
      [order.orderNumber, order.shopifyDisplayNumber]
        .map((v) => normalizeMatchKey(v || ""))
        .filter(Boolean)
    )
  );
}

// ─── Estado de despacho ──────────────────────────────────────────────────────

export function computeDispatchState(
  order: NormalizedIcomflyOrder,
  guideFinal: GuideFinalSignal
): DispatchState {
  if (guideFinal.exists) return "despachado";
  const requested = order.attribution[DISPATCH_REQUEST_FIELD];
  if (requested && (requested.name || requested.email || requested.userId != null)) {
    return "despacho_solicitado";
  }
  return "pendiente";
}

// ─── Fecha de trabajo (zona CR) ──────────────────────────────────────────────

// Devuelve { y, m, d, hour } de una fecha ISO en hora de Costa Rica.
function partsCR(iso: string | Date): { y: number; m: number; d: number; hour: number } {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  return {
    y: Number(map.year),
    m: Number(map.month),
    d: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
  };
}

// Fecha (YYYY-MM-DD, zona CR) en que se solicito el despacho; fallback a la
// creacion del pedido. Sirve para agrupar "el trabajo del dia".
export function requestDateCR(order: NormalizedIcomflyOrder): string | null {
  const requested = order.attribution[DISPATCH_REQUEST_FIELD];
  const ref = requested?.at ?? order.createdAt ?? null;
  if (!ref) return null;
  const p = partsCR(ref);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Standby: un "despacho solicitado" sin guia final cuyo dia de trabajo ya paso
// del corte de almacen (mismo dia >= 15:00 CR, o cualquier dia anterior).
export function isStandby(
  order: NormalizedIcomflyOrder,
  state: DispatchState,
  now: Date = new Date(),
  cutoffHour: number = WAREHOUSE_CUTOFF_HOUR_CR
): boolean {
  if (state !== "despacho_solicitado") return false;
  const reqDate = requestDateCR(order);
  if (!reqDate) return false;
  const nowP = partsCR(now);
  const today = `${nowP.y}-${String(nowP.m).padStart(2, "0")}-${String(nowP.d).padStart(2, "0")}`;
  if (reqDate < today) return true; // dia(s) anterior(es) sin cerrar
  if (reqDate === today) return nowP.hour >= cutoffHour; // hoy, pasado el corte
  return false; // solicitudes con fecha futura (no deberia pasar)
}

// ─── Ensamblado de la fila persistible ───────────────────────────────────────

export function buildIcomflyOrderRow(
  order: NormalizedIcomflyOrder,
  opts: { staff: StaffLike[]; boxfulDispatched?: Set<string>; now?: Date }
): IcomflyOrderRow {
  const now = opts.now ?? new Date();
  const guideFinal = detectGuideFinal(order, opts.boxfulDispatched);
  const state = computeDispatchState(order, guideFinal);
  const standby = isStandby(order, state, now);

  const confirmo = order.attribution.confirmo ?? null;
  const requested = order.attribution[DISPATCH_REQUEST_FIELD] ?? null;

  return {
    store_id: order.storeId,
    icomfly_order_id: order.icomflyOrderId,
    order_number: order.orderNumber,
    shopify_display_number: order.shopifyDisplayNumber,
    status: order.status,
    carrier_name: order.carrierName,
    tracking_number: order.trackingNumber,
    shipped_at: order.shippedAt,
    icomfly_created_at: order.createdAt,
    dispatch_state: state,
    is_standby: standby,
    confirmed_by_user_id: confirmo?.userId ?? null,
    confirmed_by_name: confirmo?.name ?? "",
    confirmed_by_email: confirmo?.email ?? "",
    confirmed_at: confirmo?.at ?? null,
    confirmed_by_staff_id: matchStaff(confirmo, opts.staff),
    requested_by_user_id: requested?.userId ?? null,
    requested_by_name: requested?.name ?? "",
    requested_by_email: requested?.email ?? "",
    requested_at: requested?.at ?? null,
    requested_by_staff_id: matchStaff(requested, opts.staff),
    guide_final_at: guideFinal.at,
    guide_final_source: guideFinal.source,
    raw_attribution: (order.attribution ?? {}) as Record<string, unknown>,
  };
}

// Etiquetas en espanol para el sub-estado de despacho.
export const DISPATCH_STATE_LABELS: Record<DispatchState, string> = {
  pendiente: "Pendiente",
  despacho_solicitado: "Despacho solicitado",
  despachado: "Despachado / Guia final",
};

// ─── Estado de DESPACHO por recoleccion fisica de Moovin (columna Pedidos) ────
// La columna "Despacho" no debe decir "Despachado" apenas iComfly genera la
// guia: hasta que Moovin no recoge del almacen, el pedido sigue "Solicitado"
// (substatus "Recoleccion Solicitada"). El estado fisico se lee de Moovin (que
// kairoai ya tiene en moovinByPackage).

// Titulos de Moovin que indican que el paquete TODAVIA esta en el almacen
// (recoleccion pedida pero no concretada).
const MOOVIN_PRE_PICKUP_TITLES = ["recolec", "por preparar", "registrad"];

// Replica de deriveMoovinGroup (lib/finance-orders) para no arrastrar ese modulo
// (usa alias @/ que vitest no resuelve). Logica identica.
function moovinGroup(row: MoovinTrackingRow): string {
  const code = String(row.latest_code ?? "").toUpperCase();
  const title = String(row.latest_status ?? "").toLowerCase();
  if (code.startsWith("CANCEL") || title.includes("cancelado")) return "returned";
  return row.latest_group ?? "";
}

// true  = el paquete ya salio del almacen (recogido / en transito / entregado / incidencia)
// false = recoleccion solicitada, sigue en el almacen
// undefined = no hay dato de Moovin (no se puede afirmar)
export function isMoovinPickedUp(row: MoovinTrackingRow | undefined): boolean | undefined {
  if (!row) return undefined;
  const group = moovinGroup(row);
  if (group === "delivered" || group === "failed" || group === "returned") return true;
  if (group === "in_progress") {
    const title = String(row.latest_status ?? "").toLowerCase();
    if (MOOVIN_PRE_PICKUP_TITLES.some((t) => title.includes(t))) return false;
    // "Sede de Moovin", "En ruta...", "Coordinado", etc. = ya recogido.
    return true;
  }
  return undefined;
}

// Los 3 primeros valores son las FASES DE TRANSITO derivadas del estado de
// Moovin (agrupan el "Estado de seguimiento"); "despachado"/"pendiente" son el
// fallback de iComfly cuando no hay dato de Moovin.
export type DispatchView =
  | "despacho_solicitado"
  | "recolectado"
  | "en_route"
  | "despachado"
  | "pendiente";

// Resuelve el estado de la columna "Despacho" / bucket de seguimiento. Señal
// primaria: la FASE DE TRANSITO segun el ultimo estado de Moovin
// (moovinTransitPhase). Si Moovin no da fase (estado final/incidencia o sin
// dato), cae a la recoleccion fisica y luego a la atribucion de iComfly. null si
// no hay ni pedido ni guia.
export function resolveDispatchState(
  rec: IcomflyOrderRecord | undefined,
  moovin: MoovinTrackingRow | undefined,
  guideNumber: string | undefined
): DispatchView | null {
  // Moovin manda: su estado clasifica el bucket de tránsito directamente.
  const phase = moovin ? moovinTransitPhase(moovin) : null;
  if (phase) return phase; // despacho_solicitado | recolectado | en_route

  // Sin fase de transito: Moovin final/incidencia (ya recogido) o sin dato.
  const pickedUp = isMoovinPickedUp(moovin);
  if (pickedUp === true) return "despachado"; // el estado final lo maneja getEffectiveTrackingStatus

  const hasGuide = Boolean(guideNumber && String(guideNumber).trim());
  if (rec) {
    return rec.dispatch_state === "despachado"
      ? "despachado"
      : rec.dispatch_state === "despacho_solicitado"
        ? "despacho_solicitado"
        : "pendiente";
  }
  if (hasGuide) return "despachado";
  return null;
}

// Funde el hito de despacho dentro del "Estado de seguimiento": la fase de
// transito de Moovin (despacho_solicitado/recolectado/en_route) reemplaza al
// base "En ruta"/"Pendiente". El "despachado" (ya recogido, estado final) y
// "pendiente" NO generan estado nuevo: cae al base. No pisa estados terminales
// ni pedidos anulados.
export function mergeDispatchIntoTracking(
  baseStatus: string,
  dispatchState: DispatchView | null,
  row: { shopify_cancelled_at?: string | null; shopify_financial_status?: string | null }
): string {
  // Anulado manda (replica isShopifyCancelled sin arrastrar finance-orders, que
  // usa el alias @/ y rompe los tests).
  if (row.shopify_cancelled_at || row.shopify_financial_status === "voided") return baseStatus;
  // Solo aplica al limbo previo al movimiento real (no pisa entregado, no
  // entregado, incidencia, reintento ni anulado).
  if (baseStatus !== "pending" && baseStatus !== "en_route") return baseStatus;
  switch (dispatchState) {
    case "despacho_solicitado":
      return "despacho_solicitado";
    case "recolectado":
      return "recolectado";
    case "en_route":
      return "en_route";
    default:
      return baseStatus; // despachado, pendiente, null
  }
}
