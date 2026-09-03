// Logica pura de deteccion y transicion de novedades (incidencias de reparto).
// Sin acceso a base de datos: se prueba con fixtures (tests/incidents.test.ts).
// La usan el cron de deteccion y el service layer.

import { normalizeMatchKey } from "./order-matching";
import { classifyMoovinGroup } from "./moovin";
import { DEFAULT_FINANCE_STORE_ID } from "./store-config";
import type { MoovinTrackingRow, ForzaTrackingRow, LogisticsRow } from "./finance-types";
import type { ShopifyOrderSummary } from "./finance-orders";
import type {
  DetectedIncident,
  Incident,
  IncidentCategory,
} from "./incidents-types";
import { TERMINAL_STATUSES } from "./incidents-types";

// Clave idempotente unificada por envio: misma guia (con o sin '#') => misma
// novedad, sin importar si la detecto Moovin o Boxful, o si fue carga manual.
// Cae al nombre de pedido cuando no hay guia. Devuelve "" si no hay ninguno
// (el caller decide el fallback, p.ej. una clave con timestamp para manuales).
export function buildIncidentKey(guideNumber: string, orderName: string): string {
  return normalizeMatchKey(guideNumber || "") || normalizeMatchKey(orderName || "");
}

// Nombre del cliente desde el pedido de Shopify, descartando el placeholder
// "Sin nombre" que usa el resumen persistido cuando el pedido no trae cliente.
function shopifyCustomerName(shopify?: ShopifyOrderSummary): string {
  const name = (shopify?.customer_name || "").trim();
  return name && name.toLowerCase() !== "sin nombre" ? name : "";
}

// Mapea la razon/grupo de Moovin a una causa. Usa coincidencias parciales para
// no depender de tildes.
export function mapMoovinCategory(reason: string, group: string): IncidentCategory {
  if (group === "returned") return "devuelto_origen";
  const r = (reason || "").toLowerCase();
  if (r.includes("direcci")) return "direccion_incorrecta";
  if (
    r.includes("no contesta") ||
    r.includes("no responde") ||
    r.includes("no atiende") ||
    r.includes("ilocaliz") ||
    r.includes("ausente")
  )
    return "cliente_no_responde";
  if (r.includes("rechaz")) return "cliente_rechaza";
  if (r.includes("dano") || r.includes("daño") || r.includes("averi") || r.includes("roto"))
    return "dano_paquete";
  return "fallo_entrega";
}

// Mapea el estado de Boxful a una causa. Devuelve null cuando NO es novedad
// (entregado, en ruta, registrado, recolectado, etc.).
export function mapBoxfulCategory(boxfulStatus: string): IncidentCategory | null {
  const s = (boxfulStatus || "").toLowerCase();
  if (!s) return null;
  if (s.includes("no entregado")) return "fallo_entrega";
  if (s.includes("devuelto") || s.includes("devolucion") || s.includes("devolución"))
    return "devuelto_origen";
  if (s.includes("rechaz")) return "cliente_rechaza";
  if (s.includes("problema")) return "fallo_entrega";
  return null;
}

// Fecha del evento de FALLA mas reciente (group "failed"). Sirve para saber si
// una reprogramada volvio a fallar DESPUES de reprogramarse. Devuelve null si no
// hay eventos de falla con fecha.
function lastFailureDate(
  events: Array<{ group?: string; date?: string | null }> | undefined
): string | null {
  if (!events?.length) return null;
  let latest: string | null = null;
  for (const ev of events) {
    if (ev.group === "failed" && ev.date && (!latest || ev.date > latest)) latest = ev.date;
  }
  return latest;
}

// Construye una candidata desde el tracking de Moovin. Devuelve null cuando el
// envio sigue en progreso (no hay nada que gestionar todavia). Para entregas
// (delivered) y devoluciones (returned) devuelve candidata con ese grupo para
// que applyDetection pueda cerrar una novedad previa (resuelta / perdida).
export function detectMoovinIncident(
  tracking: MoovinTrackingRow,
  row?: LogisticsRow,
  storeId: number = DEFAULT_FINANCE_STORE_ID,
  shopify?: ShopifyOrderSummary
): DetectedIncident | null {
  // Reinterpreta el grupo con el clasificador vigente. Las filas de
  // moovin_tracking guardadas ANTES de mapear un codigo (p.ej. los codigos de
  // gestion REVIEW / CHANGECONTACTPOINT) quedaron cacheadas con
  // latest_group="in_progress"; el codigo crudo (latest_code) sigue guardado, asi
  // que re-clasificamos para detectarlas SIN esperar el re-fetch guia por guia
  // (topado a 130/corrida). Solo sube in_progress -> failed; nunca degrada un
  // estado terminal ya guardado (delivered / returned).
  const storedGroup = tracking.latest_group || "";
  const codeGroup = classifyMoovinGroup(tracking.latest_code || "", tracking.latest_status || "");
  const group = codeGroup === "failed" && storedGroup !== "failed" ? "failed" : storedGroup;
  // "Incidencia activa" = el ultimo evento de Moovin es una falla (has_incident).
  // Coincide con el estado "Incidencia" de la pagina de finanzas
  // (moovinGroupToStatus: failed -> incident). NO incluye "returned"/"delivered":
  // esos son terminales (devuelto / entregado), no novedades a gestionar.
  const isFailure = tracking.has_incident || group === "failed";
  const isDelivered = group === "delivered";
  const isReturned = group === "returned";
  if (!isFailure && !isDelivered && !isReturned) return null;

  const guide = tracking.id_package || row?.guide_number || "";
  // Datos de cliente/pedido por prioridad: 1) logistica importada, 2) pedido de
  // Shopify cruzado por guia (tracking_number) aunque aun no este en un Excel,
  // 3) lo poco que trae el tracking.
  const orderName = row?.order_name || shopify?.name || "";
  const reason = tracking.incident_reason || tracking.latest_status || "";

  return {
    store_id: row?.store_id ?? storeId,
    incident_key: buildIncidentKey(guide, orderName),
    source: "moovin",
    order_name: orderName,
    guide_number: guide,
    shopify_order_id: row?.shopify_order_id || shopify?.id || "",
    customer_name: row?.customer_name || shopifyCustomerName(shopify) || tracking.last_name || "",
    customer_phone: row?.customer_phone || shopify?.phone || "",
    courier: row?.courier || "Moovin",
    cod_amount: Number(row?.cod_amount ?? 0) || Number(shopify?.total_price ?? 0),
    category: isFailure || isReturned ? mapMoovinCategory(reason, group) : "otro",
    detail: reason,
    last_tracking_status: tracking.latest_status || "",
    last_tracking_group: group,
    last_failure_at: lastFailureDate(tracking.events),
  };
}

// Construye una candidata desde el tracking de Forza (Honduras). Misma semantica
// que Moovin: failed/has_incident = novedad activa; delivered permite auto-resolver.
// El tracking de Forza ya viene particionado por tienda (store_id) y la guia es
// guide_number (no id_package). El mapeo de causa se comparte con Moovin.
export function detectForzaIncident(
  tracking: ForzaTrackingRow,
  row?: LogisticsRow,
  shopify?: ShopifyOrderSummary
): DetectedIncident | null {
  const group = tracking.latest_group || "";
  const isFailure = tracking.has_incident || group === "failed";
  const isDelivered = group === "delivered";
  const isReturned = group === "returned";
  if (!isFailure && !isDelivered && !isReturned) return null;

  const guide = tracking.guide_number || row?.guide_number || "";
  const orderName = row?.order_name || shopify?.name || "";
  const reason = tracking.incident_reason || tracking.latest_status || "";

  return {
    store_id: tracking.store_id || row?.store_id || DEFAULT_FINANCE_STORE_ID,
    incident_key: buildIncidentKey(guide, orderName),
    source: "forza",
    order_name: orderName,
    guide_number: guide,
    shopify_order_id: row?.shopify_order_id || shopify?.id || "",
    customer_name: row?.customer_name || tracking.receiver_name || shopifyCustomerName(shopify) || "",
    customer_phone: row?.customer_phone || shopify?.phone || "",
    courier: row?.courier || "Forza",
    cod_amount: Number(row?.cod_amount ?? 0) || Number(shopify?.total_price ?? 0),
    category: isFailure || isReturned ? mapMoovinCategory(reason, group) : "otro",
    detail: reason,
    last_tracking_status: tracking.latest_status || "",
    last_tracking_group: group,
    last_failure_at: lastFailureDate(tracking.events),
  };
}

// Construye una candidata desde una fila de logistica Boxful. Devuelve null
// cuando el estado no representa una novedad.
export function detectBoxfulIncident(row: LogisticsRow): DetectedIncident | null {
  const category = mapBoxfulCategory(row.boxful_status || "");
  if (!category) return null;
  return {
    store_id: row.store_id,
    incident_key: buildIncidentKey(row.guide_number || "", row.order_name || ""),
    source: "boxful",
    order_name: row.order_name || "",
    guide_number: row.guide_number || "",
    shopify_order_id: row.shopify_order_id || "",
    customer_name: row.customer_name || "",
    customer_phone: row.customer_phone || "",
    courier: row.courier || "",
    cod_amount: Number(row.cod_amount ?? 0),
    category,
    detail: row.boxful_status || "",
    last_tracking_status: row.boxful_status || "",
    last_tracking_group: row.internal_status || "",
    last_failure_at: null,
  };
}

export interface DetectionEvent {
  kind: "detectada" | "estado_cambiado";
  from_status: string;
  to_status: string;
  message: string;
  result: "ok" | "error" | "info";
}

export interface DetectionResult {
  action: "insert" | "update" | "skip";
  patch: Partial<Incident>;
  event?: DetectionEvent;
}

/**
 * Refresco de snapshot SIN transicion de estado: si no cambia nada, no se
 * escribe.
 *
 * POR QUE EXISTE: `applyDetection` devolvia "update" para toda novedad
 * existente, cambiara algo o no, porque el patch siempre trae los tres campos
 * del snapshot del courier. Con 2.302 novedades (2.105 en estado terminal, que
 * por definicion ya no se mueven) eso es reescribir la tabla entera cada vez.
 *
 * Medido en el incidente del 03/09: el boton "Detectar novedades" hizo 1.031
 * escrituras y solo TRES correspondian a un cambio real. Las otras 1.028
 * copaban la cola de PostgREST hasta que empezo a responder 503 — y el que se
 * quedaba sin tablero era el modulo de Leads, que no tiene nada que ver.
 *
 * null y undefined cuentan como el mismo valor: el candidato trae undefined
 * donde la fila tiene null, y tomar eso por un cambio devolveria el problema.
 */
function refrescoDeSnapshot(existing: Incident, patch: Partial<Incident>): DetectionResult {
  const igual = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
  const cambia = (Object.keys(patch) as Array<keyof Incident>).some(
    (campo) => !igual(patch[campo], existing[campo])
  );
  return cambia ? { action: "update", patch } : { action: "skip", patch: {} };
}

// Decide que hacer con una candidata frente al registro existente. Reconcilia el
// ESTADO de las novedades NO terminales con el outcome del courier:
//   entregada -> resuelta · devuelta -> perdida · reprogramada que fallo ->
//   reprog_fallida.
// Los estados terminales (resuelta/perdida/descartada) nunca se reabren. No pisa
// lo que edito el operador (notas/categoria/contacto): solo rellena vacios y
// refresca el snapshot del tracking. `now` (ISO) permite fijar la fecha en tests.
export function applyDetection(
  existing: Incident | null,
  candidate: DetectedIncident,
  now: string = new Date().toISOString()
): DetectionResult {
  const group = candidate.last_tracking_group;
  const delivered = group === "delivered";
  const returned = group === "returned";

  if (!existing) {
    // No se crean novedades para cierres ya confirmados (entrega/devolucion) sin
    // gestion previa: no hay nada que gestionar.
    if (delivered || returned) return { action: "skip", patch: {} };
    return {
      action: "insert",
      patch: {
        store_id: candidate.store_id,
        incident_key: candidate.incident_key,
        source: candidate.source,
        order_name: candidate.order_name,
        guide_number: candidate.guide_number,
        shopify_order_id: candidate.shopify_order_id,
        customer_name: candidate.customer_name,
        customer_phone: candidate.customer_phone,
        courier: candidate.courier,
        cod_amount: candidate.cod_amount,
        category: candidate.category,
        status: "pendiente",
        detail: candidate.detail,
        last_tracking_status: candidate.last_tracking_status,
        last_tracking_group: candidate.last_tracking_group,
        manual_override: false,
      },
      event: {
        kind: "detectada",
        from_status: "",
        to_status: "pendiente",
        message: `Novedad detectada automaticamente (${candidate.source})`,
        result: "info",
      },
    };
  }

  // Refresco de snapshot + relleno de datos vacios (sin pisar lo del operador).
  const patch: Partial<Incident> = {
    detail: candidate.detail,
    last_tracking_status: candidate.last_tracking_status,
    last_tracking_group: candidate.last_tracking_group,
  };
  if (!existing.shopify_order_id && candidate.shopify_order_id) patch.shopify_order_id = candidate.shopify_order_id;
  if (!existing.customer_phone && candidate.customer_phone) patch.customer_phone = candidate.customer_phone;
  if (!existing.customer_name && candidate.customer_name) patch.customer_name = candidate.customer_name;
  if (!existing.courier && candidate.courier) patch.courier = candidate.courier;
  if (!existing.order_name && candidate.order_name) patch.order_name = candidate.order_name;
  if (!existing.guide_number && candidate.guide_number) patch.guide_number = candidate.guide_number;
  if (!existing.cod_amount && candidate.cod_amount) patch.cod_amount = candidate.cod_amount;

  // Estados cerrados a mano (resuelta/perdida/descartada): nunca se reabren.
  // Son 2.105 de 2.302 novedades: si igual se reescriben, la corrida completa
  // toca casi toda la tabla para nada.
  if (TERMINAL_STATUSES.includes(existing.status)) return refrescoDeSnapshot(existing, patch);

  // --- No terminales: el estado se reconcilia con el outcome del courier. ---
  // Entrega confirmada -> Resuelta.
  if (delivered) {
    patch.status = "resuelta";
    return {
      action: "update",
      patch,
      event: {
        kind: "estado_cambiado",
        from_status: existing.status,
        to_status: "resuelta",
        message: "Entrega confirmada por el courier",
        result: "info",
      },
    };
  }

  // Devolucion al origen / no entregado final -> Perdida.
  if (returned) {
    patch.status = "perdida";
    return {
      action: "update",
      patch,
      event: {
        kind: "estado_cambiado",
        from_status: existing.status,
        to_status: "perdida",
        message: "Devuelto al origen por el courier",
        result: "info",
      },
    };
  }

  // Reprogramada que no prospero -> Reprogramacion fallida. Dispara cuando vencio
  // la fecha acordada sin entrega (hoy > reprogramada_para) O cuando hubo una
  // falla NUEVA posterior a la reprogramacion (last_failure_at > reprogramada_at).
  if (existing.status === "reprogramada") {
    const today = now.slice(0, 10);
    const dateExpired = !!existing.reprogramada_para && today > existing.reprogramada_para;
    const newFailure =
      !!existing.reprogramada_at &&
      !!candidate.last_failure_at &&
      candidate.last_failure_at > existing.reprogramada_at;
    if (dateExpired || newFailure) {
      patch.status = "reprog_fallida";
      return {
        action: "update",
        patch,
        event: {
          kind: "estado_cambiado",
          from_status: "reprogramada",
          to_status: "reprog_fallida",
          message: dateExpired
            ? "Vencio la fecha reprogramada sin entrega"
            : "Volvio a fallar la entrega despues de reprogramar",
          result: "info",
        },
      };
    }
  }

  // Falla activa sin condicion de cambio: solo refresca el snapshot.
  return refrescoDeSnapshot(existing, patch);
}
