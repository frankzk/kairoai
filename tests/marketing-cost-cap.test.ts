import { describe, expect, it } from "vitest";
import { buildCostCapControl } from "../lib/marketing-cost-cap";
import type { CampaignActionRow, Window } from "../lib/marketing-actions";

const now = new Date("2026-11-05T20:35:00Z");
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/ | /g, " "));
const w = (spendUsd: number | null, pixel: number | null = 0): Window => ({
  spendNative: spendUsd,
  spendUsd,
  pixel,
  real: null,
  utm: 0,
  partial: false,
  cpaReal: null,
  cpaPixel:
    spendUsd != null && pixel != null && pixel > 0 ? spendUsd / pixel : null,
});
const row = (patch: Partial<CampaignActionRow> = {}): CampaignActionRow => ({
  key: "meta:1:9",
  platform: "meta",
  accountId: "1",
  accountLabel: "CR4",
  campaignId: "9",
  name: "COST CAP_GOMITAS",
  type: "COST CAP",
  status: "activa",
  currency: "USD",
  dailyBudget: null,
  bid: 8.5,
  bidMixed: false,
  product: {
    key: "family:gomitas",
    name: "Gomitas",
    automatic: true,
    reason: "",
  },
  coverage: null,
  restocked: null,
  restockedFromLow: null,
  stockStale: null,
  dataThrough: "2026-11-05",
  today: w(20, 3),
  yesterday: w(40, 5),
  days3: w(120, 15),
  days7: w(280, 35),
  launch: {
    date: null,
    ageDays: null,
    lifetimeSpendNative: null,
    testSpend: null,
    lifetimeReal: null,
    lifetimePixel: null,
    inTest: false,
  },
  lastChange: null,
  lastStatusChange: null,
  changesStatus: "activity",
  action: { code: "mantener", label: "Mantener", tone: "info", detail: "" },
  notes: [],
  ...patch,
});
const control = (rows: CampaignActionRow[]) =>
  plain(buildCostCapControl(rows, undefined, { now }));

describe("control de las COST CAP", () => {
  it("flags a COST CAP that spends more than US$100 in a day (Gomitas CR4, 27 oct)", () => {
    const [cap] = control([row({ yesterday: w(1166, 120) })]).rows;
    expect(cap.alerts).toEqual([
      {
        code: "gasto_alto",
        tone: "risk",
        day: "ayer",
        label: "Gastó USD 1 166,00 en un día (límite de control USD 100,00)",
      },
    ]);
    expect(cap.risk).toBe(true);
  });
  it("flags a pixel CPA above twice the bid, with or without purchases", () => {
    const [cap] = control([row({ today: w(36, 2) })]).rows;
    expect(cap.alerts).toEqual([
      expect.objectContaining({
        code: "cpa_doble",
        day: "hoy",
        label: "CPA píxel USD 18,00: más del doble de la puja",
      }),
    ]);
    expect(control([row({ today: w(18, 0) })]).rows[0].alerts[0]).toMatchObject(
      {
        code: "cpa_doble",
        label: "USD 18,00 sin compras en el píxel (más del doble de la puja)",
      },
    );
  });
  it("marks no delivery yesterday and compares with the target when the bid is missing", () => {
    const [cap] = control([row({ yesterday: w(3, 0), bid: null })]).rows;
    expect(cap).toMatchObject({
      bid: 8.5,
      bidAssumed: true,
      bidNote: "Puja no disponible; se compara con USD 8,50",
    });
    expect(cap.alerts).toEqual([
      {
        code: "no_entrega",
        tone: "wait",
        day: "ayer",
        label: "No entrega: USD 3,00 ayer",
      },
    ]);
    // A paused COST CAP or an unreported TikTok day is not "no delivery".
    expect(
      control([row({ yesterday: w(0), status: "pausada" })]).rows[0].alerts,
    ).toEqual([]);
    expect(
      control([
        row({
          platform: "tiktok",
          status: null,
          dataThrough: "2026-11-03",
          yesterday: w(0),
        }),
      ]).rows[0].alerts,
    ).toEqual([]);
    // A COST CAP launched today or yesterday, or activated since yesterday,
    // did not run all of yesterday.
    const launched = (date: string) =>
      row({
        yesterday: w(0),
        launch: {
          date,
          ageDays: 0,
          lifetimeSpendNative: 3,
          testSpend: 3,
          lifetimeReal: 0,
          lifetimePixel: 0,
          inTest: true,
        },
      });
    expect(control([launched("2026-11-05")]).rows[0].alerts).toEqual([]);
    expect(control([launched("2026-11-04")]).rows[0].alerts).toEqual([]);
    expect(
      control([launched("2026-11-03")]).rows[0].alerts.map((a) => a.code),
    ).toEqual(["no_entrega"]);
    expect(
      control([
        row({
          yesterday: w(0),
          lastStatusChange: {
            platform: "meta",
            accountId: "1",
            campaignId: "9",
            at: "2026-11-05T15:00:00Z",
            kind: "estado",
            detail: "",
            source: "meta",
          },
        }),
      ]).rows[0].alerts,
    ).toEqual([]);
    // Only COST CAP rows are controlled.
    expect(control([row({ type: "CBO" })]).rows).toEqual([]);
  });
  it("suggests products with a CBO pixel CPA under target and no active COST CAP", () => {
    const cbo = (key: string, spend: number, pixel: number, patch = {}) =>
      row({
        key: `meta:1:${key}`,
        type: "CBO",
        product: { key, name: key.toUpperCase(), automatic: false, reason: "" },
        days7: w(spend, pixel),
        ...patch,
      });
    const { candidates } = control([
      cbo("mag", 99.4, 14),
      cbo("mag", 10, 1),
      cbo("her", 50, 10),
      cbo("nad", 10, 2), // under 3 purchases
      cbo("ret", 100, 5), // CPA 20
      cbo("off", 10, 5, { status: "pausada" }),
      row({
        product: { key: "her", name: "HER", automatic: false, reason: "" },
      }),
    ]);
    expect(candidates.map((c) => c.productKey)).toEqual(["mag"]);
    expect(candidates[0]).toMatchObject({
      cboSpend7d: 109.4,
      cboPixel7d: 15,
      campaigns: 2,
    });
    expect(candidates[0].cboPixelCpa7d).toBeCloseTo(7.29, 2);
    expect(candidates[0].detail).toBe(
      "CPA del píxel en CBO USD 7,29 con 15 compras en 7 días. Candidato a COST CAP.",
    );
  });
});
