import { describe, expect, it } from "vitest";
import {
  averagePerDay,
  buildFunnel,
  buildPanelMetrics,
  chartRangeFor,
  comparisonSentence,
  comparisonLabel,
  compactMoneyFormatter,
  dayLabel,
  moneyFormatter,
  parseDailyResponse,
  parseKpisResponse,
  pctChange,
  ppChange,
  splitDay,
  type PanelOpMetrics,
} from "../lib/panel-resumen";

const m = (over: Partial<PanelOpMetrics> = {}): PanelOpMetrics => ({
  generated: 200,
  dispatched: 120,
  delivered: 90,
  notDelivered: 10,
  annulled: 30,
  annulledExcluded: 4,
  enRoute: 15,
  enRouteRetry: 5,
  confirmed: 150,
  confirmedNotDispatched: 30,
  inProgress: 20,
  deliveryRate: 75,
  dispatchRate: 60,
  annulRate: 15,
  confirmRate: 75,
  ticket: 25000,
  ...over,
});

const crc = moneyFormatter("es-CR", "₡");
const byId = (list: ReturnType<typeof buildPanelMetrics>, id: string) => list.find((x) => x.id === id)!;

describe("periodos", () => {
  it("un solo dia se grafica en el contexto de 7 dias", () => {
    expect(chartRangeFor("today")).toBe("7d");
    expect(chartRangeFor("yesterday")).toBe("7d");
    expect(chartRangeFor("30d")).toBe("30d");
    expect(chartRangeFor("month")).toBe("month");
  });

  it("la comparacion sale del texto compartido con Gestion y falta sin ventana previa", () => {
    expect(comparisonLabel("7d", { prevStart: 1, prevEnd: 2, compareLabel: "" })).toBe("vs. 7 días previos");
    expect(comparisonLabel("today", { prevStart: 1, prevEnd: 2, compareLabel: "" })).toBe("vs. ayer");
    expect(comparisonLabel("month", { prevStart: null, prevEnd: null, compareLabel: "" })).toBeNull();
    expect(comparisonLabel("7d", null)).toBeNull();
  });
});

describe("formatos", () => {
  it("moneda con el simbolo de la tienda", () => {
    expect(crc(12345.6).replace(/\s/g, " ")).toBe("₡12 346");
    expect(moneyFormatter("es-HN", "L")(1234).startsWith("L ")).toBe(true);
    expect(compactMoneyFormatter("₡")(1_250_000)).toBe("₡1,3 M");
    expect(compactMoneyFormatter("₡")(850_000)).toBe("₡850 k");
    expect(compactMoneyFormatter("L")(2_000_000)).toBe("L 2 M");
  });

  it("etiqueta de dia corta, sin puntos", () => {
    expect(dayLabel("2026-11-13")).toMatch(/^13 nov$/);
  });
});

describe("cambios", () => {
  it("porcentaje sin base cuando el anterior es cero", () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(10, null)).toBeNull();
    expect(pctChange(110, 100)).toBeCloseTo(10);
  });
  it("puntos porcentuales solo con las dos tasas", () => {
    expect(ppChange(70, null)).toBeNull();
    expect(ppChange(72.5, 70)).toBeCloseTo(2.5);
  });
});

describe("buildPanelMetrics", () => {
  const sales = {
    current: { generated: 200, valueOrders: 198, value: 4_950_000, deliveredValue: 2_250_000 },
    previous: { generated: 180, valueOrders: 180, value: 4_500_000, deliveredValue: 2_000_000 },
  };

  it("siete metricas en orden, con detalle de donde sale cada una", () => {
    const list = buildPanelMetrics({ current: m(), previous: m({ generated: 160 }), sales, versus: "vs. 7 días previos", money: crc });
    expect(list.map((x) => x.id)).toEqual(["generated", "confirm", "dispatch", "delivery", "annul", "ticket", "sales"]);
    expect(byId(list, "confirm").detail).toBe("150 confirmados");
    expect(byId(list, "delivery").detail).toBe("90 entregados");
    expect(byId(list, "generated").detail).toBe("4 no cuentan");
    expect(byId(list, "sales").detail).toMatch(/entregado$/);
  });

  it("conteos en %, tasas en pp; la anulacion que baja es buena", () => {
    const list = buildPanelMetrics({
      current: m(),
      previous: m({ generated: 160, confirmRate: 70, annulRate: 18, dispatchRate: 60 }),
      sales,
      versus: "vs. 7 días previos",
      money: crc,
    });
    expect(byId(list, "generated").delta).toMatchObject({ text: "+25,0 %", direction: "up", tone: "good" });
    expect(byId(list, "confirm").delta).toMatchObject({ text: "+5,0 pp", tone: "good" });
    expect(byId(list, "annul").delta).toMatchObject({ text: "−3,0 pp", direction: "down", tone: "good" });
    expect(byId(list, "dispatch").delta).toMatchObject({ text: "Sin cambio", direction: "flat", tone: "neutral" });
    expect(byId(list, "sales").delta).toMatchObject({ text: "+10,0 %", tone: "good" });
    expect(byId(list, "confirm").previous).toBe("70,0 %");
    expect(byId(list, "annul").delta?.spoken).toBe("Baja 3,0 pp vs. 7 días previos");
  });

  it("sin comparacion (periodo sin ventana previa) ninguna metrica lleva delta", () => {
    const list = buildPanelMetrics({ current: m(), previous: m(), sales, versus: null, money: crc });
    expect(list.every((x) => x.delta === null && x.previous === null)).toBe(true);
  });

  it("sin pedidos las tasas no inventan un 0 %", () => {
    const empty = m({ generated: 0, dispatched: 0, delivered: 0, annulled: 0, confirmed: 0, confirmRate: null, dispatchRate: 0, annulRate: 0, deliveryRate: 0, ticket: 0 });
    const list = buildPanelMetrics({ current: empty, previous: m(), sales: null, versus: "vs. ayer", money: crc });
    expect(byId(list, "confirm").value).toBe("—");
    expect(byId(list, "dispatch").value).toBe("—");
    expect(byId(list, "delivery").value).toBe("—");
    expect(byId(list, "ticket").value).toBe("—");
    expect(byId(list, "confirm").delta).toBeNull();
    expect(byId(list, "generated").delta).toMatchObject({ direction: "down", tone: "bad" });
  });

  it("si la serie de ventas no vino, Ventas dice que no esta disponible", () => {
    const list = buildPanelMetrics({ current: m(), previous: m(), sales: null, versus: "vs. ayer", money: crc });
    expect(byId(list, "sales")).toMatchObject({ value: "Sin datos", unavailable: true, delta: null });
  });

  it("base anterior en cero: sin delta en vez de un infinito", () => {
    const list = buildPanelMetrics({
      current: m(),
      previous: m({ generated: 0, dispatched: 0, ticket: 0 }),
      sales,
      versus: "vs. ayer",
      money: crc,
    });
    expect(byId(list, "generated").delta).toBeNull();
    expect(byId(list, "delivery").delta).toBeNull();
    expect(byId(list, "ticket").delta).toBeNull();
  });
});

describe("embudo y dias", () => {
  it("embudo con % sobre generados y el resto aparte", () => {
    const f = buildFunnel(m());
    expect(f.steps.map((s) => [s.id, s.value, s.share])).toEqual([
      ["generated", 200, 100],
      ["confirmed", 150, 75],
      ["dispatched", 120, 60],
      ["delivered", 90, 45],
    ]);
    expect(f.aside.find((a) => a.id === "enRoute")?.value).toBe(20);
    expect(buildFunnel(m({ generated: 0 })).steps[0].share).toBeNull();
  });

  it("las partes del dia suman los generados", () => {
    const day = { date: "2026-11-12", generated: 50, confirmed: 35, dispatched: 30, delivered: 20, annulled: 8, value: 0 };
    const parts = splitDay(day);
    expect(parts).toEqual({ delivered: 20, shipped: 10, noGuide: 5, working: 7, annulled: 8 });
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(50);
  });

  it("promedio por dia", () => {
    expect(averagePerDay([])).toBeNull();
    expect(
      averagePerDay([
        { date: "a", generated: 10, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, value: 0 },
        { date: "b", generated: 20, confirmed: 0, dispatched: 0, delivered: 0, annulled: 0, value: 0 },
      ])
    ).toBe(15);
  });
});

describe("comparisonSentence", () => {
  it("convierte el compareLabel de las ventanas en una frase", () => {
    expect(comparisonSentence("vs. 7 días previos, misma hora")).toBe("Comparado con 7 días previos, misma hora");
    expect(comparisonSentence("mes anterior sin día equivalente")).toBe("Mes anterior sin día equivalente");
    expect(comparisonSentence("")).toBeNull();
    expect(comparisonSentence(undefined)).toBeNull();
  });
});

describe("respuestas", () => {
  it("KPIs: exige las metricas actuales y tolera la anterior nula", () => {
    const parsed = parseKpisResponse({ current: m(), previous: null, window: { prevStart: 1, prevEnd: 2, compareLabel: "vs. ayer", maturing: true } });
    expect(parsed.previous).toBeNull();
    expect(parsed.window).toMatchObject({ prevStart: 1, compareLabel: "vs. ayer", maturing: true });
    expect(() => parseKpisResponse({ error: "x" })).toThrow();
  });

  it("serie: exige dias y totales", () => {
    const current = { generated: 1, valueOrders: 1, value: 10, deliveredValue: 0 };
    const parsed = parseDailyResponse({ days: [{ date: "2026-11-12", generated: 1 }, "x"], current, previous: null });
    expect(parsed.days).toHaveLength(1);
    expect(parsed.previous).toBeNull();
    expect(() => parseDailyResponse({ days: [] })).toThrow();
  });
});
