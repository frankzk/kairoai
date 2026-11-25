// Marketing › Publicidad: reglas puras de la tabla (lib/marketing-publicidad.ts).
import { describe, expect, it } from "vitest";
import {
  availablePublicidadColumns,
  buildPublicidadRows,
  derivePublicidad,
  filterPublicidadRows,
  firstAction,
  leadsOfActions,
  mergeInsights,
  metaBudgetAmount,
  metaEntity,
  metaInsight,
  metaResult,
  pickBudget,
  publicidadRowUsd,
  publicidadStatus,
  publicidadTotals,
  purchaseValueOfActions,
  purchasesOfActions,
  realOrdersByRow,
  resultTypeLabel,
  sortPublicidadRows,
  tiktokAdRows,
  tiktokCampaignRows,
  type PublicidadEntity,
  type PublicidadInsight,
  type PublicidadRow,
} from "../lib/marketing-publicidad";
import type { UsdRate } from "../lib/marketing-charlie-types";

const fx: UsdRate = {
  rate: 500,
  date: "2026-11-25",
  source: "hacienda",
  checkedAt: "2026-11-25T12:00:00Z",
  message: "",
};
const account = { accountId: "123", accountName: "Mireva CR", currency: "USD" };
const insight = (over: Partial<PublicidadInsight>): PublicidadInsight => ({
  id: "c1",
  name: "Campaña",
  campaignId: "c1",
  campaignName: "Campaña",
  adsetId: "",
  adsetName: "",
  spend: 0,
  impressions: 0,
  clicks: 0,
  purchases: 0,
  purchaseValue: 0,
  leads: 0,
  results: null,
  resultType: null,
  costPerResult: null,
  ...over,
});
const entity = (over: Partial<PublicidadEntity>): PublicidadEntity => ({
  id: "c1",
  name: "Campaña",
  campaignId: "",
  adsetId: "",
  effectiveStatus: "ACTIVE",
  dailyBudget: null,
  lifetimeBudget: null,
  ...over,
});
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

describe("acciones de Meta", () => {
  it("cuenta las compras y su valor con el primer tipo canónico, sin sumar tipos que se solapan", () => {
    const actions = [
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "7" },
      { action_type: "purchase", value: "7" },
      { action_type: "omni_purchase", value: "8" },
      { action_type: "link_click", value: "90" },
    ];
    expect(purchasesOfActions(actions)).toBe(8);
    expect(purchasesOfActions(actions.slice(0, 2))).toBe(7);
    expect(
      purchasesOfActions([{ action_type: "link_click", value: "3" }]),
    ).toBe(0);
    expect(purchasesOfActions(undefined)).toBe(0);
    expect(
      purchaseValueOfActions([
        { action_type: "purchase", value: "150.5" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "150.5" },
      ]),
    ).toBe(150.5);
    expect(purchaseValueOfActions([])).toBe(0);
  });

  it("no cuenta dos veces el mismo lead entre lead, píxel y formulario", () => {
    expect(
      leadsOfActions([
        { action_type: "onsite_conversion.lead_grouped", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "6" },
        { action_type: "lead", value: "10" },
      ]),
    ).toBe(10);
    // Sin `lead`, el primero presente (nunca la suma).
    expect(
      leadsOfActions([
        { action_type: "onsite_conversion.lead_grouped", value: "4" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "6" },
      ]),
    ).toBe(6);
    expect(
      leadsOfActions([
        { action_type: "onsite_conversion.lead_grouped", value: "4" },
      ]),
    ).toBe(4);
    expect(leadsOfActions([{ action_type: "purchase", value: "2" }])).toBe(0);
  });

  it("rechaza una métrica malformada en vez de mostrar un cero falso", () => {
    expect(() =>
      firstAction([{ action_type: "lead", value: "abc" }], ["lead"]),
    ).toThrow();
    expect(() =>
      metaInsight({ campaign_id: "1", spend: "NaN" }, "campaign"),
    ).toThrow();
    expect(() =>
      metaInsight({ campaign_id: "1", spend: "-3" }, "campaign"),
    ).toThrow();
  });

  it("lee results / cost_per_result en sus formas conocidas y marca los tipos mezclados", () => {
    expect(
      metaResult([
        {
          indicator: "actions:offsite_conversion.fb_pixel_purchase",
          values: [
            { value: "9", attribution_windows: ["7d_click"] },
            { value: "12", attribution_windows: ["default"] },
          ],
        },
      ]),
    ).toEqual({ value: 12, type: "offsite_conversion.fb_pixel_purchase" });
    expect(
      metaResult([{ indicator: "actions:lead", values: [{ value: "5" }] }]),
    ).toEqual({ value: 5, type: "lead" });
    expect(metaResult([{ action_type: "link_click", value: "40" }])).toEqual({
      value: 40,
      type: "link_click",
    });
    expect(metaResult("3.5")).toEqual({ value: 3.5, type: null });
    expect(metaResult(undefined)).toEqual({ value: null, type: null });
    expect(metaResult([])).toEqual({ value: null, type: null });
    expect(
      metaResult([
        { indicator: "actions:lead", values: [{ value: "5" }] },
        { indicator: "actions:purchase", values: [{ value: "2" }] },
      ]),
    ).toEqual({ value: null, type: "mixed" });
    expect(resultTypeLabel("offsite_conversion.fb_pixel_purchase")).toBe(
      "Compras",
    );
    expect(
      resultTypeLabel("onsite_conversion.messaging_conversation_started_7d"),
    ).toBe("Conversaciones");
    expect(resultTypeLabel("mixed")).toBe("Varios tipos");
    expect(resultTypeLabel("algo_nuevo")).toBe("Otro resultado");
    expect(resultTypeLabel(null)).toBe("");
  });

  it("normaliza una fila de insights por nivel", () => {
    const raw = {
      campaign_id: "c1",
      campaign_name: "CBO Colágeno",
      adset_id: "s1",
      adset_name: "Mujeres 25-45",
      ad_id: "a1",
      ad_name: "Video 3",
      spend: "20.50",
      impressions: "1000",
      clicks: "40",
      actions: [
        { action_type: "omni_purchase", value: "3" },
        { action_type: "lead", value: "2" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "90" }],
      results: [
        { indicator: "actions:omni_purchase", values: [{ value: "3" }] },
      ],
      cost_per_result: [
        { indicator: "actions:omni_purchase", values: [{ value: "6.83" }] },
      ],
    };
    expect(metaInsight(raw, "ad")).toEqual({
      id: "a1",
      name: "Video 3",
      campaignId: "c1",
      campaignName: "CBO Colágeno",
      adsetId: "s1",
      adsetName: "Mujeres 25-45",
      spend: 20.5,
      impressions: 1000,
      clicks: 40,
      purchases: 3,
      purchaseValue: 90,
      leads: 2,
      results: 3,
      resultType: "omni_purchase",
      costPerResult: 6.83,
    });
    expect(metaInsight(raw, "adset")).toMatchObject({
      id: "s1",
      name: "Mujeres 25-45",
    });
    expect(metaInsight(raw, "campaign")).toMatchObject({
      id: "c1",
      name: "CBO Colágeno",
      adsetId: "",
    });
    // Sin el id del nivel la fila no existe; sin métricas son ceros.
    expect(metaInsight({ campaign_id: "c1" }, "ad")).toBeNull();
    expect(metaInsight({ campaign_id: "c9" }, "campaign")).toMatchObject({
      spend: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      leads: 0,
      results: null,
      costPerResult: null,
    });
  });

  it("suma la misma entidad repetida y deja el costo por resultado para recalcular", () => {
    const merged = mergeInsights([
      insight({
        spend: 10,
        impressions: 100,
        clicks: 5,
        purchases: 1,
        results: 1,
        resultType: "purchase",
        costPerResult: 10,
      }),
      insight({
        spend: 30,
        impressions: 300,
        clicks: 5,
        purchases: 3,
        results: 3,
        resultType: "purchase",
        costPerResult: 10,
      }),
      insight({ id: "c2", campaignId: "c2", spend: 1 }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      spend: 40,
      impressions: 400,
      clicks: 10,
      purchases: 4,
      results: 4,
      costPerResult: null,
    });
  });
});

describe("estado y presupuesto", () => {
  it("traduce el estado de Meta a una etiqueta corta en español", () => {
    expect(publicidadStatus("ACTIVE")).toEqual({
      status: "active",
      statusLabel: "Activo",
    });
    for (const paused of ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"])
      expect(publicidadStatus(paused)).toEqual({
        status: "paused",
        statusLabel: "Pausado",
      });
    expect(publicidadStatus("PENDING_REVIEW")).toEqual({
      status: "other",
      statusLabel: "En revisión",
    });
    expect(publicidadStatus("WITH_ISSUES")).toEqual({
      status: "other",
      statusLabel: "Con problemas",
    });
    expect(publicidadStatus("ARCHIVED")).toEqual({
      status: "other",
      statusLabel: "Archivado",
    });
    expect(publicidadStatus("DISAPPROVED").statusLabel).toBe("Rechazado");
    expect(publicidadStatus("ALGO_NUEVO")).toEqual({
      status: "other",
      statusLabel: "Otro estado",
    });
    expect(publicidadStatus("")).toEqual({
      status: "unknown",
      statusLabel: "—",
    });
    expect(publicidadStatus(undefined)).toEqual({
      status: "unknown",
      statusLabel: "—",
    });
  });

  it("convierte el presupuesto de unidades menores solo en USD y CRC", () => {
    expect(metaBudgetAmount("6400", "USD")).toBe(64);
    expect(metaBudgetAmount(2500000, "CRC")).toBe(25000);
    expect(metaBudgetAmount("0", "USD")).toBeNull();
    expect(metaBudgetAmount(undefined, "USD")).toBeNull();
    expect(metaBudgetAmount("64.5", "USD")).toBeNull();
    // Otra moneda: no se adivina el factor.
    expect(metaBudgetAmount("6400", "JPY")).toBeNull();
    expect(
      metaEntity(
        {
          id: "s1",
          name: "Conjunto",
          campaign_id: "c1",
          effective_status: "PAUSED",
          daily_budget: "1500",
          lifetime_budget: "0",
        },
        "USD",
      ),
    ).toEqual({
      id: "s1",
      name: "Conjunto",
      campaignId: "c1",
      adsetId: "",
      effectiveStatus: "PAUSED",
      dailyBudget: 15,
      lifetimeBudget: null,
    });
    expect(metaEntity({ name: "sin id" }, "USD")).toBeNull();
  });

  it("elige el presupuesto propio diario, el propio total o el de la campaña (CBO)", () => {
    expect(
      pickBudget(entity({ dailyBudget: 64, lifetimeBudget: 900 })),
    ).toEqual({
      amount: 64,
      kind: "daily",
      scope: "own",
    });
    expect(pickBudget(entity({ lifetimeBudget: 900 }))).toEqual({
      amount: 900,
      kind: "lifetime",
      scope: "own",
    });
    expect(pickBudget(entity({}), entity({ dailyBudget: 120 }))).toEqual({
      amount: 120,
      kind: "daily",
      scope: "campaign",
    });
    expect(pickBudget(entity({}), entity({ lifetimeBudget: 3000 }))).toEqual({
      amount: 3000,
      kind: "lifetime",
      scope: "campaign",
    });
    // El propio gana al de la campaña.
    expect(
      pickBudget(entity({ dailyBudget: 20 }), entity({ dailyBudget: 120 }))
        ?.scope,
    ).toBe("own");
    expect(pickBudget(entity({}), entity({}))).toBeNull();
    expect(pickBudget(null, null)).toBeNull();
  });
});

describe("filas de la tabla", () => {
  it("con la lectura completa, lo que gastó y Meta ya no lista sale Eliminado (no sin estado)", () => {
    // El equipo recrea campañas con el mismo nombre: la vieja no es la activa.
    const input = {
      level: "campaign" as const,
      account,
      insights: [
        insight({ id: "vieja", campaignId: "vieja", name: "WSP BATANA OIL | CR", spend: 6.08 }),
        insight({ id: "nueva", campaignId: "nueva", name: "WSP BATANA OIL | CR", spend: 4.08 }),
      ],
      entities: [entity({ id: "nueva", effectiveStatus: "ACTIVE", dailyBudget: 5 })],
    };
    const completa = buildPublicidadRows({ ...input, entitiesComplete: true });
    expect(completa.find((r) => r.id === "vieja")).toMatchObject({ status: "deleted", statusLabel: "Eliminado", budget: null });
    expect(completa.find((r) => r.id === "nueva")).toMatchObject({ status: "active", statusLabel: "Activo" });
    // Lectura parcial: no se afirma que se eliminó.
    const parcial = buildPublicidadRows({ ...input, entitiesComplete: false });
    expect(parcial.find((r) => r.id === "vieja")).toMatchObject({ status: "unknown", statusLabel: "—" });
    // Sin lectura de estado: todo desconocido.
    const sin = buildPublicidadRows({ ...input, entities: null, entitiesComplete: true });
    expect(sin.every((r) => r.status === "unknown")).toBe(true);
  });

  it("lista lo que tuvo entrega y lo activo sin entrega; omite lo pausado sin gasto", () => {
    const rows = buildPublicidadRows({
      level: "campaign",
      account,
      insights: [
        insight({
          id: "c1",
          campaignId: "c1",
          name: "Con gasto pausada",
          spend: 30,
          impressions: 900,
        }),
        insight({
          id: "c2",
          campaignId: "c2",
          name: "Solo impresiones",
          impressions: 12,
        }),
        insight({ id: "c3", campaignId: "c3", name: "Fila en cero pausada" }),
      ],
      entities: [
        entity({
          id: "c1",
          name: "Con gasto pausada",
          effectiveStatus: "PAUSED",
          dailyBudget: 50,
        }),
        entity({
          id: "c2",
          name: "Solo impresiones",
          effectiveStatus: "ACTIVE",
        }),
        entity({
          id: "c3",
          name: "Fila en cero pausada",
          effectiveStatus: "PAUSED",
        }),
        entity({
          id: "c4",
          name: "Activa sin entrega",
          effectiveStatus: "ACTIVE",
          lifetimeBudget: 400,
        }),
        entity({
          id: "c5",
          name: "Pausada sin entrega",
          effectiveStatus: "PAUSED",
        }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["c1", "c2", "c4"]);
    expect(rows[0]).toMatchObject({
      status: "paused",
      statusLabel: "Pausado",
      budget: { amount: 50, kind: "daily", scope: "own" },
      spend: 30,
      accountId: "123",
      currency: "USD",
    });
    // Campaña leída y sin presupuesto propio: vive en los conjuntos.
    expect(rows[1]).toMatchObject({ budget: null, budgetInAdsets: true });
    expect(rows[2]).toMatchObject({
      status: "active",
      spend: 0,
      impressions: 0,
      budget: { amount: 400, kind: "lifetime", scope: "own" },
    });
  });

  it("deja las filas con estado y presupuesto desconocidos si no se pudieron leer las entidades", () => {
    const rows = buildPublicidadRows({
      level: "adset",
      account,
      insights: [
        insight({
          id: "s1",
          name: "Conjunto",
          campaignId: "c1",
          campaignName: "CBO",
          spend: 12,
          impressions: 100,
          results: 4,
          resultType: "lead",
        }),
      ],
      entities: null,
      campaigns: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "s1",
      campaignId: "c1",
      campaignName: "CBO",
      status: "unknown",
      statusLabel: "—",
      budget: null,
      results: 4,
      resultType: "lead",
      // Sin el costo de Meta se calcula: gasto / resultados.
      costPerResult: 3,
    });
    expect(rows[0].budgetInAdsets).toBeUndefined();
  });

  it("muestra el presupuesto de la campaña en los conjuntos de una campaña CBO", () => {
    const rows = buildPublicidadRows({
      level: "adset",
      account,
      insights: [
        insight({
          id: "s1",
          name: "CBO set",
          campaignId: "c1",
          spend: 5,
          impressions: 10,
        }),
        insight({
          id: "s2",
          name: "ABO set",
          campaignId: "c2",
          spend: 9,
          impressions: 10,
        }),
      ],
      entities: [
        entity({ id: "s1", campaignId: "c1" }),
        entity({ id: "s2", campaignId: "c2", dailyBudget: 15 }),
      ],
      campaigns: [
        entity({ id: "c1", name: "CBO Colágeno", dailyBudget: 64 }),
        entity({ id: "c2", name: "ABO WSP" }),
      ],
    });
    expect(rows.map((r) => [r.id, r.budget, r.campaignName])).toEqual([
      ["s2", { amount: 15, kind: "daily", scope: "own" }, "ABO WSP"],
      ["s1", { amount: 64, kind: "daily", scope: "campaign" }, "CBO Colágeno"],
    ]);
  });

  it("los anuncios no tienen presupuesto y guardan su campaña y conjunto", () => {
    const rows = buildPublicidadRows({
      level: "ad",
      account,
      insights: [
        insight({
          id: "a1",
          name: "Video",
          campaignId: "c1",
          campaignName: "CBO",
          adsetId: "s1",
          adsetName: "Set",
          spend: 4,
          impressions: 9,
        }),
      ],
      entities: [
        entity({ id: "a1", name: "Video", campaignId: "c1", adsetId: "s1" }),
        entity({
          id: "a2",
          name: "Activo nuevo",
          campaignId: "c1",
          adsetId: "s1",
        }),
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "a1",
      budget: null,
      campaignId: "c1",
      adsetId: "s1",
      adsetName: "Set",
    });
    expect(rows[1]).toMatchObject({
      id: "a2",
      spend: 0,
      status: "active",
      adsetId: "s1",
    });
  });

  it("filtra por cuenta, campaña, conjunto y búsqueda sin tildes", () => {
    const rows = [
      row({
        id: "a1",
        name: "Colágeno Video",
        accountId: "123",
        campaignId: "c1",
        adsetId: "s1",
      }),
      row({
        id: "a2",
        name: "Magnesio WSP",
        accountId: "123",
        campaignId: "c1",
        adsetId: "s2",
      }),
      row({
        id: "a3",
        name: "Colageno Imagen",
        accountId: "456",
        campaignId: "c9",
        adsetId: "s9",
      }),
    ];
    expect(filterPublicidadRows(rows, {}).length).toBe(3);
    expect(
      filterPublicidadRows(rows, { account: "456" }).map((r) => r.id),
    ).toEqual(["a3"]);
    expect(
      filterPublicidadRows(rows, { campaign: "c1" }).map((r) => r.id),
    ).toEqual(["a1", "a2"]);
    expect(
      filterPublicidadRows(rows, { adset: "s2" }).map((r) => r.id),
    ).toEqual(["a2"]);
    expect(
      filterPublicidadRows(rows, { search: " colageno " }).map((r) => r.id),
    ).toEqual(["a1", "a3"]);
    expect(
      filterPublicidadRows(rows, { account: "123", search: "wsp" }).map(
        (r) => r.id,
      ),
    ).toEqual(["a2"]);
    // En el nivel de campañas el filtro de campaña compara el propio id.
    expect(
      filterPublicidadRows([row({ id: "c1" }), row({ id: "c2" })], {
        campaign: "c2",
      }).map((r) => r.id),
    ).toEqual(["c2"]);
  });

  it("ordena por cualquier columna y deja lo que no tiene valor al final", () => {
    const rows = [
      row({
        id: "a",
        name: "Beta",
        spend: 10,
        purchases: 2,
        impressions: 100,
        clicks: 10,
      }),
      row({
        id: "b",
        name: "alfa",
        spend: 30,
        purchases: 0,
        impressions: 100,
        clicks: 1,
      }),
      row({
        id: "c",
        name: "Gamma",
        spend: 20,
        purchases: 5,
        impressions: 0,
        clicks: 0,
      }),
    ];
    expect(sortPublicidadRows(rows, "spend", "desc").map((r) => r.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortPublicidadRows(rows, "spend", "asc").map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortPublicidadRows(rows, "name", "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    // Costo por compra: b no tiene compras → al final en los dos sentidos.
    expect(
      sortPublicidadRows(rows, "costPerPurchase", "asc").map((r) => r.id),
    ).toEqual(["c", "a", "b"]);
    expect(
      sortPublicidadRows(rows, "costPerPurchase", "desc").map((r) => r.id),
    ).toEqual(["a", "c", "b"]);
    // CTR: c no tiene impresiones.
    expect(sortPublicidadRows(rows, "ctr", "desc").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("métricas derivadas, USD y totales", () => {
  it("calcula cada cociente con sus propias sumas y deja null cuando el denominador es 0", () => {
    expect(
      derivePublicidad({
        spend: 50,
        impressions: 2000,
        clicks: 40,
        purchases: 5,
        purchaseValue: 200,
        leads: 0,
        results: 10,
      }),
    ).toEqual({
      ctr: 0.02,
      cpc: 1.25,
      costPerPurchase: 10,
      roas: 4,
      costPerResult: 5,
    });
    expect(
      derivePublicidad({
        spend: 0,
        impressions: 0,
        clicks: 0,
        purchases: 0,
        purchaseValue: 0,
        leads: 0,
        results: null,
      }),
    ).toEqual({
      ctr: null,
      cpc: null,
      costPerPurchase: null,
      roas: null,
      costPerResult: null,
    });
    // Sin conversión a USD no hay costo ni ROAS, pero el CTR sí.
    expect(
      derivePublicidad({
        spend: null,
        impressions: 100,
        clicks: 5,
        purchases: 2,
        purchaseValue: null,
        leads: 0,
        results: 2,
      }),
    ).toEqual({
      ctr: 0.05,
      cpc: null,
      costPerPurchase: null,
      roas: null,
      costPerResult: null,
    });
  });

  it("convierte a USD con la referencia y marca pendiente lo que no tiene tasa (nunca inventa)", () => {
    const crc = row({
      currency: "CRC",
      spend: 5000,
      purchaseValue: 25000,
      purchases: 2,
      costPerResult: 2500,
      results: 2,
      budget: { amount: 10000, kind: "daily", scope: "own" },
    });
    const converted = publicidadRowUsd(crc, fx);
    expect(converted).toMatchObject({
      spend: 10,
      purchaseValue: 50,
      costPerResult: 5,
      budget: { amount: 20, kind: "daily", scope: "own" },
      budgetPending: false,
      pending: false,
    });
    expect(converted.derived).toMatchObject({ costPerPurchase: 5, roas: 5 });
    const pending = publicidadRowUsd(crc, null);
    expect(pending).toMatchObject({
      spend: null,
      purchaseValue: null,
      costPerResult: null,
      budget: null,
      budgetPending: true,
      pending: true,
    });
    expect(pending.derived.costPerPurchase).toBeNull();
    // Cero es cero en cualquier moneda: una fila activa sin entrega no queda pendiente.
    expect(publicidadRowUsd(row({ currency: "PEN" }), null)).toMatchObject({
      spend: 0,
      pending: false,
    });
    expect(publicidadRowUsd(row({ spend: 12.5 }), null)).toMatchObject({
      spend: 12.5,
      pending: false,
    });
  });

  it("recalcula CTR, CPC, costo por compra y ROAS desde las sumas (no promedia cocientes)", () => {
    const rows = [
      row({
        id: "a",
        spend: 10,
        impressions: 1000,
        clicks: 100,
        purchases: 1,
        purchaseValue: 100,
        leads: 3,
        results: 1,
        resultType: "purchase",
      }),
      row({
        id: "b",
        spend: 90,
        impressions: 1000,
        clicks: 20,
        purchases: 9,
        purchaseValue: 180,
        leads: 0,
        results: 9,
        resultType: "purchase",
      }),
    ].map((r) => publicidadRowUsd(r, fx));
    const totals = publicidadTotals(rows);
    expect(totals).toMatchObject({
      count: 2,
      spend: 100,
      impressions: 2000,
      clicks: 120,
      purchases: 10,
      purchaseValue: 280,
      leads: 3,
      results: 10,
      resultType: "purchase",
    });
    expect(totals.derived.ctr).toBeCloseTo(0.06);
    expect(totals.derived.cpc).toBeCloseTo(100 / 120);
    expect(totals.derived.costPerPurchase).toBe(10);
    // ROAS de las filas: 10 y 2; el total es 2,8 (no 6).
    expect(totals.derived.roas).toBeCloseTo(2.8);
    expect(totals.derived.costPerResult).toBe(10);
  });

  it("no suma resultados de distinto tipo ni dinero pendiente de conversión", () => {
    const mixed = publicidadTotals(
      [
        row({ id: "a", spend: 10, results: 4, resultType: "purchase" }),
        row({
          id: "b",
          spend: 10,
          results: 30,
          resultType: "onsite_conversion.messaging_conversation_started_7d",
        }),
      ].map((r) => publicidadRowUsd(r, fx)),
    );
    expect(mixed).toMatchObject({
      spend: 20,
      results: null,
      resultType: "mixed",
    });
    expect(mixed.derived.costPerResult).toBeNull();
    const pending = publicidadTotals(
      [
        row({
          id: "a",
          spend: 10,
          purchaseValue: 40,
          purchases: 1,
          impressions: 50,
          clicks: 5,
        }),
        row({
          id: "b",
          currency: "PEN",
          spend: 30,
          purchaseValue: 10,
          purchases: 1,
          impressions: 50,
          clicks: 5,
        }),
      ].map((r) => publicidadRowUsd(r, fx)),
    );
    expect(pending).toMatchObject({
      spend: null,
      purchaseValue: null,
      purchases: 2,
      impressions: 100,
    });
    expect(pending.derived).toMatchObject({
      ctr: 0.1,
      cpc: null,
      roas: null,
      costPerPurchase: null,
    });
    expect(publicidadTotals([])).toMatchObject({
      count: 0,
      spend: 0,
      impressions: 0,
      purchases: null,
      results: null,
    });
  });
});

describe("TikTok (lo que guarda Make)", () => {
  it("arma las campañas con gasto, impresiones, clics y conversiones; sin estado ni presupuesto", () => {
    const rows = tiktokCampaignRows([
      {
        accountId: "777",
        accountName: "Mireva TikTok",
        currency: "PEN",
        timezone: "America/Lima",
        campaigns: [
          {
            id: "t1",
            name: "TT Colágeno",
            spend: 120.456,
            impressions: 9000,
            clicks: 80,
            daily: [
              {
                date: "2026-11-20",
                spend: 60,
                impressions: 4000,
                clicks: 40,
                purchases: 2,
              },
              {
                date: "2026-11-21",
                spend: 60.456,
                impressions: 5000,
                clicks: 40,
                purchases: null,
              },
            ],
          },
          {
            id: "t2",
            name: "Sin conversiones",
            spend: 5,
            impressions: 10,
            clicks: 0,
            daily: [
              {
                date: "2026-11-20",
                spend: 5,
                impressions: 10,
                clicks: 0,
                purchases: null,
              },
            ],
          },
          {
            id: "t3",
            name: "Sin entrega",
            spend: 0,
            impressions: 0,
            clicks: 0,
          },
        ],
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(rows[0]).toMatchObject({
      accountId: "777",
      accountName: "Mireva TikTok",
      currency: "PEN",
      status: "unknown",
      budget: null,
      spend: 120.46,
      purchases: 2,
      purchaseValue: null,
      leads: null,
      results: null,
    });
    // Make no mandó conversiones: no es un cero.
    expect(rows[1].purchases).toBeNull();
  });

  it("agrupa el reporte por anuncio en grupos o anuncios y respeta el filtro", () => {
    const day = (
      spend: number,
      purchases: number,
      purchaseValue: number | null,
    ) => ({
      date: "2026-11-20",
      spend,
      impressions: 100,
      clicks: 4,
      frequency: null,
      purchases,
      purchaseValue,
      interactions: 0,
    });
    const ad = (
      id: string,
      adsetId: string,
      campaignId: string,
      daily: ReturnType<typeof day>[],
    ) => ({
      id,
      name: `Anuncio ${id}`,
      adsetId,
      campaignId,
      effectiveStatus: "SIN_DATO",
      postId: null,
      creativeId: null,
      assets: null,
      daily,
    });
    const accounts = [
      {
        platform: "tiktok" as const,
        id: "777",
        name: "TikTok · Mireva",
        currency: "PEN",
        timezone: "",
        adsets: [
          {
            id: "g1",
            name: "Grupo 1",
            campaignId: "t1",
            dynamic: false,
            effectiveStatus: "SIN_DATO",
          },
          {
            id: "g2",
            name: "Grupo 2",
            campaignId: "t2",
            dynamic: false,
            effectiveStatus: "SIN_DATO",
          },
        ],
        ads: [
          ad("x1", "g1", "t1", [day(10, 1, 30), day(5, 0, 0)]),
          ad("x2", "g1", "t1", [day(20, 2, null)]),
          ad("x3", "g2", "t2", [day(7, 0, 0)]),
        ],
      },
    ];
    const groups = tiktokAdRows(accounts, "adset");
    expect(
      groups.map((r) => [r.id, r.name, r.spend, r.purchases, r.purchaseValue]),
    ).toEqual([
      // Un valor que Make no mandó deja el total desconocido, no en 30.
      ["g1", "Grupo 1", 35, 3, null],
      ["g2", "Grupo 2", 7, 0, 0],
    ]);
    expect(groups[0]).toMatchObject({
      accountName: "Mireva",
      campaignId: "t1",
      impressions: 300,
    });
    const ads = tiktokAdRows(accounts, "ad", { campaign: "t1" });
    expect(ads.map((r) => r.id)).toEqual(["x2", "x1"]);
    expect(ads[1]).toMatchObject({
      adsetId: "g1",
      adsetName: "Grupo 1",
      purchaseValue: 30,
      spend: 15,
    });
    expect(
      tiktokAdRows(accounts, "ad", { adset: "g2" }).map((r) => r.id),
    ).toEqual(["x3"]);
  });
});

describe("columnas", () => {
  it("ofrece para TikTok solo las columnas que tienen datos", () => {
    expect(availablePublicidadColumns("meta", "campaign")).toEqual([
      "status",
      "purchases",
      "costPerPurchase",
      "purchaseValue",
      "roas",
      "leads",
      "budget",
      "spend",
      "results",
      "costPerResult",
      "impressions",
      "clicks",
      "ctr",
      "realOrders",
    ]);
    expect(availablePublicidadColumns("meta", "adset")).not.toContain(
      "realOrders",
    );
    expect(availablePublicidadColumns("tiktok", "campaign")).toEqual([
      "purchases",
      "costPerPurchase",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "realOrders",
    ]);
    expect(availablePublicidadColumns("tiktok", "ad")).toEqual([
      "purchases",
      "costPerPurchase",
      "purchaseValue",
      "roas",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "realOrders",
    ]);
  });

  it("suma los pedidos reales por UTM de Kairo por campaña o anuncio de la plataforma", () => {
    const days: Array<{
      byCampaign: Record<string, number>;
      byAd: Record<string, number>;
    }> = [
      { byCampaign: { "meta:c1": 2, "tiktok:c1": 9 }, byAd: { "meta:a1": 1 } },
      {
        byCampaign: { "meta:c1": 1, "meta:c2": 4 },
        byAd: { "meta:a1": 1, "meta:a2": 3 },
      },
    ];
    expect(
      Object.fromEntries(realOrdersByRow(days, "meta", "campaign")!),
    ).toEqual({ c1: 3, c2: 4 });
    expect(Object.fromEntries(realOrdersByRow(days, "meta", "ad")!)).toEqual({
      a1: 2,
      a2: 3,
    });
    expect(
      Object.fromEntries(realOrdersByRow(days, "tiktok", "campaign")!),
    ).toEqual({ c1: 9 });
    expect(realOrdersByRow(days, "meta", "adset")).toBeNull();
  });
});
