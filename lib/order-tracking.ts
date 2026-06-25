// Maquina de estados de seguimiento de pedidos y clasificacion de incidencias.
//
// Es la fuente unica de verdad (lado cliente) para derivar el estado de un
// pedido a partir de Moovin / Boxful / liquidaciones, y para clasificar las
// incidencias. Vive en lib/ (no dentro del componente de la pagina) para poder
// importarse desde los tests y desde cualquier vista, en vez de re-derivar las
// reglas en cada lugar.
//
// Relacion con lib/moovin.ts: aquel parsea la respuesta cruda de Moovin y marca
// has_incident sobre el ultimo evento; aqui se trabaja sobre la fila ya cacheada
// (MoovinTrackingRow) y sobre el pedido completo (Boxful/Shopify/liquidacion).
import type { MoovinTrackingRow } from "./finance-types";

// Filtros del seguimiento de pedidos. La "Incidencia" se divide en dos
// clasificaciones segun el patron de fallos (ver classifyIncident).
export type OrderTrackingFilter =
  | "all"
  | "pending"
  | "recolectado"
  | "en_route"
  | "en_route_retry"
  | "incident_solvable"
  | "incident_unsolvable"
  | "annulled"
  | "delivered"
  | "not_delivered";

export type IncidentClass = "incident_solvable" | "incident_unsolvable";

// Forma minima del pedido que necesita la maquina de estados. TrackableOrderRow
// de la pagina es estructuralmente compatible con esto.
export interface TrackingOrderInput {
  source: "boxful" | "shopify" | "liquidacion";
  guide_number: string;
  boxful_status: string;
  internal_status: string;
  shopify_cancelled_at: string | null;
  shopify_financial_status: string;
  moovin_group?: string;
  moovin_incidents?: number;
  moovin_route_attempts?: number;
}

// Forma minima de una traza de liquidacion usada para derivar el estado.
export interface TrackingSettlementTrace {
  settlement_status: string;
  internal_status: string;
}

// Fragmentos de titulo de los eventos de Moovin que clasificamos. Se hace match
// en minusculas y por substring para tolerar variaciones de Moovin.
const INCIDENT_TITLE = "incidencia en la entrega";
// "En ruta para entregar a lo largo del dia" (ojo: "entregar" y "dia" sin
// tilde en el dato real; el match tolera tambien "la entrega" y "día").
const ROUTE_TITLE_PREFIX = "en ruta para";
const ROUTE_TITLE_DAY = "a lo largo del";

export function getEffectiveTrackingStatus(
  row: Pick<
    TrackingOrderInput,
    "source" | "boxful_status" | "internal_status" | "shopify_cancelled_at" | "shopify_financial_status" | "moovin_group" | "moovin_incidents" | "guide_number"
  >,
  traces: TrackingSettlementTrace[]
): string {
  const moovinStatus = moovinGroupToStatus(row.moovin_group);

  // 1) Moovin en vivo manda SOLO cuando su ultimo evento ya es terminal o
  //    incidencia (entregado / devuelto / incidencia). Un "in_progress" de
  //    Moovin es la senal mas debil (y a menudo cache viejo): NO debe tapar un
  //    estado terminal/cancelado/incidencia confirmado por Boxful o liquidacion.
  if (moovinStatus && moovinStatus !== "en_route") return moovinStatus;

  // 2) Estado interno final (columna "Estado" de Boxful ya mapeada al importar).
  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  // 3) Texto del estado de Boxful cuando es "resuelto": entregado, no entregado,
  //    guia cancelada (=> anulado) o problemas/incidencia (=> incidencia). Esto
  //    saca de "En ruta" a pedidos que claramente no estan en ruta aunque el
  //    cache de Moovin haya quedado en "in_progress".
  const boxfulStatus = classifyBoxfulStatusText(row.boxful_status);
  if (isResolvedTrackingStatus(boxfulStatus)) return boxfulStatus;

  // 4) Liquidacion con estado final (un pedido liquidado ya llego a su termino).
  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

  // 5) Reintento de Moovin: en ruta tras 1+ incidencia de entrega. Manda sobre
  //    el sub-estado de transito de Boxful (que puede ser un dato mas viejo).
  if (moovinStatus === "en_route" && (row.moovin_incidents ?? 0) >= 1) return "en_route_retry";

  // 6) Sub-estado de transito con el dato mas granular: el texto de Boxful
  //    distingue "recolectado" (recogido, aun no en ultima milla) de "en ruta a
  //    destino"; Moovin solo informa "in_progress".
  if (boxfulStatus === "recolectado") return "recolectado";
  if (boxfulStatus === "en_route") return "en_route";

  // 7) Moovin en progreso sin mas detalle => en ruta.
  if (moovinStatus === "en_route") return "en_route";

  // 8) "Registrado / por preparar": la guia existe pero el paquete aun no se
  //    recolecto => pendiente, no en ruta.
  if (boxfulStatus === "pending") return "pending";

  // 9) Sin movimiento logistico y cancelado en Shopify => anulado.
  const hasOperationalMovement = row.source !== "shopify" || traces.length > 0 || Boolean(row.guide_number);
  if (isShopifyCancelled(row) && !hasOperationalMovement) return "annulled";

  // 10) Con guia/courier (movimiento logistico) y sin estado final => en reparto.
  if (hasOperationalMovement) return "en_route";

  return "pending";
}

// "Pendiente operativo" para agregaciones: incluye en ruta (despachado pero
// aun sin entregar) y pendiente (sin despachar).
export function isPendingLike(status: string): boolean {
  return (
    status === "pending" ||
    status === "recolectado" ||
    status === "en_route" ||
    status === "en_route_retry" ||
    status === "incident"
  );
}

export function inferTrackingStatusFromText(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";
  if (lower.includes("entregado")) return "delivered";
  return "pending";
}

// Normaliza el texto del estado de Boxful para compararlo por substring.
function normalizeStatusText(value: string): string {
  // Boxful escribe el estado en mayus/minus indistintamente; los tokens que
  // comparamos ("entregado", "cancelad", "recolectad", "en ruta", "registrad",
  // "problema", ...) no llevan tilde, asi que basta con normalizar a minusculas.
  return String(value || "").toLowerCase().trim();
}

// Estados que ya "resolvieron" el pedido (terminal, anulado o incidencia) y por
// tanto NO son "en ruta". Se usa para que estas senales le ganen a un
// "in_progress" de Moovin que pudo quedar viejo en cache.
export function isResolvedTrackingStatus(status: string): boolean {
  return (
    status === "delivered" ||
    status === "not_delivered" ||
    status === "returned" ||
    status === "annulled" ||
    status === "incident"
  );
}

// Clasifica el texto del estado de Boxful (columna "Estado"/M) a un estado de
// seguimiento. La columna trae mas granularidad que el grupo de Moovin
// ("Recolectado", "En ruta a destino", "Problemas en gestion", "Guia
// cancelada", "Registrado", ...). Devuelve "" cuando el texto esta vacio o no se
// reconoce, para que el llamador caiga a las otras senales (Moovin, guia,
// liquidacion) sin forzar una clasificacion.
export function classifyBoxfulStatusText(status: string): string {
  const text = normalizeStatusText(status);
  if (!text) return "";
  // "No entregado" contiene "entregado": se evalua primero.
  if (text.includes("no entregado") || text.includes("devuelto") || text.includes("rechazad")) {
    return "not_delivered";
  }
  if (text.includes("entregado")) return "delivered";
  // "Guia cancelada" / "Cancelado" => el envio se anulo.
  if (text.includes("cancelad")) return "annulled";
  // "Problemas en gestion" / "Novedad" / "Incidencia" => incidencia operativa.
  if (text.includes("problema") || text.includes("incidencia") || text.includes("novedad")) {
    return "incident";
  }
  // "Recolectado": el courier ya lo recogio, aun no sale a ultima milla.
  if (text.includes("recolectad")) return "recolectado";
  // "En ruta a destino" y demas sub-estados de transito activo.
  if (
    text.includes("en ruta") ||
    text.includes("reparto") ||
    text.includes("transito") ||
    text.includes("distribu")
  ) {
    return "en_route";
  }
  // "Registrado" / "Por preparar": la guia existe pero el paquete no se ha
  // recolectado todavia => pendiente.
  if (text.includes("registrad") || text.includes("por preparar") || text.includes("preparacion")) {
    return "pending";
  }
  return "";
}

export function getTrackingFilterFromStatus(
  status: string,
  row?: Pick<TrackingOrderInput, "moovin_incidents" | "moovin_route_attempts">
): Exclude<OrderTrackingFilter, "all"> {
  if (status === "annulled") return "annulled";
  if (status === "delivered") return "delivered";
  if (status === "not_delivered" || status === "returned") return "not_delivered";
  if (status === "recolectado") return "recolectado";
  if (status === "en_route") return "en_route";
  if (status === "en_route_retry") return "en_route_retry";
  if (status === "incident") return classifyIncident(row);
  return "pending";
}

// Divide las incidencias en dos clasificaciones:
// - Solucionable: a lo sumo una "Incidencia en la entrega"; aun se puede
//   reagendar/corregir la entrega.
// - No solucionable: dos o mas "Incidencia en la entrega" y dos o mas eventos
//   "En ruta para entregar a lo largo del dia"; el courier salio a entregar
//   varias veces y fallo de forma repetida.
export function classifyIncident(
  row?: Pick<TrackingOrderInput, "moovin_incidents" | "moovin_route_attempts">
): IncidentClass {
  const incidents = row?.moovin_incidents ?? 0;
  const routeAttempts = row?.moovin_route_attempts ?? 0;
  return incidents >= 2 && routeAttempts >= 2 ? "incident_unsolvable" : "incident_solvable";
}

export function getTrackingStatusLabel(
  row: Pick<TrackingOrderInput, "internal_status" | "boxful_status" | "moovin_incidents" | "moovin_route_attempts">,
  traces: TrackingSettlementTrace[],
  status: string
): string {
  if (status === "annulled") return "Anulado";
  if (isFinalTrackingStatus(row.internal_status)) {
    return status === "not_delivered" || status === "returned" ? "No entregado" : row.boxful_status || "Entregado";
  }

  const settlementTrace = traces.find((trace) => trace.internal_status === status);
  if (settlementTrace?.settlement_status) return settlementTrace.settlement_status;
  if (status === "delivered") return "Entregado";
  if (status === "not_delivered" || status === "returned") return "No entregado";
  if (status === "recolectado") return row.boxful_status || "Recolectado";
  if (status === "en_route") return row.boxful_status || "En ruta";
  if (status === "en_route_retry")
    return (row.moovin_incidents ?? 1) > 1 ? `Reintento (${row.moovin_incidents})` : "Reintento";
  if (status === "incident")
    return classifyIncident(row) === "incident_unsolvable"
      ? "Incidencia no solucionable"
      : "Incidencia solucionable";
  return "Pendiente";
}

export function isFinalTrackingStatus(status: string): boolean {
  return status === "delivered" || status === "not_delivered" || status === "returned";
}

// Mapea el ultimo grupo de Moovin al estado de seguimiento. Vacio si no hay
// dato de Moovin (cae a la logica de Boxful/sistema).
export function moovinGroupToStatus(group: string | undefined): string {
  switch (group) {
    case "delivered":
      return "delivered";
    case "returned":
      return "not_delivered";
    case "failed":
      return "incident";
    case "in_progress":
      return "en_route";
    default:
      return "";
  }
}

// Cuenta las incidencias de entrega ("Incidencia en la entrega", codigo FAILED)
// de Moovin. Un envio en ruta con 1+ incidencia es un reintento tras fallar.
export function countMoovinIncidents(events: MoovinTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter(
    (event) =>
      String(event.code ?? "").toUpperCase() === "FAILED" ||
      String(event.title ?? "").toLowerCase().includes(INCIDENT_TITLE)
  ).length;
}

// Cuenta las salidas a reparto de Moovin ("En ruta para entregar a lo largo del
// dia"). Varias salidas indican intentos de entrega repetidos. Se hace match por
// la frase distintiva "a lo largo del" para tolerar variaciones de Moovin
// (entregar/la entrega, con o sin tilde en "dia").
export function countMoovinRouteAttempts(events: MoovinTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter((event) => {
    const title = String(event.title ?? "").toLowerCase();
    return title.includes(ROUTE_TITLE_PREFIX) && title.includes(ROUTE_TITLE_DAY);
  }).length;
}

// Reclasifica el ultimo estado de Moovin corrigiendo cache viejo: "Cancelado"
// (p.ej. supera intentos de entrega) quedaba como en ruta y debe ser No
// entregado; una incidencia de entrega activa (codigo FAILED) debe ser
// Incidencia aunque el latest_group cacheado haya quedado viejo. Los demas
// estados conservan su grupo ya calculado.
export function deriveMoovinGroup(row: MoovinTrackingRow | undefined): string {
  if (!row) return "";
  const code = String(row.latest_code ?? "").toUpperCase();
  const title = String(row.latest_status ?? "").toLowerCase();
  if (code.startsWith("CANCEL") || title.includes("cancelado")) return "returned";
  // Incidencia activa: el ultimo evento es una incidencia de entrega. Se rescata
  // por has_incident/codigo/titulo por si el latest_group cacheado se sincronizo
  // antes de la incidencia y aun dice "en ruta" (o quedo vacio), para que la fila
  // se clasifique como Incidencia y no como En ruta.
  if (row.has_incident || code === "FAILED" || title.includes(INCIDENT_TITLE)) {
    return "failed";
  }
  return row.latest_group ?? "";
}

export function isShopifyCancelled(
  row: Pick<TrackingOrderInput, "shopify_cancelled_at" | "shopify_financial_status">
): boolean {
  return Boolean(row.shopify_cancelled_at || row.shopify_financial_status === "voided");
}
