// Filtro de periodo del tab Pedidos: mismos días que los KPIs de Gestión.
//
// POR QUE ESTE TEST EXISTE: Gestión corta los días en la hora de la tienda. Si
// Pedidos cortara en UTC, un pedido de las 7 p. m. de Costa Rica caería en el
// día siguiente y la lista no cuadraría con las tarjetas para las mismas fechas.
import { describe, expect, it } from "vitest";
import { dayKeyFormatter, matchesPeriod } from "../lib/finance-order-period";
import type { TrackableOrderRow } from "../lib/finance-orders";

const CR = dayKeyFormatter("America/Costa_Rica");
const row = (iso: string) => ({ shopify_created_at: iso }) as TrackableOrderRow;
// 2026-11-04 01:00 UTC = 2026-11-03 19:00 en Costa Rica.
const noche = row("2026-11-04T01:00:00Z");
const now = new Date("2026-11-04T02:00:00Z"); // 03/11 20:00 CR

describe("periodo del tab Pedidos en la hora de la tienda", () => {
  it("rango y mes usan el día de Costa Rica", () => {
    expect(matchesPeriod(noche, "range", "", "2026-11-03", "2026-11-03", now, CR)).toBe(true);
    expect(matchesPeriod(noche, "range", "", "2026-11-04", "2026-11-04", now, CR)).toBe(false);
    expect(matchesPeriod(row("2026-11-01T03:00:00Z"), "month", "2026-10", "", "", now, CR)).toBe(true);
  });
  it("Hoy y 7 días cuentan días completos de la tienda", () => {
    expect(matchesPeriod(row("2026-11-03T07:00:00Z"), "today", "", "", "", now, CR)).toBe(true);
    expect(matchesPeriod(row("2026-11-03T05:00:00Z"), "today", "", "", "", now, CR)).toBe(false);
    expect(matchesPeriod(row("2026-10-28T07:00:00Z"), "7d", "", "", "", now, CR)).toBe(true);
    expect(matchesPeriod(row("2026-10-27T07:00:00Z"), "7d", "", "", "", now, CR)).toBe(false);
  });
  it("sin fecha no entra salvo en Todo", () => {
    expect(matchesPeriod(row(""), "range", "", "2026-11-03", "2026-11-03", now, CR)).toBe(false);
    expect(matchesPeriod(row(""), "all", "", "", "", now, CR)).toBe(true);
  });
});
