import { describe, expect, it } from "vitest";
import { buildAttributionCostRows } from "../lib/marketing-attribution-cost";
import { periodFromInput } from "../lib/marketing-dates";
import type { AttributionGroup } from "../lib/marketing-attribution";
import type {
  CharlieReport,
  CharlieAccount,
} from "../lib/marketing-charlie-types";
const period = periodFromInput({ from: "2026-10-01", to: "2026-10-31" })!;
const group: AttributionGroup = {
  platform: "meta",
  campaignId: "111111",
  adsetId: "222222",
  adId: "333333",
  campaignName: "Campaña",
  adsetName: "Grupo",
  adName: "Anuncio",
  orders: 20,
  delivered: 10,
  failed: 5,
  open: 4,
  annulled: 1,
  deliveryRate: null,
};
const campaign = {
  platform: "meta" as const,
  id: "111111",
  name: "Nombre de Meta",
  accountId: "a",
  accountName: "Cuenta",
  currency: "USD",
  timezone: "America/Costa_Rica",
  spend: 100,
};
const account: CharlieAccount = {
  platform: "meta",
  id: "a",
  name: "Cuenta",
  currency: "USD",
  timezone: "America/Costa_Rica",
  adsets: [],
  ads: [
    {
      id: "333333",
      name: "Anuncio",
      campaignId: "111111",
      adsetId: "222222",
      effectiveStatus: "ACTIVE",
      postId: null,
      creativeId: null,
      assets: null,
      daily: [
        {
          date: "2026-10-01",
          spend: 20,
          impressions: 100,
          clicks: 10,
          frequency: null,
          purchases: 90,
          purchaseValue: 0,
          interactions: 0,
        },
        {
          date: "2026-10-02",
          spend: 10,
          impressions: 100,
          clicks: 10,
          frequency: null,
          purchases: 90,
          purchaseValue: 0,
          interactions: 0,
        },
        {
          date: "2026-11-01",
          spend: 999,
          impressions: 100,
          clicks: 10,
          frequency: null,
          purchases: 90,
          purchaseValue: 0,
          interactions: 0,
        },
      ],
    },
  ],
};
const report = (accounts = [account]): CharlieReport => ({
  status: "ready",
  checkedAt: "now",
  message: "",
  data: {
    accounts,
    from: period.from,
    to: period.to,
    trailFrom: period.from,
    trailTo: period.to,
  },
});
describe("inversión y costo por entregado UTM", () => {
  it("mantiene visibles campañas y anuncios con gasto pero sin pedidos vinculados", () => {
    expect(
      buildAttributionCostRows([], "campaign", [campaign], null, period)[0],
    ).toMatchObject({ orders: 0, spend: 100, costPerDelivered: null });
    expect(
      buildAttributionCostRows([], "ad", [campaign], report(), period)[0],
    ).toMatchObject({ orders: 0, spend: 30, costPerDelivered: null });
  });
  it("un anuncio con y sin ID de conjunto suma pedidos sin duplicar su gasto", () => {
    const rows = buildAttributionCostRows(
      [group, { ...group, adsetId: null }],
      "ad",
      [campaign],
      report(),
      period,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      delivered: 20,
      spend: 30,
      costPerDelivered: 1.5,
    });
    expect(
      buildAttributionCostRows(
        [group, { ...group, adsetId: "888888" }],
        "ad",
        [campaign],
        report(),
        period,
      )[0].costPerDelivered,
    ).toBeNull();
  });
  it("usa entregados, sin compras de plataforma ni pendientes/anulados en los denominadores", () => {
    const row = buildAttributionCostRows(
      [group],
      "campaign",
      [campaign],
      null,
      period,
    )[0];
    expect(row).toMatchObject({
      spend: 100,
      closed: 15,
      deliveryRate: 10 / 15,
      costPerDelivered: 10,
      currency: "USD",
    });
  });
  it("agrega pedidos antes de dividir y cuenta una sola vez el gasto de campaña", () => {
    const row = buildAttributionCostRows(
      [
        group,
        {
          ...group,
          adId: "444444",
          delivered: 2,
          failed: 1,
          orders: 3,
          open: 0,
          annulled: 0,
        },
      ],
      "campaign",
      [campaign],
      null,
      period,
    )[0];
    expect(row).toMatchObject({
      spend: 100,
      orders: 23,
      closed: 18,
      deliveryRate: 12 / 18,
      costPerDelivered: 100 / 12,
    });
  });
  it("usa el gasto propio del anuncio y excluye días fuera del rango", () => {
    expect(
      buildAttributionCostRows([group], "ad", [campaign], report(), period)[0],
    ).toMatchObject({ spend: 30, costPerDelivered: 3 });
  });
  it("no fabrica costo o tasa con denominador cero; distingue gasto cero real de gasto ausente", () => {
    const empty = { ...group, delivered: 0, failed: 0 };
    expect(
      buildAttributionCostRows(
        [empty],
        "campaign",
        [campaign],
        null,
        period,
      )[0],
    ).toMatchObject({ costPerDelivered: null, deliveryRate: null, spend: 100 });
    expect(
      buildAttributionCostRows(
        [group],
        "campaign",
        [{ ...campaign, spend: 0 }],
        null,
        period,
      )[0],
    ).toMatchObject({ costPerDelivered: 0, spend: 0 });
    expect(
      buildAttributionCostRows([group], "ad", [campaign], report([]), period)[0]
        .spend,
    ).toBeNull();
  });
  it("no reparte el gasto de campaña cuando falta el reporte del anuncio", () => {
    expect(
      buildAttributionCostRows([group], "ad", [campaign], null, period)[0]
        .costPerDelivered,
    ).toBeNull();
    expect(
      buildAttributionCostRows(
        [{ ...group, adId: null }],
        "ad",
        [campaign],
        report(),
        period,
      )[0].spend,
    ).toBeNull();
  });
  it("evita cruces entre plataformas, cuentas, campañas y conjuntos", () => {
    for (const bad of [
      { ...account, platform: "tiktok" as const },
      { ...account, id: "otra" },
      { ...account, ads: [{ ...account.ads[0], campaignId: "999999" }] },
      { ...account, ads: [{ ...account.ads[0], adsetId: "999999" }] },
    ]) {
      expect(
        buildAttributionCostRows(
          [group],
          "ad",
          [campaign],
          report([bad]),
          period,
        )[0].spend,
      ).toBeNull();
    }
    expect(
      buildAttributionCostRows(
        [group],
        "campaign",
        [campaign, { ...campaign, accountId: "b" }],
        report(),
        period,
      )[0].spend,
    ).toBeNull();
  });
  it("no calcula costo con otro calendario o período de inversión", () => {
    expect(
      buildAttributionCostRows(
        [group],
        "campaign",
        [{ ...campaign, timezone: "America/Lima" }],
        null,
        period,
      )[0],
    ).toMatchObject({ spend: 100, costPerDelivered: null });
    const stale = report();
    stale.data!.from = "2026-09-01";
    expect(
      buildAttributionCostRows([group], "ad", [campaign], stale, period)[0]
        .spend,
    ).toBeNull();
  });
  it("no duplica gasto si el reporte repite un anuncio/día", () => {
    expect(
      buildAttributionCostRows(
        [group],
        "ad",
        [campaign],
        report([{ ...account, ads: [...account.ads, account.ads[0]] }]),
        period,
      )[0].spend,
    ).toBeNull();
  });
  it("conserva la moneda de TikTok para la conversión USD existente y agrupa conjuntos", () => {
    const ttGroup = { ...group, platform: "tiktok" };
    const ttAccount = {
      ...account,
      platform: "tiktok" as const,
      currency: "PEN",
    };
    expect(
      buildAttributionCostRows(
        [ttGroup],
        "adset",
        [],
        report([ttAccount]),
        period,
      )[0],
    ).toMatchObject({ currency: "PEN", spend: 30, costPerDelivered: 3 });
  });
});
