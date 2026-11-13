import { describe, expect, it } from "vitest";
import {
  buildCampaignDecisions,
  buildCreativeDecisions,
  decideCampaign,
  decisionChanges,
  decisionCounts,
  DECISION_RULES,
  learningChange,
  todayAlert,
  budgetText,
  doneDetail,
  findDoneMark,
  parseDoneMark,
  suggestedBudget,
  type CampaignDecision,
} from "../lib/marketing-decisions";
import type { CampaignActionRow, Window } from "../lib/marketing-actions";
import { coverageOf } from "../lib/marketing-coverage";
import type { CampaignChange } from "../lib/marketing-source-types";
import type {
  CharlieAccount,
  CharlieDay,
  CharlieReport,
} from "../lib/marketing-charlie-types";
import type {
  CampaignEstimates,
  CampaignRealDay,
} from "../lib/marketing-real-cpa";
import type { RealOrderDay } from "../lib/marketing-real-orders";

const now = new Date("2026-11-13T20:35:00Z"); // 14:35 CR, 13 nov
const TODAY = "2026-11-13";
const WINDOW = ["2026-11-10", "2026-11-11", "2026-11-12"];
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/ | /g, " "));
const hoursAgo = (h: number) =>
  new Date(now.getTime() - h * 3_600_000).toISOString();
const w = (patch: Partial<Window> = {}): Window => ({
  spendNative: 0,
  spendUsd: 0,
  pixel: 0,
  real: 0,
  utm: 0,
  partial: false,
  cpaReal: null,
  cpaPixel: null,
  ...patch,
});
/** 3-day window with spend and real orders (CPA = spend / real). */
const days3 = (spend: number, real: number, patch: Partial<Window> = {}) =>
  w({
    spendNative: spend,
    spendUsd: spend,
    real,
    cpaReal: real > 0 ? spend / real : null,
    ...patch,
  });
const row = (patch: Partial<CampaignActionRow> = {}): CampaignActionRow => ({
  key: "meta:1:9",
  platform: "meta",
  accountId: "1",
  accountLabel: "CR4",
  campaignId: "9",
  name: "CBO GOMITAS | CR",
  type: "CBO",
  status: "activa",
  currency: "USD",
  dailyBudget: 50,
  bid: null,
  bidMixed: false,
  product: { key: "family:1", name: "Gomitas", automatic: true, reason: "" },
  coverage: coverageOf(100, 70),
  restocked: null,
  restockedFromLow: null,
  stockStale: null,
  dataThrough: TODAY,
  today: w(),
  yesterday: w({ spendNative: 30, spendUsd: 30 }),
  days3: days3(80, 10),
  days7: w(),
  launch: {
    date: "2026-10-01",
    ageDays: 43,
    lifetimeSpendNative: 900,
    testSpend: 900,
    lifetimeReal: null,
    lifetimePixel: 80,
    inTest: false,
  },
  lastChange: null,
  lastStatusChange: null,
  changesStatus: "activity",
  action: { code: "mantener", label: "Mantener", tone: "info", detail: "" },
  notes: [],
  ...patch,
});
const change = (
  h: number,
  kind: CampaignChange["kind"] = "presupuesto",
  campaignId = "9",
): CampaignChange => ({
  platform: "meta",
  accountId: "1",
  campaignId,
  at: hoursAgo(h),
  kind,
  detail: "",
  source: "meta",
});
const decide = (r: CampaignActionRow, changes: CampaignChange[] = []) =>
  plain(decideCampaign(r, { now, changes }));
const action = (r: CampaignActionRow, changes: CampaignChange[] = []) =>
  decide(r, changes)?.action;

describe("reglas de decisión (ventana de 3 días completos, CPA real)", () => {
  it("keeps the agreed thresholds as named constants", () => {
    expect(DECISION_RULES).toMatchObject({
      windowDays: 3,
      targetCpaUsd: 8.5,
      scaleMinRealOrders: 5,
      lowerMaxCpaUsd: 11,
      killNoOrdersSpendUsd: 17,
      costCapMoreThanOrders: 5,
      costCapMaxCpaUsd: 6,
      learningHours: 72,
      scaleStep: 0.2,
      reduceStep: 0.2,
    });
  });

  it("redondea el presupuesto sugerido a la moneda de la cuenta", () => {
    expect(suggestedBudget(50, 0.2, "USD")).toBe(60);
    expect(suggestedBudget(50, -0.2, "USD")).toBe(40);
    // USD 37 × 1,2 = 44,4 → USD 44; × 0,8 = 29,6 → USD 30.
    expect(suggestedBudget(37, 0.2, "USD")).toBe(44);
    expect(suggestedBudget(37, -0.2, "USD")).toBe(30);
    // Colones de 500 en 500: ₡25 000 → ₡30 000; ₡12 300 → ₡14 760 → ₡15 000.
    expect(suggestedBudget(25_000, 0.2, "CRC")).toBe(30_000);
    expect(suggestedBudget(12_300, 0.2, "crc")).toBe(15_000);
    // Tiny budgets keep the cents rather than not moving.
    expect(suggestedBudget(2, 0.2, "USD")).toBe(2.4);
    expect(suggestedBudget(2, -0.2, "USD")).toBe(1.6);
    expect(suggestedBudget(1, -0.2, "USD")).toBe(0.8);
    expect(plain(budgetText(60, "USD"))).toBe("USD 60");
    expect(plain(budgetText(2.4, "USD"))).toBe("USD 2,40");
  });

  it("escala con CPA real ≤ 8,50 y al menos 5 pedidos reales", () => {
    expect(decide(row({ days3: days3(80, 10) }))).toMatchObject({
      action: "escalar",
      label: "Escalar +20 %",
      detail:
        "CPA real 3 días USD 8,00 con 10 pedidos reales. Presupuesto USD 50 → USD 60.",
      suggestedBudget: 60,
      dailyBudget: 50,
      level: "campaign",
      levelNote: null,
    });
    // Boundaries: exactly the target and exactly 5 orders still scale.
    expect(action(row({ days3: days3(42.5, 5) }))).toBe("escalar");
    // 4,9 estimated orders are not enough.
    expect(decide(row({ days3: days3(30, 4.9) }))).toMatchObject({
      action: "mantener",
      detail:
        "CPA real 3 días USD 6,12 con 4,9 pedidos reales; para escalar se piden 5.",
    });
  });

  it("does not scale on incomplete windows (TikTok lag, unknown day)", () => {
    expect(
      decide(row({ days3: days3(60, 10, { partial: true }) })),
    ).toMatchObject({ action: "mantener" });
    expect(
      decide(row({ platform: "tiktok", days3: w({ spendUsd: null, real: null }) })),
    ).toMatchObject({
      action: "sin_datos",
      detail: "TikTok todavía no envía los últimos 3 días.",
    });
    expect(
      decide(row({ days3: w({ spendUsd: 30, real: null }) })),
    ).toMatchObject({
      action: "sin_datos",
      detail: "Faltan datos de gasto o de pedidos de los últimos 3 días.",
    });
  });

  it("baja entre 8,50 y 11 (inclusive) y apaga por encima de 11", () => {
    expect(decide(row({ days3: days3(90, 10) }))).toMatchObject({
      action: "bajar",
      label: "Bajar −20 %",
      detail:
        "CPA real 3 días USD 9,00: sobre la meta de USD 8,50 y hasta USD 11,00. Presupuesto USD 50 → USD 40.",
      suggestedBudget: 40,
    });
    // Without a known budget (TikTok via Make) there is no amount.
    expect(
      decide(row({ dailyBudget: null, days3: days3(90, 10) })),
    ).toMatchObject({
      detail:
        "CPA real 3 días USD 9,00: sobre la meta de USD 8,50 y hasta USD 11,00.",
      suggestedBudget: null,
    });
    expect(action(row({ days3: days3(8.51 * 10, 10) }))).toBe("bajar");
    expect(action(row({ days3: days3(110, 10) }))).toBe("bajar");
    expect(decide(row({ days3: days3(110.1, 10) }))).toMatchObject({
      action: "apagar",
      label: "Apagar",
      detail: "CPA real 3 días USD 11,01: más de USD 11,00.",
    });
  });

  it("apaga con USD 17 o más en 3 días sin ningún pedido real", () => {
    expect(decide(row({ days3: days3(17, 0) }))).toMatchObject({
      action: "apagar",
      detail:
        "USD 17,00 en 3 días sin pedidos reales (se apaga desde USD 17,00).",
    });
    expect(decide(row({ days3: days3(16.99, 0) }))).toMatchObject({
      action: "mantener",
      detail:
        "USD 16,99 en 3 días sin pedidos reales; se apaga desde USD 17,00.",
    });
    // A fraction of an estimated order is still a CPA far above 11.
    expect(action(row({ days3: days3(17, 0.2) }))).toBe("apagar");
    expect(decide(row({ days3: days3(0, 0) }))).toMatchObject({
      action: "mantener",
      detail: "Sin gasto en los últimos 3 días.",
    });
  });

  it("no escala lo que se tocó en las últimas 72 h: En aprendizaje", () => {
    const good = row({ days3: days3(80, 10) });
    expect(decide(good, [change(30)])).toMatchObject({
      action: "aprendizaje",
      label: "En aprendizaje",
      detail:
        "CPA real 3 días USD 8,00 con 10 pedidos reales, pero se cambió el presupuesto hace 30 h. No se escala hasta pasar 72 h.",
      learning: { kind: "presupuesto" },
    });
    expect(action(good, [change(10, "puja")])).toBe("aprendizaje");
    expect(action(good, [change(10, "lanzamiento")])).toBe("aprendizaje");
    // An unclassified Meta edit may be the budget: it also waits.
    expect(action(good, [change(10, "otro")])).toBe("aprendizaje");
    // 72 h or more ago, status changes, creatives or other campaigns: scale.
    expect(action(good, [change(72)])).toBe("escalar");
    expect(action(good, [change(5, "estado")])).toBe("escalar");
    expect(action(good, [change(5, "creativo")])).toBe("escalar");
    expect(action(good, [change(5, "presupuesto", "other")])).toBe("escalar");
    // A campaign younger than the window has not completed its 3 days.
    const young = row({
      days3: days3(80, 10),
      launch: { ...row().launch, date: "2026-11-11", ageDays: 2 },
    });
    expect(decide(young)).toMatchObject({
      action: "aprendizaje",
      learning: { kind: "nueva" },
    });
    expect(
      learningChange(
        row({ launch: { ...row().launch, date: "2026-11-10", ageDays: 3 } }),
        [],
        now,
      ),
    ).toBeNull();
  });

  it("never scales into a stock-out (current inventory only)", () => {
    expect(
      decide(row({ days3: days3(80, 10), coverage: coverageOf(0, 70) })),
    ).toMatchObject({
      action: "mantener",
      detail:
        "CPA real 3 días USD 8,00, pero el producto está agotado: no se escala.",
    });
    expect(
      decide(row({ days3: days3(80, 10), coverage: coverageOf(20, 70) }))
        ?.detail,
    ).toBe(
      "CPA real 3 días USD 8,00, pero queda stock para 2,0 días: no se escala.",
    );
    // A stale inventory file does not decide.
    expect(
      action(
        row({
          days3: days3(80, 10),
          coverage: coverageOf(0, 70),
          stockStale: "2026-11-10",
        }),
      ),
    ).toBe("escalar");
    // Stock does not stop bajar / apagar.
    expect(
      action(row({ days3: days3(95, 10), coverage: coverageOf(0, 70) })),
    ).toBe("bajar");
  });

  it("learning never blocks bajar or apagar", () => {
    expect(action(row({ days3: days3(95, 10) }), [change(5)])).toBe("bajar");
    expect(action(row({ days3: days3(40, 0) }), [change(5)])).toBe("apagar");
  });

  it("Hoy solo levanta una alerta y nunca cambia la acción", () => {
    const bad = row({
      days3: days3(80, 10),
      today: w({ spendNative: 25, spendUsd: 25, real: 0 }),
    });
    expect(decide(bad)).toMatchObject({
      action: "escalar",
      todayAlert: "Hoy: USD 25,00 sin pedidos reales.",
    });
    expect(
      plain(todayAlert(row({ today: w({ spendUsd: 36, real: 3 }) }))),
    ).toBe("Hoy: CPA real USD 12,00.");
    expect(todayAlert(row({ today: w({ spendUsd: 10, real: 0 }) }))).toBeNull();
    expect(todayAlert(row({ today: w({ spendUsd: 30, real: 4 }) }))).toBeNull();
    // TikTok today is unknown (arrives the next day).
    expect(
      todayAlert(row({ today: w({ spendUsd: null, real: null }) })),
    ).toBeNull();
  });

  it("skips paused campaigns and needs a product to decide", () => {
    expect(decide(row({ status: "pausada" }))).toBeNull();
    // Unknown status: decided only when it spent recently.
    expect(
      decide(row({ status: null, today: w(), yesterday: w(), days3: w() })),
    ).toBeNull();
    expect(action(row({ status: null }))).toBe("escalar");
    expect(decide(row({ product: null }))).toMatchObject({
      action: "sin_datos",
      detail: "Sin producto asignado: no hay pedidos reales para decidir.",
    });
  });

  it("evalúa por campaña y lo anota en ABO; marca ≈ cuando hay reparto", () => {
    expect(decide(row({ type: "ABO" }))).toMatchObject({
      level: "campaign",
      levelNote:
        "ABO: se evalúa la campaña completa; no hay datos por conjunto de anuncios.",
    });
    expect(decide(row({ type: "COST CAP" }))?.levelNote).toBeNull();
    expect(decide(row({ platform: "tiktok", type: "Sin dato" }))?.levelNote).toBeNull();
    expect(decide(row({ days3: days3(80, 10, { utm: 4 }) }))?.approximate).toBe(
      true,
    );
    expect(
      decide(row({ days3: days3(80, 10, { utm: 10 }) }))?.approximate,
    ).toBe(false);
  });

  it("orders the list apagar → bajar → escalar → aprendizaje and counts it", () => {
    const list = plain(
      buildCampaignDecisions({
        now,
        changes: [change(5, "presupuesto", "learn")],
        rows: [
          row({ key: "a", campaignId: "a", days3: days3(80, 10) }),
          row({ key: "b", campaignId: "b", days3: days3(95, 10) }),
          row({ key: "c", campaignId: "c", days3: days3(40, 0) }),
          row({ key: "d", campaignId: "d", status: "pausada" }),
          row({ key: "learn", campaignId: "learn", days3: days3(60, 10) }),
          row({
            key: "e",
            campaignId: "e",
            days3: days3(12, 2),
            today: w({ spendUsd: 20, real: 0 }),
          }),
        ],
      }),
    );
    expect(list.map((d: CampaignDecision) => [d.key, d.action])).toEqual([
      ["c", "apagar"],
      ["b", "bajar"],
      ["a", "escalar"],
      ["learn", "aprendizaje"],
      ["e", "mantener"],
    ]);
    expect(decisionCounts(list, [])).toEqual({
      escalar: 1,
      bajar: 1,
      apagar: 1,
      aprendizaje: 1,
      costCap: 0,
      todayAlerts: 1,
    });
    expect(decisionCounts([], null).costCap).toBe(0);
  });

  it("lee la marca «Hecho» del registro manual (72 h) y la descuenta de lo pendiente", () => {
    const mark = (
      h: number,
      detail: string,
      campaignId = "9",
      kind: CampaignChange["kind"] = "presupuesto",
    ): CampaignChange => ({
      ...change(h, kind, campaignId),
      source: "manual",
      id: `m${h}`,
      by: "Ana",
      detail,
    });
    expect(doneDetail("escalar", "Escalar +20 % · USD 50 → USD 60")).toBe(
      "Hecho en Acciones (escalar): Escalar +20 % · USD 50 → USD 60",
    );
    expect(doneDetail("costcap", "x".repeat(300), "123")).toHaveLength(200);
    expect(
      parseDoneMark(mark(1, doneDetail("costcap", "Pasar", "123"))),
    ).toMatchObject({ action: "costcap", adId: "123", by: "Ana", id: "m1" });
    // Only manual entries with the tag are marks.
    expect(
      parseDoneMark({ ...mark(1, doneDetail("bajar", "")), source: "meta" }),
    ).toBeNull();
    expect(parseDoneMark(mark(1, "presupuesto 50 → 40"))).toBeNull();
    const target = {
      platform: "meta" as const,
      accountId: "1",
      campaignId: "9",
      action: "bajar" as const,
    };
    expect(findDoneMark([mark(80, doneDetail("bajar", ""))], target, now)).toBeNull();
    expect(
      findDoneMark(
        [mark(30, doneDetail("bajar", "")), mark(2, doneDetail("bajar", ""))],
        target,
        now,
      )?.id,
    ).toBe("m2");
    // A mark saved after the data cut (just clicked) still counts.
    expect(findDoneMark([mark(-0.1, doneDetail("bajar", ""))], target, now)).not.toBeNull();
    expect(findDoneMark([mark(2, doneDetail("apagar", ""))], target, now)).toBeNull();

    const list = buildCampaignDecisions({
      now,
      changes: [
        mark(1, doneDetail("bajar", ""), "b"),
        // The scale mark is also a budget change: the campaign is in learning.
        mark(2, doneDetail("escalar", ""), "a"),
      ],
      rows: [
        row({ key: "a", campaignId: "a", days3: days3(80, 10) }),
        row({ key: "b", campaignId: "b", days3: days3(95, 10) }),
        row({ key: "c", campaignId: "c", days3: days3(95, 10) }),
      ],
    });
    const byKey = Object.fromEntries(list.map((d) => [d.key, d]));
    expect(byKey.a).toMatchObject({ action: "aprendizaje", done: { action: "escalar" } });
    expect(byKey.b).toMatchObject({ action: "bajar", done: { action: "bajar" } });
    expect(byKey.c.done).toBeNull();
    expect(decisionCounts(list, [])).toMatchObject({
      escalar: 0,
      bajar: 1,
      aprendizaje: 1,
    });
  });

  it("merges Meta activity and the manual log for the learning guard", () => {
    const manual = { ...change(3), source: "manual" as const };
    expect(
      decisionChanges([{ changes: [change(1)] }, {}], [manual]),
    ).toHaveLength(2);
  });
});

/* -------------------------------------------------------------- COST CAP */

const charlieDay = (date: string, spend: number): CharlieDay => ({
  date,
  spend,
  impressions: 1000,
  clicks: 30,
  frequency: 1.2,
  purchases: 2,
  purchaseValue: null,
  interactions: 0,
});
const adsAccount = (
  ads: Array<{ id: string; campaignId: string; spend: number[] }>,
): CharlieAccount => ({
  platform: "meta",
  id: "1",
  name: "CR4",
  currency: "USD",
  timezone: "America/Costa_Rica",
  adsets: [],
  ads: ads.map((ad) => ({
    id: ad.id,
    name: `Anuncio ${ad.id}`,
    adsetId: "s1",
    campaignId: ad.campaignId,
    campaignName: `CBO ${ad.campaignId}`,
    effectiveStatus: "",
    postId: null,
    creativeId: null,
    assets: null,
    daily: ad.spend.map((spend, i) => charlieDay(WINDOW[i], spend)),
  })),
});
const report = (accounts: CharlieAccount[]): CharlieReport => ({
  status: "ready",
  checkedAt: now.toISOString(),
  message: "",
  data: {
    accounts,
    from: WINDOW[0],
    to: WINDOW[2],
    trailFrom: WINDOW[0],
    trailTo: WINDOW[2],
  },
});
const realDay = (date: string, byAd: Record<string, number>): RealOrderDay => ({
  date,
  created: 20,
  real: 18,
  withCampaign: 0,
  byCampaign: {},
  byAd,
  unlinkedBySku: {},
  unlinkedNoProduct: 0,
});
/** Campaign estimate = UTM orders of its ads (+ `assigned` spread by spend). */
const estimates = (
  perCampaign: Record<string, { total: number; assigned?: number }[]>,
): CampaignEstimates =>
  new Map(
    Object.entries(perCampaign).map(([campaign, days]) => [
      `meta:1:${campaign}`,
      new Map(
        days.map((d, i): [string, CampaignRealDay] => [
          WINDOW[i],
          {
            utm: d.total - (d.assigned ?? 0),
            assigned: d.assigned ?? 0,
            total: d.total,
            partial: false,
          },
        ]),
      ),
    ]),
  );
const rowsFor = (...campaigns: Array<Partial<CampaignActionRow> & { campaignId: string }>) =>
  campaigns.map((c) =>
    row({ key: `meta:1:${c.campaignId}`, name: `CBO ${c.campaignId}`, ...c }),
  );

describe("creativos listos para COST CAP", () => {
  const utm = (counts: number[], ad = "a1") =>
    counts.map((n, i) => realDay(WINDOW[i], { [`meta:${ad}`]: n }));

  it("takes ads with more than 5 real orders and CPA real under USD 6", () => {
    const out = plain(
      buildCreativeDecisions({
        report: report([
          adsAccount([{ id: "a1", campaignId: "c1", spend: [10, 10, 10] }]),
        ]),
        rows: rowsFor({ campaignId: "c1" }),
        estimates: estimates({
          c1: [{ total: 2 }, { total: 3 }, { total: 2 }],
        }),
        days: utm([2, 3, 2]),
        fx: null,
        now,
      }),
    );
    expect(out).toEqual([
      expect.objectContaining({
        adId: "a1",
        adName: "Anuncio a1",
        accountLabel: "CR4",
        campaignName: "CBO c1",
        product: "Gomitas",
        spendUsd: 30,
        real: 7,
        basis: "utm",
      }),
    ]);
    expect(out[0].cpaReal).toBeCloseTo(30 / 7);
  });

  it("uses the spend share of the campaign estimate (≈) when orders lack the ad UTM", () => {
    const out = buildCreativeDecisions({
      report: report([
        adsAccount([
          { id: "a1", campaignId: "c1", spend: [9, 9, 9] },
          { id: "a2", campaignId: "c1", spend: [3, 3, 3] },
        ]),
      ]),
      rows: rowsFor({ campaignId: "c1" }),
      estimates: estimates({
        c1: [
          { total: 4, assigned: 4 },
          { total: 4, assigned: 4 },
          { total: 4, assigned: 4 },
        ],
      }),
      days: WINDOW.map((d) => realDay(d, {})),
      fx: null,
      now,
    });
    // a1 gets 3 of every 4 orders: 9 orders, CPA 27 / 9 = 3. a2: 3 orders.
    expect(out.map((c) => [c.adId, c.real, c.basis])).toEqual([
      ["a1", 9, "estimado"],
    ]);
  });

  it("excludes COST CAP and paused campaigns, 5 orders or fewer, CPA ≥ 6 and unknowns", () => {
    const base = {
      fx: null,
      now,
    };
    const run = (
      spend: number[],
      orders: number[],
      patch: Partial<CampaignActionRow> = {},
      campaignName?: string,
    ) => {
      const account = adsAccount([{ id: "a1", campaignId: "c1", spend }]);
      if (campaignName) account.ads[0].campaignName = campaignName;
      return buildCreativeDecisions({
        ...base,
        report: report([account]),
        rows: rowsFor({ campaignId: "c1", ...patch }),
        estimates: estimates({
          c1: orders.map((total) => ({ total })),
        }),
        days: utm(orders),
      });
    };
    expect(run([10, 10, 10], [2, 2, 2])).toMatchObject([
      { accountId: "1", campaignId: "c1", adId: "a1", done: null },
    ]);
    // "Hecho" of this ad (not of another ad of the campaign) marks it done.
    const doneMark = (adId: string): CampaignChange => ({
      ...change(1, "creativo", "c1"),
      source: "manual",
      id: "m1",
      detail: doneDetail("costcap", "Pasar a COST CAP", adId),
    });
    const withChanges = (changes: CampaignChange[]) =>
      buildCreativeDecisions({
        ...base,
        report: report([adsAccount([{ id: "a1", campaignId: "c1", spend: [10, 10, 10] }])]),
        rows: rowsFor({ campaignId: "c1" }),
        estimates: estimates({ c1: [{ total: 2 }, { total: 2 }, { total: 2 }] }),
        days: utm([2, 2, 2]),
        changes,
      });
    expect(withChanges([doneMark("a1")])[0].done).toMatchObject({ adId: "a1" });
    expect(withChanges([doneMark("a2")])[0].done).toBeNull();
    expect(decisionCounts([], withChanges([doneMark("a1")])).costCap).toBe(0);
    expect(run([10, 10, 10], [2, 2, 2], { type: "COST CAP" })).toHaveLength(0);
    expect(
      run([10, 10, 10], [2, 2, 2], {}, "COST CAP GOMITAS | CR"),
    ).toHaveLength(0);
    expect(run([10, 10, 10], [2, 2, 2], { status: "pausada" })).toHaveLength(0);
    expect(
      run([10, 10, 10], [2, 2, 2], { coverage: coverageOf(0, 70) }),
    ).toHaveLength(0);
    // Exactly 5 is not "more than 5".
    expect(run([5, 5, 5], [2, 2, 1])).toHaveLength(0);
    // CPA exactly 6 is not "under 6".
    expect(run([12, 12, 12], [2, 2, 2])).toHaveLength(0);
    // No action row for the campaign: it cannot be verified it is not a COST CAP.
    expect(
      buildCreativeDecisions({
        ...base,
        report: report([
          adsAccount([{ id: "a1", campaignId: "c9", spend: [10, 10, 10] }]),
        ]),
        rows: rowsFor({ campaignId: "c1" }),
        estimates: estimates({ c9: [{ total: 2 }, { total: 2 }, { total: 2 }] }),
        days: utm([2, 2, 2]),
      }),
    ).toHaveLength(0);
    // A day without a campaign estimate (unassigned / unknown spend): skipped.
    expect(
      buildCreativeDecisions({
        ...base,
        report: report([
          adsAccount([{ id: "a1", campaignId: "c1", spend: [10, 10, 10] }]),
        ]),
        rows: rowsFor({ campaignId: "c1" }),
        estimates: estimates({ c1: [{ total: 3 }, { total: 4 }] }),
        days: utm([3, 4, 0]),
      }),
    ).toHaveLength(0);
    expect(
      buildCreativeDecisions({
        ...base,
        report: { ...report([]), status: "error", data: null },
        rows: [],
        estimates: new Map(),
        days: [],
      }),
    ).toEqual([]);
  });
});
