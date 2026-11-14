// Lectura de /api/finance/kpis/products en el navegador (Panel). Solo tipos
// del calculo (lib/panel-productos.ts) para no llevar su logica al cliente.
import type { StockAlert, StockAlerts, StockTone, TopProduct, TopProducts } from "./panel-productos";

export type { StockAlert, StockTone, TopProduct };

export type PanelStockView =
  | { status: "ready"; snapshotDate: string | null; uploadedAt: string | null; alerts: StockAlerts }
  | { status: "sin_inventario"; message: string };

export interface PanelProductsView {
  top: TopProducts;
  stock: PanelStockView;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const TONES: StockTone[] = ["out", "red", "yellow"];

function parseTop(value: unknown): TopProducts {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error("Respuesta de productos inválida");
  const items = (value.items as unknown[]).filter(isRecord).map(
    (p): TopProduct => ({
      key: String(p.key ?? ""),
      name: String(p.name ?? ""),
      orders: num(p.orders),
      units: num(p.units),
      previousOrders: numOrNull(p.previousOrders),
      share: numOrNull(p.share),
    })
  );
  return { orders: num(value.orders), distinct: num(value.distinct), items };
}

function parseStock(value: unknown): PanelStockView {
  if (!isRecord(value)) throw new Error("Respuesta de stock inválida");
  if (value.status !== "ready" || !isRecord(value.alerts)) {
    return { status: "sin_inventario", message: String(value.message ?? "Esta tienda no tiene inventario conectado.") };
  }
  const raw = value.alerts;
  const counts = isRecord(raw.counts) ? raw.counts : {};
  const alerts = (Array.isArray(raw.alerts) ? raw.alerts : []).filter(isRecord).flatMap((a): StockAlert[] => {
    const tone = TONES.find((t) => t === a.tone);
    if (!tone) return [];
    return [
      {
        sku: String(a.sku ?? ""),
        name: String(a.name ?? a.sku ?? ""),
        available: num(a.available),
        dailyUnits: num(a.dailyUnits),
        days: num(a.days),
        tone,
        backorder: numOrNull(a.backorder),
      },
    ];
  });
  return {
    status: "ready",
    snapshotDate: typeof value.snapshotDate === "string" ? value.snapshotDate : null,
    uploadedAt: typeof value.uploadedAt === "string" ? value.uploadedAt : null,
    alerts: {
      counts: { out: num(counts.out), red: num(counts.red), yellow: num(counts.yellow) },
      selling: num(raw.selling),
      alerts,
    },
  };
}

export function parseProductsResponse(json: unknown): PanelProductsView {
  if (!isRecord(json)) throw new Error("Respuesta de productos inválida");
  return { top: parseTop(json.top), stock: parseStock(json.stock) };
}

/** Cambio de pedidos contra el periodo anterior: "+12", "−3" o "=". */
export function ordersChange(current: number, previous: number | null): {
  text: string;
  spoken: string;
  direction: "up" | "down" | "flat";
} | null {
  if (previous == null) return null;
  const diff = current - previous;
  if (diff === 0) return { text: "=", spoken: "igual que el periodo anterior", direction: "flat" };
  const abs = Math.abs(diff);
  return diff > 0
    ? { text: `+${abs}`, spoken: `${abs} más que el periodo anterior`, direction: "up" }
    : { text: `−${abs}`, spoken: `${abs} menos que el periodo anterior`, direction: "down" };
}

const ONE = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 1 });

/** "menos de 1 día", "2,5 días". */
export function coverDaysText(days: number): string {
  if (days < 1) return "menos de 1 día";
  return `${ONE.format(days)} ${days === 1 ? "día" : "días"}`;
}

export const formatOne = (value: number) => ONE.format(value);

/** "13 nov" desde YYYY-MM-DD. */
export function shortDay(date: string | null): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(".", "");
}
