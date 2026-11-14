import { describe, expect, it } from "vitest";
import {
  buildStockAlerts,
  buildTopProducts,
  itemTitle,
  lastSevenDays,
  productTitle,
  type ProductRow,
} from "@/lib/panel-productos";
import { coverDaysText, ordersChange, parseProductsResponse, shortDay } from "@/lib/panel-productos-vista";

type Row = ProductRow & { generated?: number; annulled?: number };
const metricsOf = (row: Row) => ({ generated: row.generated ?? 1, annulled: row.annulled ?? 0 });
const item = (title: string, quantity = 1, sku = "") => ({ title, quantity, sku, price: 0 });
const at = (iso: string, items: ReturnType<typeof item>[], extra: Partial<Row> = {}): Row => ({
  shopify_created_at: iso,
  package_items: items,
  ...extra,
});

const T = (iso: string) => new Date(iso).getTime();
const window = {
  curStart: T("2026-11-10T06:00:00Z"),
  curEnd: T("2026-11-13T06:00:00Z"),
  prevStart: T("2026-11-07T06:00:00Z"),
  prevEnd: T("2026-11-10T06:00:00Z"),
};

describe("productTitle", () => {
  it("quita la cantidad y la variante", () => {
    expect(productTitle("2x Faja Reductora - Negro / M")).toBe("Faja Reductora");
    expect(productTitle("Gomitas de colágeno")).toBe("Gomitas de colágeno");
    expect(itemTitle("3x Faja - Negro")).toBe("Faja - Negro");
  });
});

describe("buildTopProducts", () => {
  it("cuenta pedidos y unidades por producto, con el periodo anterior", () => {
    const rows: Row[] = [
      at("2026-11-11T15:00:00Z", [item("2x Faja - Negro / M", 2), item("Faja - Beige / L", 1)]),
      at("2026-11-12T15:00:00Z", [item("Gomitas", 1)]),
      at("2026-11-12T16:00:00Z", [item("1x Faja - Negro / S", 1)]),
      at("2026-11-08T15:00:00Z", [item("Faja - Negro", 1)]),
      at("2026-11-08T16:00:00Z", [item("Gomitas", 1)]),
      at("2026-11-09T16:00:00Z", [item("Gomitas", 1)]),
      // No cuenta (duplicado, lista negra...).
      at("2026-11-12T17:00:00Z", [item("Gomitas", 5)], { generated: 0 }),
      // Fuera de los dos periodos.
      at("2026-11-01T17:00:00Z", [item("Gomitas", 5)]),
    ];
    const top = buildTopProducts(rows, window, metricsOf);
    expect(top.orders).toBe(3);
    expect(top.distinct).toBe(2);
    expect(top.items).toEqual([
      { key: "faja", name: "Faja", orders: 2, units: 4, previousOrders: 1, share: 66.7 },
      { key: "gomitas", name: "Gomitas", orders: 1, units: 1, previousOrders: 2, share: 33.3 },
    ]);
  });

  it("sin periodo anterior no compara", () => {
    const top = buildTopProducts([at("2026-11-11T15:00:00Z", [item("Gomitas")])], { ...window, prevStart: null, prevEnd: null }, metricsOf);
    expect(top.items[0].previousOrders).toBeNull();
  });

  it("respeta el límite", () => {
    const rows = Array.from({ length: 12 }, (_, i) => at("2026-11-11T15:00:00Z", [item(`Producto ${i}`)]));
    expect(buildTopProducts(rows, window, metricsOf, 5).items).toHaveLength(5);
  });
});

describe("buildStockAlerts", () => {
  const tz = "America/Costa_Rica";
  // 14 nov, 10:00 en Costa Rica: los 7 días completos son del 7 al 13.
  const now = new Date("2026-11-14T16:00:00Z");

  it("usa los 7 días completos hasta ayer en la hora de la tienda", () => {
    expect(lastSevenDays(now, tz)).toEqual({ from: "2026-11-07", to: "2026-11-13" });
  });

  it("marca agotados y los que se acaban en menos de 3 y de 7 días", () => {
    const sold = (sku: string, units: number, iso = "2026-11-10T18:00:00Z", extra: Partial<Row> = {}) =>
      at(iso, [item(`${units}x Producto ${sku}`, units, sku)], extra);
    const rows: Row[] = [
      sold("A", 14), // 2/día
      sold("B", 14),
      sold("C", 14),
      sold("D", 14),
      sold("E", 50, "2026-11-10T18:00:00Z", { annulled: 1 }), // anulado: no cuenta
      sold("F", 70, "2026-11-14T15:00:00Z"), // hoy: no es un día completo
      sold("G", 70, "2026-11-06T18:00:00Z"), // antes de los 7 días
    ];
    const stock = [
      { sku: "A", warehouseId: "w", onHand: 0, available: 0, allocated: 0, backorder: 3 },
      { sku: "B", warehouseId: "w", onHand: 4, available: 4, allocated: 0 }, // 2 días
      { sku: "C", warehouseId: "w", onHand: 10, available: 10, allocated: 0 }, // 5 días
      { sku: "D", warehouseId: "w", onHand: 100, available: 100, allocated: 0 }, // 50 días
      { sku: "E", warehouseId: "w", onHand: 0, available: 0, allocated: 0 },
      { sku: "F", warehouseId: "w", onHand: 0, available: 0, allocated: 0 },
      { sku: "G", warehouseId: "w", onHand: 0, available: 0, allocated: 0 },
      { sku: "H", warehouseId: "w", onHand: 0, available: 0, allocated: 0 }, // sin ventas
    ];
    const result = buildStockAlerts({ rows, stock, metricsOf, index: null, now, timeZone: tz });
    expect(result.counts).toEqual({ out: 1, red: 1, yellow: 1 });
    expect(result.selling).toBe(4);
    expect(result.alerts.map((a) => [a.sku, a.tone, a.days])).toEqual([
      ["A", "out", 0],
      ["B", "red", 2],
      ["C", "yellow", 5],
    ]);
    expect(result.alerts[0]).toMatchObject({ name: "Producto A", dailyUnits: 2, backorder: 3, available: 0 });
  });

  it("omite un SKU repetido en el inventario", () => {
    const rows: Row[] = [at("2026-11-10T18:00:00Z", [item("Faja", 7, "x1")])];
    const stock = [
      { sku: "X1", warehouseId: "a", onHand: 0, available: 0, allocated: 0 },
      { sku: "x1", warehouseId: "b", onHand: 0, available: 0, allocated: 0 },
    ];
    expect(buildStockAlerts({ rows, stock, metricsOf, index: null, now, timeZone: tz }).alerts).toEqual([]);
  });
});

describe("vista de productos", () => {
  it("lee la respuesta y tolera inventario ausente", () => {
    const view = parseProductsResponse({
      top: { orders: 3, distinct: 1, items: [{ key: "a", name: "A", orders: 3, units: 4, previousOrders: 1, share: 100 }] },
      stock: { status: "sin_inventario", message: "Esta tienda no tiene inventario conectado en Kairo." },
    });
    expect(view.top.items[0].name).toBe("A");
    expect(view.stock).toEqual({ status: "sin_inventario", message: "Esta tienda no tiene inventario conectado en Kairo." });
    expect(() => parseProductsResponse({})).toThrow();
  });

  it("descarta tonos desconocidos", () => {
    const view = parseProductsResponse({
      top: { orders: 0, distinct: 0, items: [] },
      stock: {
        status: "ready",
        snapshotDate: "2026-11-13",
        alerts: {
          counts: { out: 1, red: 0, yellow: 0 },
          selling: 2,
          alerts: [
            { sku: "A", name: "A", available: 0, dailyUnits: 1, days: 0, tone: "out", backorder: null },
            { sku: "B", name: "B", available: 0, dailyUnits: 1, days: 0, tone: "raro" },
          ],
        },
      },
    });
    expect(view.stock.status === "ready" && view.stock.alerts.alerts.map((a) => a.sku)).toEqual(["A"]);
  });

  it("textos", () => {
    expect(ordersChange(5, 2)?.text).toBe("+3");
    expect(ordersChange(2, 5)?.text).toBe("−3");
    expect(ordersChange(2, 2)?.text).toBe("=");
    expect(ordersChange(2, null)).toBeNull();
    expect(coverDaysText(0.4)).toBe("menos de 1 día");
    expect(coverDaysText(2.5)).toBe("2,5 días");
    expect(shortDay("2026-11-13")).toBe("13 nov");
  });
});
