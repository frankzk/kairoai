// Marketing › Publicidad: lectura de Meta (lib/marketing-publicidad-server.ts)
// con un Graph simulado. Solo GET, nunca `?ids=`, el token nunca sale.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPublicidadCache,
  getPublicidadMeta,
} from "../lib/marketing-publicidad-server";

const TOKEN = "private-meta-token";
const env = {
  META_CR_AD_ACCOUNT_IDS: "123,456",
  META_CR_GRAPH_VERSION: "v24.0",
  META_CR_ACCESS_TOKEN: TOKEN,
};
const one = { ...env, META_CR_AD_ACCOUNT_IDS: "123" };
const range = { from: "2026-11-01", to: "2026-11-07" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

interface Call {
  account: string;
  /** "" = the account itself; else insights / campaigns / adsets / ads. */
  edge: string;
  params: URLSearchParams;
}
type Handler = (call: Call) => Response | undefined;

/** A Graph that checks every request is a safe read and answers through `handler`. */
function graph(handler: Handler) {
  const calls: Call[] = [];
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://graph.facebook.com");
      expect(String(input)).not.toContain(TOKEN);
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
      expect(init?.redirect).toBe("error");
      // Lección de producción: nunca la consulta multi-id; siempre por la cuenta.
      expect(url.searchParams.has("ids")).toBe(false);
      const match = /^\/v24\.0\/act_(\d+)(?:\/(\w+))?$/.exec(url.pathname);
      expect(match, url.pathname).not.toBeNull();
      const call = {
        account: match![1],
        edge: match![2] ?? "",
        params: url.searchParams,
      };
      calls.push(call);
      const answer = handler(call);
      if (answer) return answer;
      if (!call.edge)
        return json({
          id: `act_${call.account}`,
          name: `Cuenta ${call.account}`,
          currency: "USD",
        });
      return json({ data: [] });
    },
  );
  return {
    fetcher: fetcher as unknown as typeof fetch,
    calls,
    of: (edge: string) => calls.filter((call) => call.edge === edge),
  };
}
const filtering = (call: Call) =>
  JSON.parse(call.params.get("filtering") ?? "null") as Array<{
    field: string;
    operator: string;
    value: string[];
  }> | null;
const statuses = (call: Call) =>
  JSON.parse(call.params.get("effective_status") ?? "null") as string[] | null;

const campaignInsights = [
  {
    campaign_id: "c1",
    campaign_name: "CBO Colágeno",
    spend: "120.50",
    impressions: "10000",
    clicks: "250",
    actions: [
      { action_type: "omni_purchase", value: "12" },
      { action_type: "purchase", value: "12" },
      { action_type: "lead", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "3" },
    ],
    action_values: [{ action_type: "omni_purchase", value: "480" }],
    results: [
      {
        indicator: "actions:offsite_conversion.fb_pixel_purchase",
        values: [{ value: "12", attribution_windows: ["default"] }],
      },
    ],
    cost_per_result: [
      {
        indicator: "actions:offsite_conversion.fb_pixel_purchase",
        values: [{ value: "10.04", attribution_windows: ["default"] }],
      },
    ],
  },
  {
    campaign_id: "c2",
    campaign_name: "WSP Magnesio",
    spend: "40",
    impressions: "3000",
    clicks: "90",
  },
];

beforeEach(() => clearPublicidadCache());

describe("getPublicidadMeta", () => {
  it("no llama a Meta sin configuración", async () => {
    const { fetcher, calls } = graph(() => undefined);
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      {},
      fetcher,
    );
    expect(result).toMatchObject({
      status: "pending",
      rows: [],
      accounts: [],
      unavailable: [],
    });
    expect(calls).toHaveLength(0);
    expect(
      (
        await getPublicidadMeta(
          { level: "campaign", ...range },
          { ...env, META_CR_AD_ACCOUNT_IDS: "abc" },
          fetcher,
        )
      ).status,
    ).toBe("pending");
  });

  it("campañas: insights del período + estado y presupuesto por el borde de la cuenta", async () => {
    const { fetcher, of } = graph((call) => {
      if (call.edge === "insights") return json({ data: campaignInsights });
      if (call.edge === "campaigns")
        return statuses(call)?.length === 1
          ? json({
              data: [
                {
                  id: "c1",
                  name: "CBO Colágeno",
                  effective_status: "ACTIVE",
                  daily_budget: "6400",
                },
                {
                  id: "c3",
                  name: "Activa sin entrega",
                  effective_status: "ACTIVE",
                  lifetime_budget: "90000",
                },
              ],
            })
          : json({
              data: [
                {
                  id: "c1",
                  name: "CBO Colágeno",
                  effective_status: "ACTIVE",
                  daily_budget: "6400",
                },
                { id: "c2", name: "WSP Magnesio", effective_status: "PAUSED" },
              ],
            });
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(result).toMatchObject({
      platform: "meta",
      status: "ready",
      level: "campaign",
      from: "2026-11-01",
      to: "2026-11-07",
      unavailable: [],
      accounts: [
        {
          accountId: "123",
          accountName: "Cuenta 123",
          currency: "USD",
          entities: "ok",
          results: "ok",
        },
      ],
    });
    expect(result.rows).toEqual([
      {
        id: "c1",
        name: "CBO Colágeno",
        accountId: "123",
        accountName: "Cuenta 123",
        currency: "USD",
        status: "active",
        statusLabel: "Activo",
        budget: { amount: 64, kind: "daily", scope: "own" },
        spend: 120.5,
        impressions: 10000,
        clicks: 250,
        purchases: 12,
        purchaseValue: 480,
        leads: 3,
        results: 12,
        resultType: "offsite_conversion.fb_pixel_purchase",
        costPerResult: 10.04,
      },
      expect.objectContaining({
        id: "c2",
        status: "paused",
        statusLabel: "Pausado",
        budget: null,
        budgetInAdsets: true,
        spend: 40,
        purchases: 0,
        leads: 0,
        results: null,
        costPerResult: null,
      }),
      expect.objectContaining({
        id: "c3",
        name: "Activa sin entrega",
        status: "active",
        spend: 0,
        impressions: 0,
        budget: { amount: 900, kind: "lifetime", scope: "own" },
      }),
    ]);
    const [insights] = of("insights");
    expect(insights.params.get("level")).toBe("campaign");
    expect(insights.params.get("fields")).toBe(
      "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,results,cost_per_result",
    );
    expect(JSON.parse(insights.params.get("time_range")!)).toEqual({
      since: "2026-11-01",
      until: "2026-11-07",
    });
    expect(insights.params.has("time_increment")).toBe(false);
    expect(insights.params.get("action_attribution_windows")).toBe(
      '["7d_click","1d_view"]',
    );
    expect(insights.params.get("limit")).toBe("500");
    expect(insights.params.has("filtering")).toBe(false);
    const edges = of("campaigns");
    expect(edges).toHaveLength(2);
    for (const call of edges)
      expect(call.params.get("fields")).toBe(
        "id,name,effective_status,daily_budget,lifetime_budget",
      );
    const byCampaign = edges.find((call) => call.params.has("filtering"))!;
    expect(filtering(byCampaign)).toEqual([
      { field: "campaign.id", operator: "IN", value: ["c1", "c2"] },
    ]);
    expect(statuses(byCampaign)).toContain("ARCHIVED");
    const active = edges.find((call) => !call.params.has("filtering"))!;
    expect(statuses(active)).toEqual(["ACTIVE"]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("conjuntos: lee /adsets y los presupuestos de campaña para las CBO", async () => {
    const { fetcher, of } = graph((call) => {
      if (call.edge === "insights")
        return json({
          data: [
            {
              campaign_id: "c1",
              campaign_name: "CBO Colágeno",
              adset_id: "s1",
              adset_name: "Mujeres 25-45",
              spend: "70",
              impressions: "5000",
              clicks: "100",
            },
            {
              campaign_id: "c2",
              campaign_name: "ABO Magnesio",
              adset_id: "s2",
              adset_name: "Abierto",
              spend: "30",
              impressions: "2000",
              clicks: "50",
            },
          ],
        });
      if (call.edge === "adsets")
        return json({
          data: [
            {
              id: "s1",
              name: "Mujeres 25-45",
              campaign_id: "c1",
              effective_status: "ACTIVE",
            },
            {
              id: "s2",
              name: "Abierto",
              campaign_id: "c2",
              effective_status: "CAMPAIGN_PAUSED",
              daily_budget: "1500",
            },
          ],
        });
      if (call.edge === "campaigns")
        return json({
          data: [
            {
              id: "c1",
              name: "CBO Colágeno",
              effective_status: "ACTIVE",
              daily_budget: "6400",
            },
            { id: "c2", name: "ABO Magnesio", effective_status: "PAUSED" },
          ],
        });
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "adset", ...range },
      one,
      fetcher,
    );
    expect(
      result.rows.map((row) => [
        row.id,
        row.campaignId,
        row.campaignName,
        row.statusLabel,
        row.budget,
      ]),
    ).toEqual([
      [
        "s1",
        "c1",
        "CBO Colágeno",
        "Activo",
        { amount: 64, kind: "daily", scope: "campaign" },
      ],
      [
        "s2",
        "c2",
        "ABO Magnesio",
        "Pausado",
        { amount: 15, kind: "daily", scope: "own" },
      ],
    ]);
    expect(of("insights")[0].params.get("level")).toBe("adset");
    expect(of("insights")[0].params.get("fields")).toContain(
      "adset_id,adset_name",
    );
    expect(of("adsets")[0].params.get("fields")).toBe(
      "id,name,campaign_id,effective_status,daily_budget,lifetime_budget",
    );
    expect(
      of("adsets").some((call) => filtering(call)?.[0].field === "campaign.id"),
    ).toBe(true);
    expect(of("campaigns").length).toBeGreaterThan(0);
    expect(of("ads")).toHaveLength(0);
  });

  it("anuncios con desglose: una sola cuenta y filtro por conjunto en insights y en /ads", async () => {
    const { fetcher, calls, of } = graph((call) => {
      if (call.edge === "insights")
        return json({
          data: [
            {
              campaign_id: "c1",
              campaign_name: "CBO",
              adset_id: "s1",
              adset_name: "Set",
              ad_id: "a1",
              ad_name: "Video 3",
              spend: "9",
              impressions: "800",
              clicks: "20",
              actions: [{ action_type: "omni_purchase", value: "1" }],
            },
          ],
        });
      if (call.edge === "ads")
        return json({
          data: [
            {
              id: "a1",
              name: "Video 3",
              adset_id: "s1",
              campaign_id: "c1",
              effective_status: "ACTIVE",
            },
            {
              id: "a2",
              name: "Imagen pausada",
              adset_id: "s1",
              campaign_id: "c1",
              effective_status: "PAUSED",
            },
            {
              id: "a3",
              name: "Activo nuevo",
              adset_id: "s1",
              campaign_id: "c1",
              effective_status: "ACTIVE",
            },
          ],
        });
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "ad", ...range, account: "456", campaign: "c1", adset: "s1" },
      env,
      fetcher,
    );
    expect(new Set(calls.map((call) => call.account))).toEqual(
      new Set(["456"]),
    );
    expect(result.accounts.map((a) => a.accountId)).toEqual(["456"]);
    // El anuncio pausado sin entrega no aparece; el activo sin entrega sí.
    expect(
      result.rows.map((row) => [
        row.id,
        row.statusLabel,
        row.adsetId,
        row.budget,
      ]),
    ).toEqual([
      ["a1", "Activo", "s1", null],
      ["a3", "Activo", "s1", null],
    ]);
    expect(result.rows[0]).toMatchObject({
      campaignId: "c1",
      adsetName: "Set",
      purchases: 1,
    });
    expect(filtering(of("insights")[0])).toEqual([
      { field: "adset.id", operator: "IN", value: ["s1"] },
    ]);
    expect(of("ads")).toHaveLength(1);
    expect(filtering(of("ads")[0])).toEqual([
      { field: "adset.id", operator: "IN", value: ["s1"] },
    ]);
    expect(of("ads")[0].params.get("fields")).toBe(
      "id,name,adset_id,campaign_id,effective_status",
    );
    expect(of("campaigns")).toHaveLength(0);
    expect(of("adsets")).toHaveLength(0);
  });

  it("conjuntos de una campaña: filtra por campaña y no pide los activos de toda la cuenta", async () => {
    const { fetcher, of } = graph((call) =>
      call.edge === "insights"
        ? json({
            data: [
              {
                campaign_id: "c1",
                adset_id: "s1",
                adset_name: "Set",
                spend: "1",
                impressions: "10",
              },
            ],
          })
        : undefined,
    );
    await getPublicidadMeta(
      { level: "adset", ...range, account: "123", campaign: "c1" },
      env,
      fetcher,
    );
    expect(filtering(of("insights")[0])).toEqual([
      { field: "campaign.id", operator: "IN", value: ["c1"] },
    ]);
    expect(of("adsets")).toHaveLength(1);
    expect(filtering(of("adsets")[0])).toEqual([
      { field: "campaign.id", operator: "IN", value: ["c1"] },
    ]);
    expect(of("campaigns")).toHaveLength(1);
  });

  it("si Meta rechaza results / cost_per_result repite una vez sin ellos", async () => {
    const { fetcher, of } = graph((call) => {
      if (call.edge !== "insights") return undefined;
      return call.params.get("fields")!.includes("results")
        ? json({ error: { message: `(#100) results no existe ${TOKEN}` } }, 400)
        : json({
            data: campaignInsights.map(
              ({ results, cost_per_result, ...row }) => row,
            ),
          });
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(of("insights")).toHaveLength(2);
    expect(of("insights")[1].params.get("fields")).toBe(
      "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
    );
    expect(result.accounts[0].results).toBe("unavailable");
    expect(result.unavailable).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      id: "c1",
      spend: 120.5,
      purchases: 12,
      results: null,
      costPerResult: null,
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("#100");
  });

  it("si la lectura de entidades falla, las filas salen igual con estado y presupuesto desconocidos", async () => {
    const { fetcher, calls } = graph((call) => {
      if (call.edge === "insights") return json({ data: campaignInsights });
      if (call.edge === "campaigns")
        return json({ error: { message: "denegado" } }, 403);
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(result.unavailable).toEqual([]);
    expect(result.accounts[0].entities).toBe("unavailable");
    expect(
      result.rows.map((row) => [
        row.id,
        row.status,
        row.statusLabel,
        row.budget,
        row.spend,
      ]),
    ).toEqual([
      ["c1", "unknown", "—", null, 120.5],
      ["c2", "unknown", "—", null, 40],
    ]);
    expect(result.rows[0].budgetInAdsets).toBeUndefined();
    // Una lectura incompleta no se guarda: la siguiente consulta vuelve a Meta.
    const before = calls.length;
    await getPublicidadMeta({ level: "campaign", ...range }, one, fetcher);
    expect(calls.length).toBeGreaterThan(before);
  });

  it("en /campaigns reintenta el filtro con el campo `id` y sin lista de estados", async () => {
    const { fetcher, of } = graph((call) => {
      if (call.edge === "insights") return json({ data: campaignInsights });
      if (call.edge !== "campaigns") return undefined;
      const filter = filtering(call);
      if (filter?.[0].field === "campaign.id") return json({ error: {} }, 400);
      // Esta versión tampoco acepta la lista completa de estados.
      if ((statuses(call)?.length ?? 0) > 1) return json({ error: {} }, 400);
      return json({
        data: filter
          ? [
              {
                id: "c1",
                name: "CBO Colágeno",
                effective_status: "ACTIVE",
                daily_budget: "6400",
              },
              { id: "c2", name: "WSP Magnesio", effective_status: "PAUSED" },
            ]
          : [],
      });
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(result.accounts[0].entities).toBe("ok");
    expect(result.rows.map((row) => row.statusLabel)).toEqual([
      "Activo",
      "Pausado",
    ]);
    const last = of("campaigns")
      .filter((call) => call.params.has("filtering"))
      .pop()!;
    expect(filtering(last)).toEqual([
      { field: "id", operator: "IN", value: ["c1", "c2"] },
    ]);
    expect(last.params.has("effective_status")).toBe(false);
  });

  it("marca parcial la cuenta cuando solo falla la lectura de activos", async () => {
    const { fetcher } = graph((call) => {
      if (call.edge === "insights") return json({ data: campaignInsights });
      if (call.edge === "campaigns")
        return call.params.has("filtering")
          ? json({
              data: [{ id: "c1", name: "CBO", effective_status: "ACTIVE" }],
            })
          : json({ error: {} }, 500);
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(result.accounts[0].entities).toBe("partial");
    expect(result.rows.map((row) => [row.id, row.status])).toEqual([
      ["c1", "active"],
      ["c2", "unknown"],
    ]);
  });

  it("una cuenta que falla no esconde a las demás y no filtra el mensaje del proveedor", async () => {
    const { fetcher } = graph((call) => {
      if (call.account === "456")
        return json(
          {
            error: {
              message: `Invalid OAuth access token ${TOKEN} for act_456 Mireva`,
            },
          },
          403,
        );
      if (call.edge === "insights") return json({ data: campaignInsights });
      return undefined;
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      env,
      fetcher,
    );
    expect(result.status).toBe("ready");
    expect(result.accounts.map((a) => a.accountId)).toEqual(["123"]);
    expect(result.rows.map((row) => row.accountId)).toEqual(["123", "123"]);
    expect(result.unavailable).toEqual([
      { accountId: "456", reason: expect.any(String) },
    ]);
    const text = JSON.stringify(result);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("OAuth");
    expect(text).not.toContain("Mireva");
  });

  it("si ninguna cuenta responde devuelve la lista de fallos, sin filas y sin lanzar", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error(TOKEN)) as unknown as typeof fetch;
    const result = await getPublicidadMeta(
      { level: "ad", ...range },
      env,
      fetcher,
    );
    expect(result).toMatchObject({ status: "ready", rows: [], accounts: [] });
    expect(result.unavailable.map((u) => u.accountId)).toEqual(["123", "456"]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("no acepta una métrica malformada como cero: la cuenta queda como no disponible", async () => {
    const { fetcher } = graph((call) =>
      call.edge === "insights"
        ? json({ data: [{ campaign_id: "c1", spend: "NaN" }] })
        : undefined,
    );
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(result.rows).toEqual([]);
    expect(result.unavailable).toHaveLength(1);
  });

  it("guarda 60 s por cuenta, nivel, rango y filtros; refresh la salta", async () => {
    const { fetcher, calls } = graph((call) => {
      if (call.edge === "insights") return json({ data: campaignInsights });
      if (call.edge === "campaigns")
        return json({
          data: [{ id: "c1", name: "CBO", effective_status: "ACTIVE" }],
        });
      return undefined;
    });
    let clock = 1_000_000;
    const now = () => clock;
    const first = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
      now,
    );
    const used = calls.length;
    expect(used).toBeGreaterThan(0);
    const again = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
      now,
    );
    expect(calls.length).toBe(used);
    expect(again.rows).toEqual(first.rows);
    // Otro nivel, otro rango u otro filtro no reutilizan la respuesta.
    await getPublicidadMeta({ level: "adset", ...range }, one, fetcher, now);
    const afterLevel = calls.length;
    expect(afterLevel).toBeGreaterThan(used);
    await getPublicidadMeta(
      { level: "campaign", from: "2026-11-02", to: "2026-11-07" },
      one,
      fetcher,
      now,
    );
    const afterRange = calls.length;
    expect(afterRange).toBeGreaterThan(afterLevel);
    await getPublicidadMeta(
      { level: "campaign", ...range, refresh: true },
      one,
      fetcher,
      now,
    );
    const afterRefresh = calls.length;
    expect(afterRefresh).toBeGreaterThan(afterRange);
    clock += 30_000;
    await getPublicidadMeta({ level: "campaign", ...range }, one, fetcher, now);
    expect(calls.length).toBe(afterRefresh);
    clock += 31_000;
    await getPublicidadMeta({ level: "campaign", ...range }, one, fetcher, now);
    expect(calls.length).toBeGreaterThan(afterRefresh);
  });

  it("pagina con el cursor y nunca sigue la URL `next` del proveedor", async () => {
    const { fetcher, of } = graph((call) => {
      if (call.edge !== "insights") return undefined;
      return call.params.get("after") === "cursor-2"
        ? json({ data: [campaignInsights[1]] })
        : json({
            data: [campaignInsights[0]],
            paging: {
              next: "https://untrusted.invalid/?access_token=x",
              cursors: { after: "cursor-2" },
            },
          });
    });
    const result = await getPublicidadMeta(
      { level: "campaign", ...range },
      one,
      fetcher,
    );
    expect(of("insights")).toHaveLength(2);
    expect(result.rows.map((row) => row.id)).toEqual(["c1", "c2"]);
  });
});
