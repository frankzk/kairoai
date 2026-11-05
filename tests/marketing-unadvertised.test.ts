import { describe, expect, it } from "vitest";
import {
  bestTwoBlockAverage,
  buildUnadvertised,
} from "../lib/marketing-unadvertised";
import type { AssignedCampaign, SpendRow } from "../lib/marketing-real-cpa";
import type { MarketingStock } from "../lib/marketing-source-types";
import { insightBlocks } from "../lib/marketing-product-insights";
import { shiftDate } from "../lib/marketing-dates";

const TODAY = "2026-11-05";
const account = {
  accountId: "1",
  currency: "USD",
  timezone: "America/Costa_Rica",
  campaigns: [],
};

const stock = (sku: string, available: number): MarketingStock => ({
  sku,
  warehouseId: "w1",
  onHand: available,
  available,
  allocated: 0,
});

function campaign(id: string, members: string[] | null): AssignedCampaign {
  return {
    key: `meta:1:${id}`,
    platform: "meta",
    account,
    campaign: { id, name: `C ${id}`, spend: 0, impressions: 0, clicks: 0 },
    mapping: members
      ? {
          platform: "meta",
          account_id: "1",
          campaign_id: id,
          product_key: members[0] ?? "",
          product_name: "X",
          sku: "",
          variant_scope: "selected",
          variant_keys: members,
        }
      : null,
    members: members ?? [],
    observedThrough: TODAY,
  };
}
const spend = (
  id: string,
  date: string,
  spendUsd: number | null,
): SpendRow => ({
  platform: "meta",
  accountId: "1",
  campaignId: id,
  date,
  spendUsd,
});

const catalog = [
  { key: "sku:shilajit", sku: "SHILAJIT", name: "Shilajit", recentUnits: 7 },
  { key: "sku:herloss", sku: "HERLOSS", name: "Her Loss", recentUnits: 5 },
  { key: "sku:nad", sku: "NAD", name: "NAD+", recentUnits: 0 },
];
const blocks = insightBlocks(TODAY);

describe("bestTwoBlockAverage", () => {
  it("uses the best 2 consecutive blocks among weeks −3..−8", () => {
    // newest first: weeks −1, −2 ignored
    expect(bestTwoBlockAverage([99, 99, 10, 30, 50, 0, 0, 0])).toBe(40);
    expect(bestTwoBlockAverage([0, 0, 0, 0, 0, 0, 20, 40])).toBe(30);
  });
});

describe("buildUnadvertised", () => {
  it("lists stock without spend in 7 days, newest spend date and unmatched SKUs", () => {
    const result = buildUnadvertised({
      catalog,
      stock: [
        stock("SHILAJIT", 1079),
        stock("HERLOSS", 300),
        stock("NAD", 60),
        stock("MYSTERY", 500),
      ],
      campaigns: [
        campaign("a", ["sku:herloss"]),
        campaign("b", ["sku:shilajit"]),
      ],
      spend: [
        spend("a", "2026-11-03", 3),
        spend("b", "2026-10-25", 20),
        spend("b", "2026-11-02", null),
      ],
      weekly: null,
      today: TODAY,
    });
    expect(result.noAds.map((r) => r.sku)).toEqual(["SHILAJIT", "MYSTERY"]);
    const shilajit = result.noAds[0];
    expect(shilajit.lastSpendDate).toBe("2026-10-25");
    expect(shilajit.spend7dUsd).toBe(0);
    expect(shilajit.dailyUnits).toBe(1);
    expect(shilajit.campaigns).toBe(1);
    expect(result.noAds[1]).toMatchObject({
      cataloged: false,
      name: "MYSTERY",
    });
    expect(result.unmatchedWithStock).toBe(1);
    // Without weekly data "vendían antes" is empty and says why.
    expect(result.soldBefore).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/8 semanas/);
  });

  it("spend today means the product already has ads", () => {
    const result = buildUnadvertised({
      catalog,
      stock: [stock("SHILAJIT", 1079)],
      campaigns: [campaign("b", ["sku:shilajit"])],
      spend: [spend("b", TODAY, 4)],
      weekly: null,
      today: TODAY,
    });
    expect(result.noAds).toEqual([]);
  });

  it("covers a size/color variant through a campaign selling another variant", () => {
    const result = buildUnadvertised({
      catalog: [
        {
          key: "sku:fat.burn.beige.s",
          sku: "FAT.BURN.BEIGE.S",
          name: "Fat Burn",
        },
      ],
      stock: [stock("FAT.BURN.NEGRO.S", 400), stock("FAT.BURN.BEIGE.S", 178)],
      campaigns: [campaign("f", ["sku:fat.burn.beige.s"])],
      spend: [spend("f", "2026-11-04", 30)],
      weekly: null,
      today: TODAY,
    });
    expect(result.noAds).toEqual([]);
  });

  it("counts unassigned campaigns with spend", () => {
    const result = buildUnadvertised({
      catalog,
      stock: [stock("SHILAJIT", 1079)],
      campaigns: [campaign("u", null)],
      spend: [spend("u", "2026-11-01", 15)],
      weekly: null,
      today: TODAY,
    });
    expect(result.unassignedWithSpend).toBe(1);
    expect(result.noAds).toHaveLength(1);
    expect(result.notes.join(" ")).toMatch(/Asignar productos/);
  });

  it("finds products that sold before and dropped with stock (Her Loss)", () => {
    const units = {
      // newest first
      "sku:herloss": [5, 20, 70, 70, 40, 10, 0, 0],
      "sku:shilajit": [30, 60, 60, 80, 60, 50, 50, 50], // 30 vs 70 → in
      "sku:nad": [25, 50, 50, 40, 0, 0, 0, 0], // 25 vs 50 → 50 % but stock 60 ≥ 50 → in
    };
    const result = buildUnadvertised({
      catalog,
      stock: [stock("HERLOSS", 300), stock("SHILAJIT", 1079), stock("NAD", 30)],
      campaigns: [campaign("a", ["sku:herloss"])],
      spend: [spend("a", "2026-11-03", 12.5)],
      weekly: { blocks, units },
      today: TODAY,
    });
    const her = result.soldBefore.find((r) => r.sku === "HERLOSS")!;
    expect(her.beforeWeekly).toBe(70);
    expect(her.nowWeekly).toBe(5);
    expect(her.weeksOfStockAtBefore).toBeCloseTo(300 / 70, 5);
    expect(her.spend7dUsd).toBe(12.5);
    expect(her.weekly).toEqual([0, 0, 10, 40, 70, 70, 20, 5]);
    expect(her.dailyUnits).toBeCloseTo(5 / 7, 5);
    // NAD: stock 30 < one week at the old pace (50) → out.
    expect(result.soldBefore.map((r) => r.sku)).toEqual([
      "HERLOSS",
      "SHILAJIT",
    ]);
  });

  it("a drop to 60 % is not enough; below the weekly minimum is out", () => {
    const result = buildUnadvertised({
      catalog,
      stock: [stock("HERLOSS", 300), stock("NAD", 300)],
      campaigns: [],
      spend: [],
      weekly: {
        blocks,
        units: {
          "sku:herloss": [42, 70, 70, 70, 0, 0, 0, 0],
          "sku:nad": [0, 9, 9, 9, 9, 9, 9, 9],
        },
      },
      today: TODAY,
    });
    expect(result.soldBefore).toEqual([]);
  });

  it("stock under the minimum never enters the no-ads list", () => {
    const result = buildUnadvertised({
      catalog,
      stock: [stock("NAD", 99), stock("NAD", 0)],
      campaigns: [],
      spend: [],
      weekly: null,
      today: TODAY,
    });
    expect(result.noAds).toEqual([]);
  });

  it("unknown spend (TikTok feed stopped) is not 'no ads'", () => {
    const window = Array.from({ length: 7 }, (_, i) =>
      shiftDate("2026-10-29", i),
    ); // 29 oct – 4 nov
    const result = buildUnadvertised({
      catalog,
      stock: [stock("HERLOSS", 300), stock("SHILAJIT", 1079)],
      campaigns: [
        campaign("t", ["sku:herloss"]),
        campaign("b", ["sku:shilajit"]),
      ],
      spend: [
        ...window.map((d) => spend("t", d, null)),
        // Normal TikTok lag: only yesterday unknown → still listed.
        ...window.map((d) => spend("b", d, d === "2026-11-04" ? null : 0)),
      ],
      weekly: null,
      today: TODAY,
    });
    expect(window[0]).toBe("2026-10-29");
    expect(window[6]).toBe("2026-11-04");
    expect(result.noAds.map((r) => r.sku)).toEqual(["SHILAJIT"]);
    expect(result.noAds[0].spendUnknownFrom).toBe("2026-11-04");
    expect(result.unknownSpend).toBe(1);
    expect(result.notes.join(" ")).toMatch(/desde el 29 oct/);
  });

  it("a variant only 'sold before' when its whole product dropped", () => {
    const result = buildUnadvertised({
      catalog: [
        { key: "sku:fat.burn.negro.s", sku: "FAT.BURN.NEGRO.S", name: "Negro" },
        { key: "sku:fat.burn.beige.s", sku: "FAT.BURN.BEIGE.S", name: "Beige" },
      ],
      stock: [stock("FAT.BURN.NEGRO.S", 400), stock("FAT.BURN.BEIGE.S", 178)],
      campaigns: [],
      spend: [],
      weekly: {
        blocks,
        units: {
          // After the switch every order goes to the learned (negro) SKU.
          "sku:fat.burn.negro.s": [30, 30, 15, 15, 15, 15, 15, 15],
          "sku:fat.burn.beige.s": [0, 0, 15, 15, 15, 15, 15, 15],
        },
      },
      today: TODAY,
    });
    expect(result.soldBefore).toEqual([]);
  });
});
