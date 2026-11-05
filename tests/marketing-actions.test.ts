import { describe, expect, it } from "vitest";
import {
  accountLabel,
  buildCampaignActionRows,
  campaignType,
  evaluateCampaignRules,
  type CampaignActionRow,
  type Window,
} from "../lib/marketing-actions";
import { buildMarketingSummary, type MarketingSummary } from "../lib/marketing";
import { buildProductFamilies } from "../lib/marketing-product-groups-server";
import { coverageOf } from "../lib/marketing-coverage";
import { MARKETING_TARGETS } from "../lib/marketing-targets";
import { shiftDate } from "../lib/marketing-dates";
import type {
  MarketingControl,
  RealOrderDay,
} from "../lib/marketing-real-orders";
import type {
  ManualCampaignChange,
  MarketingSources,
} from "../lib/marketing-source-types";
import type { OrderProfitabilityRow } from "../lib/finance-orders";
import type { UsdRate } from "../lib/marketing-charlie-types";

const now = new Date("2026-11-05T20:35:00Z"); // 14:35 CR, 5 nov
const TODAY = "2026-11-05";
const ctx = { now, t: MARKETING_TARGETS };
/** es-CR money uses a no-break space after the currency code. */
const plain = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value).replace(/\u00a0|\u202f/g, " "));
const rules = (row: Omit<CampaignActionRow, "action" | "notes">) =>
  plain(evaluateCampaignRules(row, ctx));
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
type Base = Omit<CampaignActionRow, "action" | "notes">;
const row = (patch: Partial<Base> = {}): Base => ({
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
  days3: w({ spendNative: 79, spendUsd: 79, real: 10, cpaReal: 7.9 }),
  days7: w(),
  launch: {
    date: "2026-10-01",
    ageDays: 35,
    lifetimeSpendNative: 900,
    testSpend: 900,
    lifetimeReal: null,
    lifetimePixel: 80,
    inTest: false,
  },
  lastChange: null,
  lastStatusChange: null,
  changesStatus: "activity",
  ...patch,
});
const test = (testSpend: number, orders: number, patch: Partial<Base> = {}) =>
  row({
    launch: {
      date: "2026-11-01",
      ageDays: 4,
      lifetimeSpendNative: testSpend,
      testSpend,
      lifetimeReal: orders,
      lifetimePixel: orders,
      inTest: true,
    },
    days3: w({
      spendNative: testSpend,
      spendUsd: testSpend,
      real: orders,
      cpaReal: orders > 0 ? testSpend / orders : null,
    }),
    ...patch,
  });
const change = (h: number, kind: "presupuesto" | "puja" = "presupuesto") => ({
  platform: "meta" as const,
  accountId: "1",
  campaignId: "9",
  at: hoursAgo(h),
  kind,
  detail: "",
  source: "meta" as const,
});

describe("reglas de la tabla de acciones", () => {
  it("applies the Meta test rules (US$17 without sale, US$40 with 3 orders)", () => {
    expect(rules(test(17, 0)).action).toMatchObject({
      code: "apagar_prueba",
      label: "Apagar",
      tone: "risk",
      detail:
        "Prueba: USD 17,00 gastados sin venta (meta: venta antes de USD 17,00).",
    });
    // Nothing else to say in the last 3 days: the verdict is the action.
    expect(rules(test(40, 3, { days3: w() })).action).toMatchObject({
      code: "paso_prueba",
      label: "Pasó la prueba",
      detail: "USD 40,00 con 3 pedidos reales.",
    });
    // Estimated orders are not rounded up to pass, nor down to "no sale".
    expect(rules(test(45, 2.5, { days3: w() })).action).toMatchObject({
      code: "cpa_alto",
      label: "No pasó la prueba",
      detail: "USD 45,00 y 2,5 pedidos reales (se piden 3).",
    });
    expect(rules(test(20, 0.4)).action.code).toBe("en_prueba");
    expect(rules(test(41, 2)).action).toMatchObject({
      code: "cpa_alto",
      label: "No pasó la prueba",
      detail: "USD 41,00 y 2 pedidos reales (se piden 3).",
    });
    expect(rules(test(12, 1)).action).toMatchObject({
      code: "en_prueba",
      tone: "wait",
      detail: "USD 12,00 de USD 40,00 · 1 pedidos reales.",
    });
    // Without real orders nothing is decided with the pixel.
    const pixel = test(45, 0);
    pixel.launch.lifetimeReal = null;
    pixel.launch.lifetimePixel = 4;
    expect(rules(pixel).action).toMatchObject({
      code: "en_prueba",
      tone: "wait",
      detail:
        "USD 45,00 gastados · pedidos reales no disponibles (píxel: 4). No se decide con el píxel.",
    });
  });
  it("does not ask to turn off a test that is already off", () => {
    const off = test(65, 0, {
      platform: "tiktok",
      currency: "PEN",
      status: null,
      today: w(),
      yesterday: w(),
      days3: w(),
    });
    expect(rules(off).action).toMatchObject({
      code: "pausada",
      label: "Prueba apagada",
      tone: "info",
    });
  });
  it("hands a passed test over to the CPA and scale rules", () => {
    const passed = (cpa: number) =>
      test(1200, 90, {
        launch: {
          date: "2026-10-28",
          ageDays: 8,
          lifetimeSpendNative: 1200,
          testSpend: 1200,
          lifetimeReal: 90,
          lifetimePixel: 95,
          inTest: true,
        },
        days3: w({
          spendNative: cpa * 20,
          spendUsd: cpa * 20,
          real: 20,
          cpaReal: cpa,
        }),
      });
    const high = rules(passed(14));
    expect(high.action).toMatchObject({ code: "cpa_alto", label: "CPA alto" });
    expect(high.notes.map((n) => n.code)).toEqual(["paso_prueba"]);
    const good = rules(passed(6));
    expect(good.action.code).toBe("escalar");
    expect(good.action.detail).toContain("Toca: hoy.");
    expect(good.notes.map((n) => n.code)).toEqual(["paso_prueba"]);
  });
  it("flags spend with zero real orders as CPA above the target", () => {
    const result = rules(
      row({ days3: w({ spendNative: 180, spendUsd: 180, real: 0 }) }),
    );
    expect(result.action).toMatchObject({
      code: "cpa_alto",
      tone: "risk",
      detail:
        "Sin pedidos reales en 3 días con USD 180,00 de gasto (meta USD 8,50 por pedido).",
    });
    // Below the target CPA, a day without orders is not yet a signal.
    expect(
      rules(row({ days3: w({ spendNative: 5, spendUsd: 5, real: 0 }) })).action
        .code,
    ).toBe("mantener");
  });
  it("starts the 72 h hold only after budget, bid, creative or launch changes", () => {
    // Status changes are kept apart by the builder (lastStatusChange).
    const result = rules(
      row({
        lastStatusChange: {
          ...change(20),
          kind: "estado",
        },
      }),
    );
    expect(result.action.code).toBe("escalar");
  });
  it("applies the TikTok test rules in soles (S/60, S/200 with 5)", () => {
    const tiktok = {
      platform: "tiktok" as const,
      currency: "PEN",
      status: null,
    };
    expect(rules(test(60, 0, tiktok)).action).toMatchObject({
      code: "apagar_prueba",
      detail:
        "Prueba: PEN 60,00 gastados sin venta (meta: venta antes de PEN 60,00).",
    });
    expect(rules(test(200, 5, { ...tiktok, days3: w() })).action.code).toBe(
      "paso_prueba",
    );
    expect(rules(test(200, 4, tiktok)).action.code).toBe("cpa_alto");
  });
  it("scales +20% when the 3-day real CPA is within target and the last change is 72 h old", () => {
    const result = rules(row({ lastChange: change(80) }));
    expect(result.action).toMatchObject({
      code: "escalar",
      label: "Escalar +20%",
      tone: "good",
      detail:
        "CPA real 3 días USD 7,90. Presupuesto USD 50,00 → USD 60,00. Toca: hoy.",
      due: now.toISOString(),
    });
    expect(
      rules(row({ dailyBudget: null, lastChange: change(80) })).action.detail,
    ).toBe("CPA real 3 días USD 7,90. Subir 20% el presupuesto. Toca: hoy.");
  });
  it("asks to confirm 72 h when there is no change log", () => {
    for (const changesStatus of ["unavailable", "manual"] as const)
      expect(rules(row({ changesStatus })).action.detail).toContain(
        "Sin registro de cambios: confirma que no se tocó en 72 h.",
      );
    expect(rules(row()).action.detail).not.toContain("Sin registro");
    // An incomplete Meta log (catalog failed) still asks to confirm.
    expect(
      rules(row({ changesStatus: "unavailable", lastChange: change(80) }))
        .action.detail,
    ).toContain(
      "Registro de cambios incompleto: confirma que no se tocó en 72 h.",
    );
  });
  it("holds after a change and says when it can be scaled", () => {
    const at = change(30);
    const result = rules(row({ lastChange: at }));
    const due = new Date(Date.parse(at.at) + 72 * 3_600_000).toISOString();
    expect(result.action).toMatchObject({
      code: "en_espera",
      label: "En espera, no tocar",
      tone: "wait",
      due,
    });
    expect(result.action.detail).toBe(
      "Último cambio hace 30 h (presupuesto). Se puede tocar desde el 7 nov, 08:35.",
    );
    expect(result.notes).toEqual([
      expect.objectContaining({
        code: "escalar",
        due,
        detail: "Si sigue así, escalar +20% el 7 nov, 08:35.",
      }),
    ]);
    expect(
      rules(row({ lastChange: change(60, "puja") })).action.detail,
    ).toContain("(ya pasó el mínimo de 48 h)");
  });
  it("pauses for stock before anything else and reactivates paused campaigns that got stock", () => {
    const red = rules(row({ coverage: coverageOf(5, 14) }));
    expect(red.action).toMatchObject({
      code: "pausar_stock",
      label: "Pausar por stock",
      detail: "Gomitas: 2,5 días de stock.",
    });
    expect(red.notes.map((n) => n.code)).toContain("escalar");
    expect(rules(row({ coverage: coverageOf(0, 14) })).action.detail).toBe(
      "Gomitas: agotado.",
    );
    const restocked = (patch: Partial<Base> = {}) =>
      row({
        status: "pausada",
        restocked: 300,
        restockedFromLow: true,
        coverage: coverageOf(300, 70),
        days7: w({ spendNative: 50, spendUsd: 50, real: 8, cpaReal: 6.25 }),
        ...patch,
      });
    expect(rules(restocked()).action).toMatchObject({
      code: "reactivar",
      tone: "good",
      detail: "Entró stock: +300 u. · 30 días de cobertura.",
    });
    // Only campaigns stopped for stock: not old ones, not those with a high
    // CPA, not when the product had stock, not with an old inventory file.
    expect(rules(restocked({ days7: w() })).action).toMatchObject({
      code: "pausada",
      detail:
        "Entró stock (+300 u.), pero lleva más de 7 días sin gasto. Revisa antes de reactivar.",
    });
    expect(
      rules(
        restocked({
          days7: w({ spendNative: 90, spendUsd: 90, real: 0 }),
        }),
      ).action.detail,
    ).toContain("no tuvo pedidos reales en 7 días");
    expect(
      rules(restocked({ restockedFromLow: false })).action.detail,
    ).toContain("el producto tenía stock antes");
    expect(rules(restocked({ stockStale: "2026-11-02" })).action).toMatchObject(
      {
        code: "pausada",
        detail:
          "Entró stock (+300 u.), pero el inventario es del 2 nov. Revisa antes de reactivar.",
      },
    );
    expect(
      rules(row({ coverage: coverageOf(5, 14), stockStale: "2026-11-02" }))
        .action.code,
    ).not.toBe("pausar_stock");
    const paused = rules(row({ status: "pausada" }));
    expect(paused.action.code).toBe("pausada");
    expect(paused.notes[0].detail).toBe(
      "Sin registro de reposición (falta el archivo de un día anterior).",
    );
    expect(rules(row({ status: "pausada", restocked: 0 })).notes).toEqual([]);
  });
  it("asks for the product, flags high CPA and waits for TikTok data", () => {
    expect(rules(row({ product: null })).action).toMatchObject({
      code: "asignar_producto",
      label: "Asigna el producto",
      detail: "Sin producto no hay pedidos reales ni stock.",
    });
    expect(
      rules(
        row({
          days3: w({
            spendNative: 112,
            spendUsd: 112,
            real: 10,
            cpaReal: 11.2,
          }),
        }),
      ).action,
    ).toMatchObject({
      code: "cpa_alto",
      detail: "CPA real 3 días USD 11,20 (meta USD 8,50).",
    });
    expect(
      rules(
        row({
          platform: "tiktok",
          status: null,
          dataThrough: "2026-11-03",
          days3: w({
            spendNative: 70,
            spendUsd: 20,
            partial: true,
            real: 2,
            cpaReal: 10,
          }),
        }),
      ),
    ).toMatchObject({
      action: { code: "cpa_alto" },
      notes: [
        {
          code: "sin_datos",
          label: "Esperando datos",
          detail: "TikTok envía el día siguiente; faltan datos del 4 nov.",
        },
      ],
    });
    expect(
      rules(
        row({
          platform: "tiktok",
          status: null,
          dataThrough: "2026-11-03",
          days3: w({ spendNative: 0, spendUsd: 0, partial: true }),
        }),
      ).action.code,
    ).toBe("sin_datos");
    expect(rules(row({ days3: w() })).action).toMatchObject({
      code: "mantener",
      detail: "Sin gasto en los últimos 3 días.",
    });
  });
  it("labels accounts and campaign types", () => {
    expect(accountLabel("meta", "1", "Arqui Nexo DC003 CR4", [])).toBe("CR4");
    expect(accountLabel("meta", "1", "Jam mini vlog CR3", [])).toBe("CR3");
    expect(
      accountLabel("meta", "1", "Arqui Nexo DC003 CR4", [
        { platform: "meta", account_id: "1", label: "Madre" },
      ]),
    ).toBe("Madre");
    expect(accountLabel("tiktok", "7", "Mireva", [])).toBe("TikTok");
    expect(accountLabel("meta", "2", "Cuenta principal", [])).toBe(
      "Cuenta principal",
    );
    const c = (patch: object) => ({ name: "Algo", ...patch });
    expect(campaignType(c({ bidStrategy: "COST_CAP" }), "meta")).toBe(
      "COST CAP",
    );
    expect(campaignType(c({ name: "COST CAP_SELERB NAD" }), "meta")).toBe(
      "COST CAP",
    );
    expect(campaignType(c({ budgetKind: "campaign" }), "meta")).toBe("CBO");
    expect(campaignType(c({ budgetKind: "adsets" }), "meta")).toBe("ABO");
    expect(campaignType(c({ name: "CBO GOMITAS" }), "tiktok")).toBe("CBO");
    expect(campaignType(c({}), "tiktok")).toBe("Sin dato");
  });
});

describe("tabla de acciones con datos", () => {
  const fx: UsdRate = {
    rate: 505,
    date: TODAY,
    source: "hacienda",
    checkedAt: now.toISOString(),
    message: "",
    pen: { rate: 3.5, date: TODAY, source: "bcrp" },
  };
  const orders = Array.from({ length: 14 }, (_, i) => ({
    order_key: String(i),
    created_at: `${shiftDate(TODAY, -1 - (i % 7))}T15:00:00Z`,
    tracking_status: "pending",
    items: [
      { sku: "GOMITAS/SHILAJIT", title: "Gomitas", quantity: 1, price: 1 },
    ],
    settlement_count: 0,
    missing_cost_skus: [],
  })) as unknown as OrderProfitabilityRow[];
  const summary: MarketingSummary = buildMarketingSummary({
    orders,
    expenses: [],
    from: shiftDate(TODAY, -13),
    to: TODAY,
    now,
  });
  summary.productFamilies = buildProductFamilies(summary.catalog, [
    {
      shopify_id: "10390702686524",
      title: "Gomitas de Shilajit 100% Puro del Himalaya (Pack de 60 Gomitas)",
      variants: [{ sku: "GOMITAS/SHILAJIT", title: "Gomitas" }],
    },
  ]);
  const dates = Array.from({ length: 14 }, (_, i) => shiftDate(TODAY, i - 13));
  const control: MarketingControl = {
    from: dates[0],
    to: TODAY,
    today: TODAY,
    generatedAt: now.toISOString(),
    origins: "ok",
    pace: null,
    days: dates.map(
      (date): RealOrderDay => ({
        date,
        created: 3,
        real: 3,
        withCampaign: 1,
        byCampaign: { "meta:9": 1 },
        byAd: {},
        unlinkedBySku: { "sku:gomitas/shilajit": 2 },
        unlinkedNoProduct: 0,
      }),
    ),
  };
  const sources = (): MarketingSources => ({
    meta: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: {
        accounts: [
          {
            accountId: "1",
            accountName: "Arqui Nexo DC003 CR4",
            currency: "USD",
            timezone: "America/Costa_Rica",
            changesStatus: "activity",
            changes: [
              {
                platform: "meta",
                accountId: "1",
                campaignId: "9",
                at: hoursAgo(100),
                kind: "puja",
                detail: "",
                source: "meta",
              },
              {
                platform: "meta",
                accountId: "1",
                campaignId: "9",
                at: hoursAgo(5),
                kind: "estado",
                detail: "update_ad_run_status",
                source: "meta",
              },
            ],
            campaigns: [
              {
                id: "9",
                name: "CBO GOMITAS | CR",
                spend: 140,
                impressions: 0,
                clicks: 0,
                budgetKind: "campaign",
                dailyBudget: 50,
                effectiveStatus: "ACTIVE",
                daily: dates.map((date) => ({
                  date,
                  spend: 10,
                  impressions: 0,
                  clicks: 0,
                  purchases: 2,
                })),
                lifetime: {
                  spend: 900,
                  purchases: 80,
                  firstDate: "2026-09-01",
                },
              },
            ],
          },
        ],
      },
    },
    tiktok: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: {
        accounts: [
          {
            accountId: "7",
            currency: "PEN",
            timezone: "America/Costa_Rica",
            campaigns: [
              {
                id: "70",
                name: "CBO GOMITAS",
                spend: 100,
                impressions: 0,
                clicks: 0,
                daily: dates
                  .filter((d) => d <= "2026-11-03")
                  .map((date) => ({
                    date,
                    spend: 7,
                    impressions: 0,
                    clicks: 0,
                    purchases: 1,
                  })),
              },
            ],
          },
        ],
      },
    },
    shiphero: {
      status: "ready",
      checkedAt: "",
      message: "",
      data: {
        stock: [
          {
            sku: "GOMITAS/SHILAJIT",
            warehouseId: "csv",
            available: 6,
            onHand: 6,
            allocated: 0,
          },
        ],
        origin: "csv",
        previous: null,
      },
    },
  });
  const launch = (
    productKey: string,
    campaignId: string,
  ): ManualCampaignChange => ({
    platform: "tiktok",
    accountId: "7",
    campaignId,
    at: hoursAgo(2),
    kind: "lanzamiento",
    detail: "",
    source: "manual",
    id: campaignId,
    by: "Ana",
    campaignName: "",
    productKey,
  });

  it("builds windows with estimated real orders, coverage and the action per campaign", () => {
    const result = buildCampaignActionRows({
      summary,
      sources: sources(),
      control,
      settings: { mappings: [], plans: [], keywords: [], accountLabels: [] },
      manualChanges: [launch("p1", "70")],
      fx,
      now,
    });
    expect(result.meta).toHaveLength(1);
    const meta = result.meta[0];
    expect(meta).toMatchObject({
      accountLabel: "CR4",
      type: "CBO",
      status: "activa",
      product: { automatic: true, reason: "Palabra clave: GOMITAS" },
      launch: { date: "2026-09-01", inTest: false, lifetimeReal: null },
      lastChange: { kind: "puja" },
      changesStatus: "activity",
    });
    // 14 units in 7 days → 2 a day; 6 available → 3 days (yellow, not red).
    expect(meta.coverage).toMatchObject({ tone: "yellow", days: 3 });
    // Meta and TikTok share the product. TikTok has not reported 4 nov yet,
    // so the split uses its 3 nov spend (PEN 7 = USD 2): 1 UTM + 2 × 10/12.
    expect(meta.yesterday).toMatchObject({
      spendUsd: 10,
      utm: 1,
      partial: false,
    });
    expect(meta.yesterday.real).toBeCloseTo(1 + (2 * 10) / 12, 3);
    expect(meta.days3.spendUsd).toBe(30);
    expect(meta.action.code).toBe("escalar");
    expect(result.tiktok[0]).toMatchObject({
      accountLabel: "TikTok",
      status: null,
      changesStatus: "manual",
      dataThrough: "2026-11-03",
    });
    expect(result.tiktok[0].days3.partial).toBe(true);
    // A pause of one ad 5 h ago does not start the 72 h hold.
    expect(meta.lastStatusChange).toMatchObject({ kind: "estado" });
    // TikTok days Make has not sent are unknown, not zero.
    expect(result.tiktok[0].today).toMatchObject({
      spendNative: null,
      spendUsd: null,
      pixel: null,
    });
    expect(result.tiktok[0].yesterday.spendNative).toBeNull();
    expect(result.tiktok[0].days3).toMatchObject({
      spendNative: 14,
      pixel: 2,
      partial: true,
    });
    expect(result.unavailable).toEqual({ meta: null, tiktok: null });
    expect(result).toMatchObject({
      tiktokLaunchesToday: 1,
      launchLimitReached: false,
    });
    expect(result.notes).toContain(
      "Lanzamientos de hoy en TikTok: 1 de 2 (registrados a mano).",
    );
  });
  it("says when a source failed and ignores stock rules with an old file", () => {
    const s = sources();
    s.tiktok = { status: "error", checkedAt: "", message: "", data: null };
    s.shiphero.data!.snapshotDate = "2026-11-02";
    const result = buildCampaignActionRows({
      summary,
      sources: s,
      control,
      settings: { mappings: [], plans: [], keywords: [], accountLabels: [] },
      manualChanges: [],
      fx,
      now,
    });
    expect(result.tiktok).toEqual([]);
    expect(result.unavailable.tiktok).toBe(
      "No se pudo consultar TikTok. Sus campañas no aparecen y las reglas quedan sin evaluar.",
    );
    expect(result.meta[0].stockStale).toBe("2026-11-02");
    expect(plain(result.notes)).toContain(
      "El inventario es del 2 nov: las reglas de stock quedan sin evaluar. Sube el archivo de hoy.",
    );
  });
  it("reaches the TikTok launch limit with two products launched today", () => {
    const result = buildCampaignActionRows({
      summary,
      sources: sources(),
      control,
      settings: null,
      manualChanges: [
        launch("p1", "70"),
        launch("p1", "71"),
        launch("p2", "72"),
      ],
      fx,
      now,
    });
    expect(result).toMatchObject({
      tiktokLaunchesToday: 2,
      launchLimitReached: true,
    });
    expect(result.notes).toContain(
      "Ya se lanzaron 2 productos hoy en TikTok: límite de lanzamientos alcanzado.",
    );
    // Without settings nothing is assigned automatically.
    expect(result.meta[0].action.code).toBe("asignar_producto");
  });
});
