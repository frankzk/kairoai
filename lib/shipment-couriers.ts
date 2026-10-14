// Couriers de Honduras que Kairo reconoce por el FORMATO de la guia (Cargo
// Expreso y c807 Xpress) y sigue por su rastreo publico (courier_shipments,
// ver lib/courier-shipment-sync.ts). Puro: lo usan el servidor (dataset de
// pedidos) y la pantalla de pedidos.
//
// POR QUE EXISTE: Shopify rotula casi todas sus guias como "Transportadora"
// (54 de 67 de Cargo Expreso y 33 de 44 de c807, al 14/10/2026), y en Honduras
// eso se leia como Forza: la pantalla de pedidos le pegaba "FD" a la guia
// (FDBH262231336-1), mostraba el enlace de rastreo de Forza y el estado no
// salia del courier real. Como con WYN (prefijo MLCR), la guia dice quien la
// mueve.

import { isC807Guide, normalizeC807Guide } from "./c807";
import { isCargoExpresoGuide, normalizeCargoExpresoGuide } from "./cargo-expreso";

export type ShipmentCourierCode = "cargoexpreso" | "c807";

export const SHIPMENT_COURIER_LABELS: Record<ShipmentCourierCode, string> = {
  cargoexpreso: "Cargo Expreso",
  c807: "c807 Xpress",
};

/** Courier de la guia segun su formato; null si no es de Cargo Expreso ni de c807. */
export function detectShipmentCourier(guide?: string | null): ShipmentCourierCode | null {
  if (isCargoExpresoGuide(guide)) return "cargoexpreso";
  if (isC807Guide(guide)) return "c807";
  return null;
}

/**
 * Courier de la fila: primero por la guia y, si la guia no lo dice, por el
 * nombre (un archivo logistico o un fulfillment que si escribio "Cargo
 * Expreso" no debe caer en el boton de Forza).
 */
export function resolveShipmentCourier(
  courier: string | undefined,
  guide?: string | null
): ShipmentCourierCode | null {
  const byGuide = detectShipmentCourier(guide);
  if (byGuide) return byGuide;
  const lower = String(courier ?? "").toLowerCase();
  if (lower.includes("cargo expreso") || lower.includes("cargoexpreso")) return "cargoexpreso";
  if (lower.includes("c807")) return "c807";
  return null;
}

export function normalizeShipmentGuide(code: ShipmentCourierCode, guide?: string | null): string {
  return code === "cargoexpreso" ? normalizeCargoExpresoGuide(guide) : normalizeC807Guide(guide);
}

/**
 * Pagina publica de rastreo del courier. La de c807 recibe la guia en la URL;
 * la de Cargo Expreso no tiene un enlace directo conocido, asi que abre su
 * buscador y la guia se copia desde Kairo.
 */
export function buildShipmentTrackingUrl(code: ShipmentCourierCode, guide: string): string {
  if (code === "c807") {
    return `https://c807xpress.com/tracking/?guia=${encodeURIComponent(normalizeC807Guide(guide))}`;
  }
  return "https://www2.cargoexpreso.com/";
}

/** Grupo guardado en courier_shipments -> estado de seguimiento de Kairo. Vacio si no hay dato. */
export function shipmentGroupToStatus(group: string | undefined): string {
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
      // "pending" (guia creada, sin recoger): cae a la regla general de la
      // fila con guia, igual que Forza.
      return "";
  }
}

/** Intentos de entrega fallidos del historial (lib/cargo-expreso.ts y lib/c807.ts los marcan "failed"). */
export function countShipmentIncidents(events: Array<{ group?: string }> | undefined): number {
  if (!events?.length) return 0;
  return events.filter((event) => event.group === "failed").length;
}
