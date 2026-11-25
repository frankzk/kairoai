// Filtros por métrica de Marketing › Publicidad (lib/marketing-publicidad.ts):
// "2 compras o más", "costo por compra de 6,50 o menos", "CTR entre 2 y 3 %".
import { describe, expect, it } from "vitest";
import {
  applyMetricFilters,
  matchesMetricFilter,
  metricFilterText,
  metricFilterValue,
  parseFilterNumber,
  publicidadRowUsd,
  type PublicidadRow,
} from "../lib/marketing-publicidad";

const row = (over: Partial<PublicidadRow>): PublicidadRow => ({
  id: "c1",
  name: "Campaña",
  accountId: "123",
  accountName: "Mireva CR",
  currency: "USD",
  status: "active",
  statusLabel: "Activo",
  budget: null,
  spend: 0,
  impressions: 0,
  clicks: 0,
  purchases: 0,
  purchaseValue: 0,
  leads: 0,
  results: null,
  costPerResult: null,
  ...over,
});
const usd = (over: Partial<PublicidadRow>) => publicidadRowUsd(row(over), null);

const rows = [
  usd({ id: "sin", spend: 6, impressions: 1000, clicks: 20, purchases: 0 }),
  usd({ id: "una", spend: 6.08, impressions: 1000, clicks: 30, purchases: 1 }),
  usd({ id: "dos", spend: 10, impressions: 2000, clicks: 45, purchases: 2 }),
  usd({
    id: "muchas",
    spend: 69.91,
    impressions: 9000,
    clicks: 400,
    purchases: 22,
    results: 14,
    costPerResult: 4.99,
  }),
];
const ids = (list: typeof rows) => list.map((r) => r.id);

describe("valor que compara cada filtro", () => {
  it("usa la unidad de la tabla: conteos, USD y CTR en porcentaje", () => {
    const muchas = rows[3];
    expect(metricFilterValue(muchas, "purchases")).toBe(22);
    expect(metricFilterValue(muchas, "spend")).toBe(69.91);
    expect(metricFilterValue(muchas, "costPerPurchase")).toBeCloseTo(3.18, 2);
    expect(metricFilterValue(muchas, "costPerResult")).toBe(4.99);
    // 400 / 9000 = 4,44 %
    expect(metricFilterValue(muchas, "ctr")).toBeCloseTo(4.44, 2);
  });

  it("sin el evento, el conteo es 0; un costo o un CTR sin base no existe", () => {
    const sin = rows[0];
    expect(metricFilterValue(sin, "purchases")).toBe(0);
    expect(metricFilterValue(sin, "results")).toBe(0);
    expect(metricFilterValue(sin, "costPerPurchase")).toBeNull();
    expect(metricFilterValue(sin, "costPerResult")).toBeNull();
    expect(metricFilterValue(usd({}), "ctr")).toBeNull();
  });
});

describe("condiciones", () => {
  it("o más, o menos, exactamente y entre (en cualquier orden)", () => {
    expect(matchesMetricFilter(2, { op: "gte", value: 2 })).toBe(true);
    expect(matchesMetricFilter(1, { op: "gte", value: 2 })).toBe(false);
    expect(matchesMetricFilter(2, { op: "lte", value: 2 })).toBe(true);
    expect(matchesMetricFilter(3, { op: "lte", value: 2 })).toBe(false);
    expect(matchesMetricFilter(1, { op: "eq", value: 1 })).toBe(true);
    expect(matchesMetricFilter(2, { op: "eq", value: 1 })).toBe(false);
    expect(matchesMetricFilter(3, { op: "between", value: 5, value2: 2 })).toBe(
      true,
    );
    expect(matchesMetricFilter(6, { op: "between", value: 2, value2: 5 })).toBe(
      false,
    );
  });

  it("compara a dos decimales, como se ve en la tabla", () => {
    // 6,083 se muestra 6,08: cumple "6,08 o menos" y "exactamente 6,08".
    expect(matchesMetricFilter(6.083, { op: "lte", value: 6.08 })).toBe(true);
    expect(matchesMetricFilter(6.083, { op: "eq", value: 6.08 })).toBe(true);
    expect(matchesMetricFilter(6.09, { op: "lte", value: 6.08 })).toBe(false);
  });

  it("una fila sin el valor nunca cumple", () => {
    expect(matchesMetricFilter(null, { op: "lte", value: 100 })).toBe(false);
    expect(matchesMetricFilter(NaN, { op: "gte", value: 0 })).toBe(false);
  });
});

describe("filas que pasan los filtros", () => {
  it("sin filtros devuelve las mismas filas", () => {
    expect(applyMetricFilters(rows, {})).toBe(rows);
  });

  it("solo una compra, 2 o menos (incluye las que no tienen) y 2 o más", () => {
    expect(
      ids(applyMetricFilters(rows, { purchases: { op: "eq", value: 1 } })),
    ).toEqual(["una"]);
    expect(
      ids(applyMetricFilters(rows, { purchases: { op: "lte", value: 2 } })),
    ).toEqual(["sin", "una", "dos"]);
    expect(
      ids(applyMetricFilters(rows, { purchases: { op: "gte", value: 2 } })),
    ).toEqual(["dos", "muchas"]);
  });

  it("un filtro de costo deja fuera las filas sin compras o sin resultados", () => {
    expect(
      ids(
        applyMetricFilters(rows, { costPerPurchase: { op: "lte", value: 5.5 } }),
      ),
    ).toEqual(["dos", "muchas"]);
    expect(
      ids(applyMetricFilters(rows, { costPerResult: { op: "lte", value: 10 } })),
    ).toEqual(["muchas"]);
  });

  it("varios filtros se cumplen a la vez", () => {
    expect(
      ids(
        applyMetricFilters(rows, {
          purchases: { op: "gte", value: 1 },
          ctr: { op: "between", value: 2, value2: 3.5 },
        }),
      ),
    ).toEqual(["una", "dos"]);
  });
});

describe("lo que se escribe y lo que se muestra", () => {
  it("lee números con coma, punto, miles, signo de moneda o porcentaje", () => {
    expect(parseFilterNumber("2")).toBe(2);
    expect(parseFilterNumber("2,5")).toBe(2.5);
    expect(parseFilterNumber("2.5")).toBe(2.5);
    expect(parseFilterNumber(" $6,50 ")).toBe(6.5);
    expect(parseFilterNumber("3%")).toBe(3);
    expect(parseFilterNumber("1 200,50")).toBe(1200.5);
    expect(parseFilterNumber("1.200,50")).toBe(1200.5);
    expect(parseFilterNumber("1,200.50")).toBe(1200.5);
  });

  it("lo que no es un número no filtra", () => {
    expect(parseFilterNumber("")).toBeNull();
    expect(parseFilterNumber("abc")).toBeNull();
    expect(parseFilterNumber("1.2.3")).toBeNull();
  });

  it("escribe la condición corta para el encabezado", () => {
    const n = (value: number) => String(value);
    expect(metricFilterText({ op: "gte", value: 2 }, n)).toBe("≥ 2");
    expect(metricFilterText({ op: "lte", value: 6.5 }, n)).toBe("≤ 6.5");
    expect(metricFilterText({ op: "eq", value: 1 }, n)).toBe("= 1");
    expect(metricFilterText({ op: "between", value: 5, value2: 2 }, n)).toBe(
      "2 – 5",
    );
  });
});
