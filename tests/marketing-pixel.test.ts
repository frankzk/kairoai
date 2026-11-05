import { describe, expect, it } from "vitest";
import {
  buildPixelReport,
  pixelTone,
  type PixelReport,
} from "../lib/marketing-pixel";
import type {
  AssignedCampaign,
  CampaignEstimates,
  CampaignRealDay,
} from "../lib/marketing-real-cpa";
import type { RealOrderDay } from "../lib/marketing-real-orders";
import type { MarketingAdsData } from "../lib/marketing-source-types";
import { shiftDate } from "../lib/marketing-dates";
import { MARKETING_TARGETS } from "../lib/marketing-targets";

const TODAY = "2026-11-05";
const YESTERDAY = "2026-11-04";
/** The 14 control days: today−13..today. */
const DATES = Array.from({ length: 14 }, (_, i) => shiftDate(TODAY, i - 13));
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/ | /g, " "));

const controlDays: RealOrderDay[] = DATES.map((date) => ({
  date,
  created: 0,
  real: 0,
  withCampaign: 0,
  byCampaign: {},
  byAd: {},
  unlinkedBySku: {},
  unlinkedNoProduct: 0,
}));

const account = (
  accountId: string,
  accountName: string,
  currency = "USD",
): MarketingAdsData => ({
  accountId,
  accountName,
  currency,
  timezone: "America/Costa_Rica",
  campaigns: [],
});

type Day = {
  pixel: number | null;
  real: number | null;
  utm?: number;
  spend?: number;
};
/** A campaign with the same pixel/real/spend every day of `dates`. */
function campaign(input: {
  platform?: "meta" | "tiktok";
  account: MarketingAdsData;
  id: string;
  product?: { key: string; name: string } | null;
  days: Record<string, Day>;
  observedThrough?: string | null;
}): { c: AssignedCampaign; estimates: Map<string, CampaignRealDay> } {
  const platform = input.platform ?? "meta";
  const key = `${platform}:${input.account.accountId}:${input.id}`;
  const product =
    input.product === undefined
      ? { key: "family:x", name: "X" }
      : input.product;
  const daily = Object.entries(input.days).map(([date, d]) => ({
    date,
    spend: d.spend ?? 10,
    impressions: 0,
    clicks: 0,
    purchases: d.pixel,
  }));
  const estimates = new Map<string, CampaignRealDay>();
  for (const date of DATES) {
    const d = input.days[date];
    const utm = d?.utm ?? 0;
    estimates.set(
      date,
      !product
        ? { utm, assigned: 0, total: utm, partial: true, unassigned: true }
        : d && d.real == null
          ? { utm, assigned: 0, total: null, partial: true }
          : {
              utm,
              assigned: (d?.real ?? 0) - utm,
              total: d?.real ?? 0,
              partial: false,
            },
    );
  }
  return {
    c: {
      key,
      platform,
      account: input.account,
      campaign: {
        id: input.id,
        name: `Campaña ${input.id}`,
        spend: 0,
        impressions: 0,
        clicks: 0,
        daily,
      },
      mapping: product
        ? {
            platform,
            account_id: input.account.accountId,
            campaign_id: input.id,
            product_key: product.key,
            product_name: product.name,
            sku: "",
            variant_scope: "all",
          }
        : null,
      members: product ? [product.key] : [],
      observedThrough:
        input.observedThrough === undefined
          ? (daily
              .map((d) => d.date)
              .sort()
              .at(-1) ?? null)
          : input.observedThrough,
    },
    estimates,
  };
}

function report(
  list: Array<ReturnType<typeof campaign>>,
  windowDays?: number,
): PixelReport {
  const estimates: CampaignEstimates = new Map(
    list.map((x) => [x.c.key, x.estimates]),
  );
  return plain(
    buildPixelReport({
      campaigns: list.map((x) => x.c),
      estimates,
      days: controlDays,
      labels: [],
      fx: null,
      windowDays,
      today: TODAY,
    }),
  );
}

/** `n` days ending yesterday with the same values. */
const lastDays = (n: number, day: Day) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [shiftDate(YESTERDAY, -i), day]),
  );

const cr2 = account("2", "Mireva CR2");
const cr4 = account("4", "Mireva CR4");
const tiktok = account("t1", "Mireva TikTok", "PEN");
const nad = { key: "family:nad", name: "NAD+ Men's Complex" };
const magnesium = { key: "family:mag", name: "Magnesium" };

describe("pixelTone", () => {
  it("reads the factor against the team thresholds", () => {
    expect(pixelTone(41, 19)).toBe("de_mas");
    expect(pixelTone(10, 20)).toBe("de_menos");
    expect(pixelTone(20, 19)).toBe("alineado");
    expect(pixelTone(8, 2)).toBe("poco_dato");
    expect(pixelTone(3, 0)).toBe("sin_reales");
    expect(pixelTone(0, 0)).toBe("poco_dato");
  });
});

describe("buildPixelReport", () => {
  it("compares pixel and real orders per account and product (CR2 NAD+ 41 vs 19)", () => {
    // 7 days: CR2 NAD+ ends with 41 pixel vs 19 real; CR4 under-counts.
    const nadDays = lastDays(7, { pixel: 6, real: 3, utm: 1 });
    nadDays[YESTERDAY] = { pixel: 5, real: 1, utm: 1 };
    const out = report([
      campaign({ account: cr2, id: "a", product: nad, days: nadDays }),
      campaign({
        account: cr4,
        id: "b",
        product: magnesium,
        days: lastDays(7, { pixel: 2, real: 5 }),
      }),
    ]);
    expect(out.window).toEqual({ from: "2026-10-29", to: YESTERDAY, days: 7 });
    const cr2Row = out.accounts.find((a) => a.label === "CR2")!;
    expect(cr2Row).toMatchObject({
      pixel: 41,
      real: 19,
      utm: 7,
      tone: "de_mas",
      days: 7,
      campaigns: 1,
    });
    expect(cr2Row.factor).toBeCloseTo(2.158, 3);
    expect(cr2Row.detail).toBe(
      "Registra 2,16 compras por cada pedido real: el CPA del píxel se ve mejor de lo que es.",
    );
    expect(out.accounts.find((a) => a.label === "CR4")).toMatchObject({
      pixel: 14,
      real: 35,
      tone: "de_menos",
    });
    expect(out.accountProducts.map((g) => g.label)).toEqual([
      "CR4 · Magnesium",
      "CR2 · NAD+ Men's Complex",
    ]);
    expect(
      out.products.find((p) => p.productKey === "family:nad"),
    ).toMatchObject({
      platform: "meta",
      pixel: 41,
      real: 19,
    });
    expect(out.platforms).toHaveLength(1);
    expect(out.platforms[0]).toMatchObject({
      label: "Meta",
      pixel: 55,
      real: 54,
      tone: "alineado",
    });
    expect(out.utmShare).toBeCloseTo(7 / 54, 5);
    expect(out.health).toEqual([]);
  });

  it("leaves campaigns without product out and counts them", () => {
    const out = report([
      campaign({
        account: cr2,
        id: "a",
        product: nad,
        days: lastDays(7, { pixel: 2, real: 2 }),
      }),
      campaign({
        account: cr2,
        id: "b",
        product: null,
        days: lastDays(7, { pixel: 4, real: 0, utm: 1 }),
      }),
    ]);
    expect(out.excludedCampaigns).toBe(1);
    expect(out.notes).toContain(
      "1 campaña sin producto no entra en la comparación.",
    );
    expect(out.accounts[0]).toMatchObject({
      pixel: 14,
      real: 14,
      campaigns: 1,
    });
  });

  it("skips TikTok days Make has not sent and groups TikTok products apart from Meta", () => {
    const tiktokDays = lastDays(7, { pixel: 9, real: 6 });
    tiktokDays[YESTERDAY] = { pixel: null, real: null }; // not sent yet
    const out = report([
      campaign({
        account: cr2,
        id: "a",
        product: nad,
        days: lastDays(7, { pixel: 5, real: 5 }),
      }),
      campaign({
        platform: "tiktok",
        account: tiktok,
        id: "t",
        product: nad,
        days: tiktokDays,
        observedThrough: shiftDate(YESTERDAY, -1),
      }),
    ]);
    const tk = out.platforms.find((p) => p.platform === "tiktok")!;
    expect(tk).toMatchObject({ pixel: 54, real: 36, days: 6, tone: "de_mas" });
    expect(
      out.products.filter((p) => p.productKey === "family:nad"),
    ).toHaveLength(2);
    expect(out.tiktokThrough).toBe("2026-11-03");
    expect(out.notes).toContain(
      "TikTok hasta el 3 nov (llega al día siguiente por Make).",
    );
  });

  it("marks few orders and pixel without real orders", () => {
    const out = report([
      campaign({
        account: cr2,
        id: "a",
        product: magnesium,
        days: { [YESTERDAY]: { pixel: 8, real: 2 } },
      }),
      campaign({
        account: cr4,
        id: "b",
        product: nad,
        days: { [YESTERDAY]: { pixel: 3, real: 0 } },
      }),
    ]);
    expect(out.accounts.find((a) => a.label === "CR2")).toMatchObject({
      tone: "poco_dato",
      factor: 4,
      detail: "Menos de 5 pedidos reales: compara más días.",
    });
    expect(out.accounts.find((a) => a.label === "CR4")).toMatchObject({
      tone: "sin_reales",
      factor: null,
    });
  });

  it("never compares today and honours the window", () => {
    const days = lastDays(10, { pixel: 2, real: 2 });
    days[TODAY] = { pixel: 50, real: 1 };
    const list = [campaign({ account: cr2, id: "a", product: nad, days })];
    expect(report(list, 3).accounts[0]).toMatchObject({
      pixel: 6,
      real: 6,
      days: 3,
    });
    expect(report(list, 7).accounts[0]).toMatchObject({
      pixel: 14,
      real: 14,
      days: 7,
    });
    expect(report(list, 13).accounts[0]).toMatchObject({
      pixel: 20,
      real: 20,
      days: 13,
    });
  });

  it("alerts when a pixel registers 0 with real orders", () => {
    const days = lastDays(5, { pixel: 5, real: 5 });
    days["2026-11-02"] = { pixel: 0, real: 4 };
    const out = report([
      campaign({ account: cr4, id: "a", product: nad, days }),
    ]);
    expect(out.health).toEqual([
      expect.objectContaining({
        code: "sin_conversiones",
        accountLabel: "CR4",
        date: "2026-11-02",
        pixel: 0,
        real: 4,
        title: "Píxel de CR4 sin compras el 2 nov",
        detail:
          "≈ 4 pedidos reales y 0 compras en el píxel con USD 10,00 de gasto.",
      }),
    ]);
  });

  it("no 'sin compras' when a campaign without product of the account bought", () => {
    const days = lastDays(5, { pixel: 5, real: 5 });
    days["2026-11-03"] = { pixel: 0, real: 5 };
    const out = report([
      campaign({ account: cr4, id: "a", product: nad, days }),
      campaign({
        account: cr4,
        id: "b",
        product: null,
        days: { "2026-11-03": { pixel: 6, real: null, spend: 30 } },
      }),
    ]);
    expect(out.health).toEqual([]);
  });

  it("alerts on a collapse against the usual factor (TikTok 26 oct shape)", () => {
    const days: Record<string, Day> = {
      "2026-10-21": { pixel: 26, real: 25 },
      "2026-10-22": { pixel: 24, real: 25 },
      "2026-10-23": { pixel: 25, real: 25 },
      "2026-10-24": { pixel: 27, real: 25 },
      "2026-10-25": { pixel: 25, real: 25 },
      "2026-10-26": { pixel: 3, real: 25 },
      "2026-10-27": { pixel: 20, real: 25 },
    };
    const out = report([
      campaign({
        platform: "tiktok",
        account: tiktok,
        id: "t",
        product: nad,
        days,
        observedThrough: YESTERDAY,
      }),
    ]);
    expect(out.health).toHaveLength(1);
    expect(out.health[0]).toMatchObject({
      code: "caida",
      platform: "tiktok",
      accountLabel: "TikTok",
      date: "2026-10-26",
      pixel: 3,
      real: 25,
      title: "Píxel de TikTok cayó el 26 oct",
      detail:
        "Registró 3 conversiones con ≈ 25 pedidos reales; lo normal es 1,00 por pedido.",
    });
  });

  it("needs enough baseline days before alerting a collapse", () => {
    const days: Record<string, Day> = {
      "2026-10-25": { pixel: 25, real: 25 },
      "2026-10-26": { pixel: 3, real: 25 },
      "2026-10-27": { pixel: 24, real: 25 },
    };
    const out = report([
      campaign({ account: cr2, id: "a", product: nad, days }),
    ]);
    expect(MARKETING_TARGETS.pixelHealthBaselineDays).toBe(3);
    expect(out.health).toEqual([]);
  });
});
