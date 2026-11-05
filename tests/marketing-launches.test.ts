import { describe, expect, it } from "vitest";
import {
  campaignActive,
  testRuleAction,
  type CampaignActionRow,
  type Window,
} from "../lib/marketing-actions";
import {
  buildLaunches,
  launchSpendText,
  launchStage,
} from "../lib/marketing-launches";
import { MARKETING_TARGETS } from "../lib/marketing-targets";
import type { ManualCampaignChange } from "../lib/marketing-source-types";
import type { UsdRate } from "../lib/marketing-charlie-types";

const TODAY = "2026-11-05";
const plain = (value: string) => value.replace(/ | /g, " ");
const fx: UsdRate = {
  rate: 500,
  date: TODAY,
  source: "hacienda",
  pen: { rate: 3.5, date: TODAY, source: "bcrp" },
} as unknown as UsdRate;

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

function row(
  patch: Partial<CampaignActionRow> & {
    spend?: number;
    real?: number | null;
    pixel?: number | null;
    date?: string | null;
  } = {},
): CampaignActionRow {
  const {
    spend = 20,
    real = 0,
    pixel = 0,
    date = "2026-11-03",
    ...rest
  } = patch;
  const platform = rest.platform ?? "meta";
  const ageDays =
    date == null
      ? null
      : Math.round(
          (Date.parse(`${TODAY}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) /
            86_400_000,
        );
  return {
    key: `${platform}:1:9`,
    platform,
    accountId: "1",
    accountLabel: platform === "meta" ? "CR2" : "TikTok",
    campaignId: "9",
    name: "HER LOSS | CBO",
    type: "CBO",
    status: "activa",
    currency: platform === "meta" ? "USD" : "PEN",
    dailyBudget: 20,
    bid: null,
    bidMixed: false,
    product: {
      key: "family:her",
      name: "Her Loss",
      automatic: true,
      reason: "",
    },
    coverage: null,
    restocked: null,
    restockedFromLow: null,
    stockStale: null,
    dataThrough: TODAY,
    today: w({ spendNative: 5, spendUsd: 5 }),
    yesterday: w({ spendNative: 5, spendUsd: 5 }),
    days3: w({ spendNative: 10, spendUsd: 10 }),
    days7: w(),
    launch: {
      date,
      ageDays,
      lifetimeSpendNative: spend,
      testSpend: spend,
      lifetimeReal: real,
      lifetimePixel: pixel,
      inTest: ageDays != null && ageDays <= 14,
    },
    lastChange: null,
    lastStatusChange: null,
    changesStatus: "activity",
    action: { code: "mantener", label: "Mantener", tone: "info", detail: "" },
    notes: [],
    ...rest,
  };
}

const manual = (
  patch: Partial<ManualCampaignChange> = {},
): ManualCampaignChange => ({
  platform: "tiktok",
  accountId: "77",
  campaignId: "555",
  at: "2026-11-04T15:00:00Z",
  kind: "lanzamiento",
  detail: "",
  source: "manual",
  id: "m1",
  by: "Ana",
  campaignName: "HER LOSS TT",
  productKey: "family:her",
  ...patch,
});

describe("testRuleAction (extracted from the rules, same behaviour)", () => {
  it("returns null outside the test and flags a passed test", () => {
    expect(
      testRuleAction(row({ date: "2026-10-01" }), true, MARKETING_TARGETS),
    ).toBeNull();
    const passed = testRuleAction(row({ spend: 40, real: 3 }), true);
    expect(passed?.passed).toBe(true);
    expect(passed?.action.code).toBe("paso_prueba");
  });

  it("treats unknown status with recent spend as active", () => {
    expect(campaignActive(row({ status: null }))).toBe(true);
    expect(
      campaignActive(
        row({ status: null, today: w(), yesterday: w(), days3: w() }),
      ),
    ).toBe(false);
  });
});

describe("launchStage", () => {
  it("follows the Meta test (USD 17 without sale, USD 40 with 3 orders)", () => {
    expect(launchStage(row({ spend: 17, real: 0, pixel: 0 }))).toMatchObject({
      code: "apagar",
      tone: "risk",
      label: "Apagar",
    });
    expect(launchStage(row({ spend: 40, real: 3 }))).toMatchObject({
      code: "paso",
      tone: "good",
      spendProgress: 1,
      ordersProgress: 1,
    });
    expect(launchStage(row({ spend: 41, real: 2 }))).toMatchObject({
      code: "no_paso",
      tone: "risk",
      label: "No pasó la prueba",
    });
    const testing = launchStage(row({ spend: 23, real: 1 }));
    expect(testing).toMatchObject({ code: "en_prueba", tone: "wait" });
    expect(testing.spendProgress).toBeCloseTo(23 / 40);
    expect(testing.ordersProgress).toBeCloseTo(1 / 3);
  });

  it("follows the TikTok test in soles (PEN 60 / PEN 200 and 5 orders)", () => {
    const tiktok = { platform: "tiktok" as const };
    expect(launchStage(row({ ...tiktok, spend: 60, real: 0 })).code).toBe(
      "apagar",
    );
    expect(launchStage(row({ ...tiktok, spend: 200, real: 5 })).code).toBe(
      "paso",
    );
    expect(launchStage(row({ ...tiktok, spend: 210, real: 4 })).code).toBe(
      "no_paso",
    );
    expect(launchStage(row({ ...tiktok, spend: 120, real: 2 })).code).toBe(
      "en_prueba",
    );
  });

  it("without real orders it says so and shows the pixel, never decides on it", () => {
    const stage = launchStage(row({ spend: 30, real: null, pixel: 4 }));
    expect(stage.code).toBe("sin_datos");
    expect(stage.label).toBe("Sin pedidos reales");
    expect(plain(stage.detail)).toContain("(píxel: 4)");
    expect(stage.ordersProgress).toBe(0);
  });

  it("a paused test is 'prueba apagada'; no product asks for it", () => {
    expect(
      launchStage(row({ status: "pausada", spend: 20, real: 0, pixel: 0 })),
    ).toMatchObject({ code: "prueba_apagada", label: "Prueba apagada" });
    expect(launchStage(row({ product: null })).label).toBe(
      "Asigna el producto",
    );
  });

  it("caps the progress at 1", () => {
    const stage = launchStage(row({ spend: 90, real: 9 }));
    expect(stage.spendProgress).toBe(1);
    expect(stage.ordersProgress).toBe(1);
  });
});

describe("buildLaunches", () => {
  it("keeps launches of the last 14 days and drops older ones", () => {
    const { groups } = buildLaunches({
      rows: [
        row({ date: "2026-11-03" }),
        row({ date: "2026-10-22", key: "meta:1:8", campaignId: "8" }),
        row({ date: "2026-10-20", key: "meta:1:7", campaignId: "7" }),
      ],
      manual: [],
      today: TODAY,
      fx,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].launches.map((l) => l.launchDate)).toEqual([
      "2026-11-03",
      "2026-10-22",
    ]);
  });

  it("groups Meta and TikTok of the same product and sorts by latest launch", () => {
    const { groups } = buildLaunches({
      rows: [
        row({ date: "2026-11-01" }),
        row({
          platform: "tiktok",
          key: "tiktok:77:5",
          accountId: "77",
          campaignId: "5",
          date: "2026-11-04",
          spend: 120,
        }),
        row({
          date: "2026-11-02",
          key: "meta:1:3",
          campaignId: "3",
          product: {
            key: "family:creatina",
            name: "Creatina",
            automatic: true,
            reason: "",
          },
        }),
      ],
      manual: [],
      today: TODAY,
      fx,
    });
    expect(groups.map((g) => g.productName)).toEqual(["Her Loss", "Creatina"]);
    expect(groups[0]).toMatchObject({
      firstDate: "2026-11-01",
      lastDate: "2026-11-04",
    });
    const tiktok = groups[0].launches[0];
    expect(tiktok).toMatchObject({
      platform: "tiktok",
      currency: "PEN",
      testSpend: 120,
      passSpend: 200,
      passOrders: 5,
    });
    expect(tiktok.spendUsd).toBeCloseTo(120 / 3.5);
    expect(plain(launchSpendText(tiktok))).toBe("PEN 120,00 de PEN 200,00");
  });

  it("adds a manual launch whose campaign has no row yet", () => {
    const { groups } = buildLaunches({
      rows: [row({ date: "2026-11-03" })],
      manual: [
        manual(),
        manual({
          id: "old",
          campaignId: "444",
          at: "2026-10-10T15:00:00Z",
        }),
        manual({ id: "budget", campaignId: "333", kind: "presupuesto" }),
      ],
      today: TODAY,
      fx,
      productName: (key) => (key === "family:her" ? "Her Loss" : null),
    });
    expect(groups).toHaveLength(1);
    const launches = groups[0].launches;
    expect(launches).toHaveLength(2);
    const manualRow = launches.find((l) => l.source === "manual")!;
    expect(manualRow).toMatchObject({
      launchDate: "2026-11-04",
      campaignName: "HER LOSS TT",
      productName: "Her Loss",
      testSpend: null,
      stage: { code: "sin_datos", label: "Sin gasto todavía" },
    });
    expect(manualRow.stage.detail).toContain("Ana");
  });

  it("does not duplicate a campaign that has a row; uses the manual date when the platform sent none", () => {
    const { groups } = buildLaunches({
      rows: [
        row({
          date: null,
          campaignId: "555",
          key: "tiktok:77:555",
          accountId: "77",
          platform: "tiktok",
        }),
      ],
      manual: [manual()],
      today: TODAY,
      fx,
    });
    expect(groups[0].launches).toHaveLength(1);
    expect(groups[0].launches[0]).toMatchObject({
      launchDate: "2026-11-04",
      source: "manual",
      stage: { code: "sin_datos", label: "Sin fecha de lanzamiento" },
    });
  });

  it("puts campaigns without product last and notes missing real orders and TikTok lag", () => {
    const { groups, notes } = buildLaunches({
      rows: [
        row({ product: null, key: "meta:1:2", campaignId: "2" }),
        row({ date: "2026-11-01", real: null }),
        row({
          platform: "tiktok",
          key: "tiktok:77:5",
          accountId: "77",
          campaignId: "5",
          date: "2026-11-02",
          dataThrough: "2026-11-04",
        }),
      ],
      manual: [],
      today: TODAY,
      fx,
    });
    expect(groups.map((g) => g.productKey)).toEqual(["family:her", null]);
    expect(notes.some((n) => n.startsWith("TikTok hasta el"))).toBe(true);
    expect(notes.some((n) => n.includes("sin pedidos reales"))).toBe(true);
  });
});
