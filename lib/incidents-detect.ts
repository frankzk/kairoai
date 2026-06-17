// Logica pura de deteccion y transicion de novedades (incidencias de reparto).
// Sin acceso a base de datos: se prueba con fixtures (tests/incidents.test.ts).
// La usan el cron de deteccion y el service layer.

import { normalizeMatchKey } from "./order-matching";
import { DEFAULT_FINANCE_STORE_ID } from "./store-config";
import type { MoovinTrackingRow, LogisticsRow } from "./finance-types";
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

// Construye una candidata desde el tracking de Moovin. Devuelve null cuando el
// envio sigue en progreso (no hay nada que gestionar todavia). Para entregas
// (delivered) devuelve candidata con grupo 'delivered' para que applyDetection
// pueda auto-resolver una novedad previa.
export function detectMoovinIncident(
  tracking: MoovinTrackingRow,
  row?: LogisticsRow,
  storeId: number = DEFAULT_FINANCE_STORE_ID
): DetectedIncident | null {
  const group = tracking.latest_group || "";
  // "Incidencia activa" = el ultimo evento de Moovin es una falla (has_incident).
  // Coincide con el estado "Incidencia" de la pagina de finanzas
  // (moovinGroupToStatus: failed -> incident). NO incluye "returned"/"delivered":
  // esos son terminales (devuelto / entregado), no novedades a gestionar.
  const isFailure = tracking.has_incident || group === "failed";
  const isDelivered = group === "delivered";
  if (!isFailure && !isDelivered) return null;

  const guide = tracking.id_package || row?.guide_number || "";
  const orderName = row?.order_name || "";
  const reason = tracking.incident_reason || tracking.latest_status || "";

  return {
    store_id: row?.store_id ?? storeId,
    incident_key: buildIncidentKey(guide, orderName),
    source: "moovin",
    order_name: orderName,
    guide_number: guide,
    shopify_order_id: row?.shopify_order_id || "",
    customer_name: row?.customer_name || "",
    customer_phone: row?.customer_phone || "",
    courier: row?.courier || "Moovin",
    cod_amount: Number(row?.cod_amount ?? 0),
    category: isFailure ? mapMoovinCategory(reason, group) : "otro",
    detail: reason,
    last_tracking_status: tracking.latest_status || "",
    last_tracking_group: group,
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

// Decide que hacer con una candidata frente al registro existente. Nunca pisa la
// gestion manual (manual_override) ni reabre estados terminales. Auto-resuelve
// cuando el courier confirma la entrega de una novedad abierta.
export function applyDetection(
  existing: Incident | null,
  candidate: DetectedIncident
): DetectionResult {
  const delivered = candidate.last_tracking_group === "delivered";

  if (!existing) {
    // No se crean novedades para entregas confirmadas.
    if (delivered) return { action: "skip", patch: {} };
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

  const isTerminal = TERMINAL_STATUSES.includes(existing.status);

  // Auto-resolver entrega confirmada (solo si no hay gestion manual ni cierre).
  if (delivered) {
    if (existing.manual_override || isTerminal) {
      return { action: "update", patch };
    }
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

  // Falla/devolucion sobre una novedad existente: solo refresca el snapshot.
  // No reabre terminales ni cambia el estado gestionado por el operador.
  return { action: "update", patch };
}
