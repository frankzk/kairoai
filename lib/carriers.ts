// Fuente unica de la logica de transportadoras (carriers): resolucion por fila,
// normalizacion de guias y helpers de courier. Antes esta logica estaba
// TRIPLICADA en lib/finance-orders.ts, app/admin/finance/page.tsx y lib/forza.ts;
// aqui queda centralizada (mismo patron que lib/order-matching.ts) para que el
// servidor, las rutas y el cliente compartan exactamente el mismo comportamiento.
//
// Modulo puro: sin React y sin dependencias de runtime (solo tipos). Se puede
// importar tanto desde el bundle del navegador como desde rutas server-side.

import type { FinanceStorePublic, LogisticsProviderCode } from "@/lib/store-config";
import type { ForzaTrackingRow } from "@/lib/finance-types";

// Codigo canonico de transportadora. Hoy coincide con LogisticsProviderCode
// ("moovin" | "forza"); el registro de abajo es la unica pieza a tocar para
// sumar una nueva transportadora.
export type CarrierCode = LogisticsProviderCode;

interface CarrierDef {
  code: CarrierCode;
  // Etiqueta de despliegue / courier por defecto de la tienda.
  label: string;
  // Subcadenas (en minuscula) que identifican a la transportadora dentro de un
  // campo de courier libre (fulfillment de Shopify, columna Courier del Excel).
  aliases: string[];
  // Prefijo de serie de guia, p.ej. "FD" para Forza.
  guidePrefix?: string;
}

const CARRIER_DEFS: CarrierDef[] = [
  { code: "moovin", label: "Moovin", aliases: ["moovin"] },
  { code: "forza", label: "Forza", aliases: ["forza", "forzadelivery", "forza delivery"], guidePrefix: "FD" },
];

const CARRIER_BY_CODE = new Map<CarrierCode, CarrierDef>(CARRIER_DEFS.map((c) => [c.code, c]));

export function getCarrierLabel(code: CarrierCode): string {
  return CARRIER_BY_CODE.get(code)?.label ?? code;
}

// Transportadoras configuradas para una tienda. Hoy cada tienda tiene una sola
// (su `logisticsProvider`); `store.carriers` permite, mas adelante, declarar
// varias por tienda/pais sin tocar esta logica.
export function getStoreCarriers(store: FinanceStorePublic): CarrierCode[] {
  const declared = store.carriers?.filter((code): code is CarrierCode => CARRIER_BY_CODE.has(code)) ?? [];
  return declared.length ? declared : [store.logisticsProvider];
}

function matchCarrierByLabel(courier: string | null | undefined, candidates: CarrierCode[]): CarrierCode | null {
  const lower = String(courier ?? "").trim().toLowerCase();
  if (!lower) return null;
  for (const code of candidates) {
    const def = CARRIER_BY_CODE.get(code);
    if (def && def.aliases.some((alias) => lower.includes(alias))) return code;
  }
  return null;
}

function matchCarrierByGuide(guide: string | null | undefined, candidates: CarrierCode[]): CarrierCode | null {
  const upper = String(guide ?? "").trim().toUpperCase();
  if (!upper) return null;
  for (const code of candidates) {
    const def = CARRIER_BY_CODE.get(code);
    if (def?.guidePrefix && upper.startsWith(def.guidePrefix)) return code;
  }
  return null;
}

// Resolucion de transportadora POR FILA. Para tiendas mono-transportadora (todas
// las actuales) devuelve esa transportadora, preservando la regla historica de
// "la tienda manda sobre la etiqueta de Shopify desactualizada" (p.ej. Honduras
// usa Forza aunque el fulfillment diga "Moovin"). Para tiendas con varias
// transportadoras desambigua por fila: etiqueta de courier -> prefijo de guia ->
// transportadora primaria de la tienda.
export function resolveRowCarrier(params: {
  courier?: string | null;
  guide?: string | null;
  store: FinanceStorePublic;
}): CarrierCode {
  const carriers = getStoreCarriers(params.store);
  if (carriers.length <= 1) return carriers[0] ?? params.store.logisticsProvider;
  return (
    matchCarrierByLabel(params.courier, carriers) ??
    matchCarrierByGuide(params.guide, carriers) ??
    carriers[0]
  );
}

// Helper para los puntos donde se decide contra que tracking consultar una fila.
// Mantiene EXACTAMENTE el comportamiento actual en tiendas mono-transportadora
// (delega en isMoovinCourier/isForzaCourier sobre el courier ya normalizado) y
// activa la resolucion por fila solo cuando la tienda declara varias.
export function rowMatchesCarrier(
  target: CarrierCode,
  params: {
    // Courier ya normalizado para despliegue (normalizeOperationalCourier).
    displayCourier?: string | null;
    // Courier crudo de la fila (etiqueta original), usado en multi-transportadora.
    rawCourier?: string | null;
    guide?: string | null;
    store: FinanceStorePublic;
  }
): boolean {
  const carriers = getStoreCarriers(params.store);
  if (carriers.length > 1) {
    return resolveRowCarrier({ courier: params.rawCourier, guide: params.guide, store: params.store }) === target;
  }
  if (target === "moovin") return isMoovinCourier(params.displayCourier ?? undefined, params.store);
  if (target === "forza") return isForzaCourier(params.displayCourier ?? undefined, params.store);
  return false;
}

// ---------------------------------------------------------------------------
// Courier / guia  (movido VERBATIM desde finance-orders.ts / page.tsx)
// ---------------------------------------------------------------------------

export function isMoovinCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return false;
  return String(courier ?? "").toLowerCase().includes("moovin");
}

export function isForzaCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return Boolean(String(courier ?? "").trim());
  return String(courier ?? "").toLowerCase().includes("forza");
}

// EasySell/Shopify a veces rotula el fulfillment con un valor generico
// ("Transportadora", "Other", etc.) en vez del courier real. La transportadora
// por defecto depende de la tienda: Costa Rica usa Moovin, Honduras usa Forza.
const GENERIC_COURIER_LABELS = new Set([
  "",
  "transportadora",
  "transportista",
  "other",
  "otra",
  "custom",
  "manual",
  "n/a",
  "na",
  "none",
  "easysell",
]);

export function getDefaultCourierForStore(store: FinanceStorePublic): string {
  return getCarrierLabel(store.logisticsProvider);
}

export function normalizeShopifyCourier(rawCompany: string | undefined, store: FinanceStorePublic): string {
  const company = String(rawCompany ?? "").trim();
  const lower = company.toLowerCase();
  if (GENERIC_COURIER_LABELS.has(lower)) return getDefaultCourierForStore(store);
  if (store.logisticsProvider === "forza") {
    if (lower.includes("forza") || lower.includes("moovin")) return "Forza";
  }
  if (store.logisticsProvider === "moovin" && lower.includes("moovin")) return "Moovin";
  return company;
}

export function normalizeOperationalCourier(
  rawCompany: string | undefined,
  store: FinanceStorePublic,
  guide?: string
): string {
  const company = String(rawCompany ?? "").trim();
  if (company) return normalizeShopifyCourier(company, store);
  return guide ? getDefaultCourierForStore(store) : "";
}

// Normalizacion canonica de guia Forza. Las guias Forza llevan la serie "FD";
// `26827471` y `FD26827471` son la misma guia. Endurecido respecto a la version
// anterior para tolerar separadores/espacios y el artefacto de coma flotante que
// produce Excel cuando lee la guia como numero ("FD-268", "fd 268", "268.0" ->
// "FD268"). Es la unica copia: forza.ts, finance.ts, finance-orders.ts y page.tsx
// la consumen desde aqui.
export function normalizeForzaGuide(guide: string | number | null | undefined): string {
  let value = String(guide ?? "").trim().toUpperCase();
  if (!value) return "";
  value = value.replace(/\.0+$/, ""); // Excel: numero -> "26827471.0"
  value = value.replace(/^FD/, "").replace(/[\s_-]+/g, ""); // quita prefijo y separadores
  if (!value) return "";
  return `FD${value}`;
}

// Numero de guia Forza sin la serie "FD" (lo que espera el parametro GuideNumber
// del endpoint de Forza y la clave de match entre fuentes).
export function forzaGuideNumber(guide: string | number | null | undefined): string {
  return normalizeForzaGuide(guide).replace(/^FD/, "");
}

export function normalizeGuideForStore(guide: string | undefined, store: FinanceStorePublic): string {
  const trimmed = String(guide ?? "").trim();
  if (!trimmed) return "";
  return store.logisticsProvider === "forza" ? normalizeForzaGuide(trimmed) : trimmed;
}

export function buildForzaTrackingMap(rows: ForzaTrackingRow[]): Map<string, ForzaTrackingRow> {
  const map = new Map<string, ForzaTrackingRow>();
  for (const row of rows) {
    const normalized = normalizeForzaGuide(row.guide_number || row.tracking_number);
    if (!normalized) continue;
    map.set(normalized, row);
    map.set(normalized.replace(/^FD/i, ""), row);
    if (row.guide_number) map.set(String(row.guide_number).trim().toUpperCase(), row);
    if (row.tracking_number) map.set(String(row.tracking_number).trim().toUpperCase(), row);
  }
  return map;
}

export function getForzaTrackingFromMap(
  map: Map<string, ForzaTrackingRow>,
  guide: string | undefined
): ForzaTrackingRow | undefined {
  const normalized = normalizeForzaGuide(String(guide ?? ""));
  if (!normalized) return undefined;
  return map.get(normalized) ?? map.get(normalized.replace(/^FD/i, "")) ?? map.get(String(guide).trim().toUpperCase());
}
