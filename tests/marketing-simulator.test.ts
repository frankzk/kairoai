import { describe, expect, it } from "vitest";
import {
  cancelFactor,
  simulateOrders,
  simulatorDefaults,
  simulatorReference,
  type SimulatorInput,
} from "../lib/marketing-simulator";
import type { RealOrderDay } from "../lib/marketing-real-orders";
import type {
  CampaignEstimates,
  CampaignRealDay,
  SpendRow,
} from "../lib/marketing-real-cpa";
import type { OrderFactRow } from "../lib/marketing-insights-types";

const base: SimulatorInput = {
  spendUsd: 1700,
  cpaRealUsd: 8.5,
  otherRealPerDay: 0,
  cancelRateNow: 0.2,
  cancelRateTarget: 0.2,
  extraCartsPerDay: 0,
  extraRepeatPerDay: 0,
};

describe("simulateOrders", () => {
  it("1.700 a CPA 8,50 = 200 pedidos sin cambiar la anulación", () => {
    const result = simulateOrders(base);
    expect(result.k).toBe(1);
    expect(result.adOrders).toBeCloseTo(200);
    expect(result.total).toBeCloseTo(200);
    expect(result.gap).toBe(0);
    expect(result.spendForGoal).toBeCloseTo(1700);
    expect(result.cpaForGoal).toBeCloseTo(8.5);
  });

  it("bajar la anulación de 20 % a 15 % multiplica por 1,0625", () => {
    expect(cancelFactor(0.2, 0.15)).toBeCloseTo(1.0625);
    const result = simulateOrders({ ...base, cancelRateTarget: 0.15 });
    expect(result.adOrders).toBeCloseTo(212.5);
    expect(result.otherOrders).toBe(0);
  });

  it("las palancas son pedidos creados: se les quita la anulación meta", () => {
    const result = simulateOrders({
      ...base,
      spendUsd: 0,
      extraCartsPerDay: 10,
      extraRepeatPerDay: 10,
      cancelRateTarget: 0.1,
    });
    expect(result.leverOrders).toBeCloseTo(18);
    expect(result.breakdown.find((b) => b.code === "carts")?.orders).toBeCloseTo(
      9,
    );
  });

  it("gasto y CPA para la meta son inversos de la fórmula", () => {
    const input = { ...base, spendUsd: 1000, otherRealPerDay: 20 };
    const result = simulateOrders(input);
    expect(result.total).toBeCloseTo(1000 / 8.5 + 20);
    expect(result.gap).toBeCloseTo(200 - result.total);
    // Con el gasto sugerido se llega justo a 200.
    const atSpend = simulateOrders({
      ...input,
      spendUsd: result.spendForGoal!,
    });
    expect(atSpend.total).toBeCloseTo(200);
    // Con el CPA sugerido y el mismo gasto, también.
    const atCpa = simulateOrders({ ...input, cpaRealUsd: result.cpaForGoal! });
    expect(atCpa.total).toBeCloseTo(200);
  });

  it("meta cubierta sin publicidad: gasto 0, CPA sin dato", () => {
    const result = simulateOrders({ ...base, otherRealPerDay: 250 });
    expect(result.spendForGoal).toBe(0);
    expect(result.cpaForGoal).toBeNull();
    expect(result.gap).toBe(0);
  });

  it("CPA 0 o negativo no divide por cero", () => {
    const result = simulateOrders({ ...base, cpaRealUsd: 0 });
    expect(result.adOrders).toBe(0);
    expect(result.spendForGoal).toBeNull();
    expect(Number.isFinite(result.cpaForGoal!)).toBe(true);
    const negative = simulateOrders({ ...base, cpaRealUsd: -3, spendUsd: -5 });
    expect(negative.adOrders).toBe(0);
    expect(negative.cpaForGoal).toBeNull();
  });

  it("anulación de hoy al 100 % no explota", () => {
    expect(cancelFactor(1, 0.2)).toBe(1);
    expect(cancelFactor(Number.NaN, 0)).toBe(1);
  });
});

const TODAY = "2026-11-05";
const day = (
  date: string,
  created: number,
  real: number,
): RealOrderDay => ({
  date,
  created,
  real,
  withCampaign: 0,
  byCampaign: {},
  byAd: {},
  unlinkedBySku: {},
  unlinkedNoProduct: 0,
});
const dates = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 23 + i));
  return d.toISOString().slice(0, 10);
}); // 2026-10-23 .. 2026-11-05

describe("simulatorDefaults", () => {
  // 10 creados y 8 reales por día; Meta 100 USD/día y 5 pedidos reales de campaña.
  const days = dates.map((date) => day(date, 10, 8));
  const estimate = (total: number | null): CampaignRealDay => ({
    utm: 0,
    assigned: total ?? 0,
    total,
    partial: false,
  });
  const metaKey = "meta:1:c1",
    tiktokKey = "tiktok:2:t1";
  const estimates: CampaignEstimates = new Map([
    [metaKey, new Map(dates.map((d) => [d, estimate(5)]))],
    [
      tiktokKey,
      new Map(dates.map((d) => [d, estimate(d === "2026-11-04" ? null : 1)])),
    ],
  ]);
  const spend: SpendRow[] = dates.flatMap((date) => [
    {
      platform: "meta" as const,
      accountId: "1",
      campaignId: "c1",
      date,
      spendUsd: 100,
    },
    {
      platform: "tiktok" as const,
      accountId: "2",
      campaignId: "t1",
      date,
      // TikTok llega al día siguiente: ayer sin dato.
      spendUsd: date === "2026-11-04" || date === TODAY ? null : 20,
    },
  ]);

  it("usa 7 días completos y saca el día que TikTok no reportó", () => {
    const result = simulatorDefaults({
      days,
      estimates,
      spend,
      facts: null,
      today: TODAY,
    });
    // Ventana 29 oct – 4 nov sin el 4 nov = 6 días.
    expect(result.window).toEqual({
      from: "2026-10-29",
      to: "2026-11-03",
      days: 6,
    });
    expect(result.values.spendUsd).toBe(120);
    // 720 USD / (6 × (5 + 1)) = 20
    expect(result.values.cpaRealUsd).toBe(20);
    // otros = 8 − 6 por día
    expect(result.values.otherRealPerDay).toBe(2);
    expect(result.values.cancelRateNow).toBeCloseTo(0.2);
    expect(result.values.cancelRateTarget).toBe(result.values.cancelRateNow);
    expect(result.values.extraCartsPerDay).toBe(0);
    expect(result.notes.join(" ")).toMatch(/4 nov/);
    // Anulación solo con días cerrados: hasta hoy − 2.
    expect(result.cancelWindow.to).toBe("2026-11-03");
    expect(result.cancelWindow.days).toBe(7);
  });

  it("con los pedidos de iComfly, la anulación de hoy se cuenta como en Cancelaciones", () => {
    const facts: OrderFactRow[] = [
      ...Array.from({ length: 8 }, (): OrderFactRow => ["2026-11-03", 0, "", "formulario", "", [0]]),
      ["2026-11-03", 1, "cliente_cancelo", "formulario", "", [0]],
      ["2026-11-03", 1, "otro", "formulario", "", [0]],
      // Reemplazo por upsell y Testeos: fuera de la tasa.
      ["2026-11-03", 1, "upsell", "formulario", "", [0]],
      ["2026-11-03", 2, "", "formulario", "", [0]],
      // Día abierto: no entra.
      ["2026-11-04", 1, "otro", "formulario", "", [0]],
    ];
    const result = simulatorDefaults({
      days,
      estimates,
      spend,
      facts: {
        facts,
        to: TODAY,
        loadedFrom: "2026-10-01",
        repeat: { status: "ok", days: [] },
      },
      today: TODAY,
    });
    expect(result.values.cancelRateNow).toBe(0.2);
    expect(result.cancelSource).toBe("cancelaciones");
    expect(result.cancelWindow).toEqual({
      from: "2026-11-03",
      to: "2026-11-03",
      days: 1,
    });
    expect(result.notes.join(" ")).not.toMatch(/todos los pedidos/);
    // Sin los pedidos de iComfly: todos los pedidos del control, y lo dice.
    const fallback = simulatorDefaults({
      days,
      estimates,
      spend,
      facts: null,
      today: TODAY,
    });
    expect(fallback.cancelSource).toBe("todos");
    expect(fallback.notes.join(" ")).toMatch(/todos los pedidos/);
  });

  it("sin pedidos de campaña usa el CPA meta y sin días usa las metas", () => {
    const empty = simulatorDefaults({
      days: [],
      estimates: new Map(),
      spend: [],
      facts: null,
      today: TODAY,
    });
    expect(empty.values.spendUsd).toBe(1700);
    expect(empty.values.cpaRealUsd).toBe(8.5);
    expect(empty.window.days).toBe(0);
    const noAds = simulatorDefaults({
      days,
      estimates: new Map(),
      spend: spend.filter((s) => s.platform === "meta"),
      facts: null,
      today: TODAY,
    });
    expect(noAds.values.cpaRealUsd).toBe(8.5);
    expect(noAds.notes.join(" ")).toMatch(/CPA meta/);
  });
});

describe("simulatorReference", () => {
  const fact = (
    date: string,
    origin: OrderFactRow[3],
    state: 0 | 1 = 0,
  ): OrderFactRow => [date, state, "", origin, "", [0]];
  it("cuenta carritos y bot reales por día y recompras del RPC", () => {
    const facts = [
      ...Array.from({ length: 14 }, () => fact("2026-11-04", "carrito")),
      fact("2026-11-04", "carrito", 1),
      ...Array.from({ length: 7 }, () => fact("2026-10-29", "bot")),
      fact("2026-11-05", "bot"), // hoy: no entra
      fact("2026-10-20", "bot"), // fuera de la semana
    ];
    const ref = simulatorReference(
      {
        facts,
        to: TODAY,
        loadedFrom: "2026-10-01",
        repeat: {
          status: "ok",
          days: [
            { date: "2026-11-01", orders: 100, repeat: 14 },
            { date: "2026-11-05", orders: 50, repeat: 50 },
          ],
        },
      },
      TODAY,
    );
    expect(ref.from).toBe("2026-10-29");
    expect(ref.to).toBe("2026-11-04");
    expect(ref.cartsPerDay).toBe(2);
    expect(ref.botPerDay).toBe(1);
    expect(ref.repeatPerDay).toBe(2);
  });

  it("recompra sin migración queda sin dato", () => {
    const ref = simulatorReference(
      {
        facts: [],
        to: TODAY,
        loadedFrom: "2026-10-01",
        repeat: { status: "pending_migration", days: [] },
      },
      TODAY,
    );
    expect(ref.repeatPerDay).toBeNull();
    expect(ref.repeatStatus).toBe("pending_migration");
    expect(ref.cartsPerDay).toBe(0);
  });
});
