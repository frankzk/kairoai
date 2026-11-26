// Marketing para Mireva Honduras (26/11/2026): cada tienda lee solo su propia
// configuración de Meta, Honduras sin variables queda "pendiente de
// configurar", el acceso exige la tienda, HNL sin tasa no se convierte a USD y
// las cachés nunca mezclan Costa Rica con Honduras.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  metaConfigAccountIds,
  metaConfigFor,
  metaPendingMessage,
} from "../lib/marketing-meta-config";
import {
  clearDestinationCache,
  getMarketingSources,
  metaAccountIds,
} from "../lib/marketing-sources";
import {
  clearPublicidadCache,
  getPublicidadMeta,
} from "../lib/marketing-publicidad-server";
import { readMetaAccountStatuses } from "../lib/marketing-meta-accounts";
import { getCharlieReport } from "../lib/marketing-charlie-source";
import { marketingAllowed, marketingAccountIds } from "../lib/marketing-access";
import { asUsd } from "../lib/marketing-usd-rate";
import { storeUsdRate } from "../lib/marketing-charlie-settings";
import {
  appliedRateText,
  storeRates,
  storeRatesShortText,
  appliedRates,
  appliedRatesShortText,
} from "../lib/marketing-account-status";
import {
  isMarketingStore,
  marketingClockZones,
  marketingHourLabel,
  marketingStoreInfo,
} from "../lib/marketing-stores";
import { buildCharlieRevenue } from "../lib/marketing-charlie-revenue";
import { buildMarketingSummary } from "../lib/marketing";
import { marketingPeriod, periodQuery } from "../lib/marketing-dates";
import type { UsdRate } from "../lib/marketing-charlie-types";

const CR_TOKEN = "private-cr-token";
const HN_TOKEN = "private-hn-token";
const crEnv = {
  META_CR_ACCESS_TOKEN: CR_TOKEN,
  META_CR_AD_ACCOUNT_IDS: "111,222",
  META_CR_GRAPH_VERSION: "v24.0",
  META_CR_APP_ID: "42",
};
const hnEnv = {
  META_HN_ACCESS_TOKEN: HN_TOKEN,
  META_HN_AD_ACCOUNT_IDS: "998569598625763,1482039352526278,1251858422554180",
  META_HN_GRAPH_VERSION: "v24.0",
};
const bothEnv = { ...crEnv, ...hnEnv };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** A Graph that records the token of each call and checks it never goes in the URL. */
function graph(
  answer: (url: URL, token: string) => Response | undefined = () => undefined,
  timezone = "America/Tegucigalpa",
) {
  const calls: Array<{ url: URL; token: string }> = [];
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const text = String(input);
    expect(text).not.toContain(CR_TOKEN);
    expect(text).not.toContain(HN_TOKEN);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
    const token = auth.replace(/^Bearer /, "");
    calls.push({ url, token });
    const own = answer(url, token);
    if (own) return own;
    const account = /\/act_(\d+)$/.exec(url.pathname)?.[1];
    if (account)
      return json({
        id: `act_${account}`,
        name: `Cuenta ${account}`,
        currency: "USD",
        timezone_name: timezone,
        account_status: 1,
      });
    return json({ data: [], paging: {} });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("metaConfigFor", () => {
  it("resolves each store's own variables; Costa Rica keeps META_CR_AD_ACCOUNT_ID", () => {
    const cr = metaConfigFor("mireva-cr", crEnv);
    expect(cr).toMatchObject({
      store: "mireva-cr",
      prefix: "META_CR",
      configured: true,
      missing: [],
      version: "v24.0",
      appId: "42",
    });
    expect(metaConfigAccountIds(cr)).toEqual(["111", "222"]);
    const single = metaConfigFor("mireva-cr", {
      ...crEnv,
      META_CR_AD_ACCOUNT_IDS: undefined,
      META_CR_AD_ACCOUNT_ID: "act_333",
    });
    expect(metaConfigAccountIds(single)).toEqual(["333"]);
    const hn = metaConfigFor("mireva-hn", bothEnv);
    expect(hn).toMatchObject({ store: "mireva-hn", prefix: "META_HN", configured: true });
    expect(hn.token).toBe(HN_TOKEN);
    expect(metaConfigAccountIds(hn)).toEqual([
      "998569598625763",
      "1482039352526278",
      "1251858422554180",
    ]);
    expect(metaAccountIds(bothEnv, "mireva-hn")).toHaveLength(3);
    // Default (old callers): Costa Rica.
    expect(metaAccountIds(bothEnv)).toEqual(["111", "222"]);
  });

  it("never lends Costa Rica's variables to Honduras: without META_HN_* it is pending", () => {
    const hn = metaConfigFor("mireva-hn", crEnv);
    expect(hn.configured).toBe(false);
    expect(hn.token).toBe("");
    expect(hn.missing).toEqual([
      "META_HN_GRAPH_VERSION",
      "META_HN_ACCESS_TOKEN",
      "META_HN_AD_ACCOUNT_IDS",
    ]);
    const message = metaPendingMessage(hn);
    expect(message).toContain("Honduras: pendiente de configurar");
    expect(message).toContain("META_HN_ACCESS_TOKEN");
    expect(message).not.toContain(CR_TOKEN);
    expect(
      metaConfigFor("mireva-hn", { ...hnEnv, META_HN_ACCESS_TOKEN: " " }).missing,
    ).toEqual(["META_HN_ACCESS_TOKEN"]);
  });
});

describe("Honduras sources", () => {
  beforeEach(() => clearDestinationCache());
  const period = { from: "2026-11-01", to: "2026-11-07" };

  it("reads only the Honduras accounts with the Honduras token (in the header)", async () => {
    const { fetcher, calls } = graph();
    const result = await getMarketingSources(period, bothEnv, fetcher, { store: "mireva-hn" });
    expect(result.meta.status).toBe("ready");
    expect(result.meta.data?.accounts.map((a) => a.accountId)).toEqual(
      metaConfigAccountIds(metaConfigFor("mireva-hn", bothEnv)),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.token === HN_TOKEN)).toBe(true);
    expect(calls.some((call) => /act_(111|222)/.test(call.url.pathname))).toBe(false);
  });

  it("is 'pendiente de configurar' without META_HN_*, and TikTok/ShipHero are not connected", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await getMarketingSources(
      period,
      {
        ...crEnv,
        TIKTOK_CR_ADVERTISER_ID: "777",
        TIKTOK_CR_ACCESS_TOKEN: "tiktok-cr",
        SHIPHERO_CR_ACCESS_TOKEN: "ship-cr",
        SHIPHERO_CR_ACCOUNT_ID: "1",
        SHIPHERO_CR_WAREHOUSE_ID: "2",
      },
      fetcher,
      { store: "mireva-hn", tiktokDesdeMake: vi.fn() },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.meta).toMatchObject({ status: "pending", data: null });
    expect(result.meta.message).toContain("pendiente de configurar");
    // No TikTok in Honduras: nothing to wait for (Meta alone is the total).
    expect(result.tiktok).toMatchObject({
      status: "ready",
      notConnected: true,
      message: "TikTok Ads no está conectado para Honduras.",
      data: { accounts: [] },
    });
    expect(result.shiphero.status).toBe("pending");
  });

  it("says, account by account, which Honduras accounts Meta could read", async () => {
    const { fetcher } = graph((url) =>
      url.pathname.endsWith("/act_1482039352526278")
        ? json({ error: { code: 200 } }, 403)
        : undefined,
    );
    const partial = await getMarketingSources(period, hnEnv, fetcher, { store: "mireva-hn" });
    expect(partial.meta.status).toBe("ready");
    expect(partial.meta.data?.accounts).toHaveLength(2);
    expect(partial.meta.data?.unavailable).toEqual([
      {
        accountId: "1482039352526278",
        reason: "Meta no permite leer la cuenta (desactivada, restringida o sin acceso del token).",
      },
    ]);
    // A token that reads none: still one reason per account.
    const none = graph(() => json({ error: { code: 190 } }, 401));
    const failed = await getMarketingSources(period, hnEnv, none.fetcher, { store: "mireva-hn" });
    expect(failed.meta.status).toBe("error");
    expect(failed.meta.unavailable?.map((u) => u.accountId)).toHaveLength(3);
    expect(failed.meta.unavailable?.[0].reason).toBe("El token de Meta venció o no es válido.");
    expect(JSON.stringify(failed)).not.toContain(HN_TOKEN);
  });

  it("allows hourly spend for accounts on Honduras' clock", async () => {
    const { fetcher } = graph((url) =>
      url.searchParams.get("breakdowns") === "hourly_stats_aggregated_by_advertiser_time_zone"
        ? json({ data: [] })
        : undefined,
    );
    const now = new Date("2026-11-07T18:00:00Z");
    const result = await getMarketingSources(period, hnEnv, fetcher, {
      store: "mireva-hn",
      daily: true,
      hourly: true,
      now,
    });
    const account = result.meta.data!.accounts[0];
    expect(account.hourlyMessage).toBeUndefined();
    expect(account.hourly).toBeDefined();
    expect(marketingClockZones("mireva-cr")).toEqual(new Set(["America/Costa_Rica"]));
    expect(marketingClockZones("mireva-hn").has("America/Tegucigalpa")).toBe(true);
  });

  it("keeps the ad set destination cache per store", async () => {
    const answer = (url: URL) => {
      if (url.pathname.endsWith("/insights") && url.searchParams.get("level") === "adset")
        return json({
          data: [{ adset_id: "900", campaign_id: "800", spend: "10", optimization_goal: "OFFSITE_CONVERSIONS" }],
        });
      if (url.pathname.endsWith("/adsets"))
        return json({ data: [{ id: "900", destination_type: "WEBSITE" }] });
      return undefined;
    };
    const cr = graph(answer, "America/Costa_Rica");
    const one = { ...crEnv, META_CR_AD_ACCOUNT_IDS: "111" };
    await getMarketingSources(period, one, cr.fetcher, { channels: true, daily: true });
    expect(cr.calls.filter((c) => c.url.pathname.endsWith("/adsets"))).toHaveLength(1);
    // Same ad set id in Honduras: asked again, with the Honduras token.
    const hn = graph(answer);
    await getMarketingSources(
      period,
      { ...hnEnv, META_HN_AD_ACCOUNT_IDS: "998569598625763" },
      hn.fetcher,
      { store: "mireva-hn", channels: true, daily: true },
    );
    const adsets = hn.calls.filter((c) => c.url.pathname.endsWith("/adsets"));
    expect(adsets).toHaveLength(1);
    expect(adsets[0].token).toBe(HN_TOKEN);
    // And Costa Rica's stays cached.
    const again = graph(answer, "America/Costa_Rica");
    await getMarketingSources(period, one, again.fetcher, { channels: true, daily: true });
    expect(again.calls.filter((c) => c.url.pathname.endsWith("/adsets"))).toHaveLength(0);
  });

  it("reads account statuses and the ads report of Honduras with its token", async () => {
    const { fetcher, calls } = graph();
    const statuses = await readMetaAccountStatuses(bothEnv, fetcher, "mireva-hn");
    expect(statuses?.map((s) => s.accountId)).toHaveLength(3);
    expect(calls.every((c) => c.token === HN_TOKEN)).toBe(true);
    expect(await readMetaAccountStatuses(crEnv, fetcher, "mireva-hn")).toBeNull();
    const pending = await getCharlieReport(
      marketingPeriod("2026-11-01", "2026-11-07")!,
      crEnv,
      fetcher,
      new Date("2026-11-08T12:00:00Z"),
      undefined,
      false,
      true,
      false,
      "mireva-hn",
    );
    expect(pending).toMatchObject({
      status: "pending",
      message: "Falta configurar la lectura de las cuentas Meta de Honduras.",
    });
  });
});

describe("Publicidad cache", () => {
  beforeEach(() => clearPublicidadCache());
  it("never serves one store's table to the other, even with the same account id", async () => {
    const shared = { ...crEnv, META_CR_AD_ACCOUNT_IDS: "555", ...hnEnv, META_HN_AD_ACCOUNT_IDS: "555" };
    const query = { level: "campaign" as const, from: "2026-11-01", to: "2026-11-07" };
    const cr = graph();
    await getPublicidadMeta({ ...query, store: "mireva-cr" }, shared, cr.fetcher);
    expect(cr.calls.every((c) => c.token === CR_TOKEN)).toBe(true);
    const hn = graph();
    const result = await getPublicidadMeta({ ...query, store: "mireva-hn" }, shared, hn.fetcher);
    expect(result.status).toBe("ready");
    expect(hn.calls.length).toBeGreaterThan(0);
    expect(hn.calls.every((c) => c.token === HN_TOKEN)).toBe(true);
    // Costa Rica again: from its own cache, no new Meta call.
    const crAgain = graph();
    await getPublicidadMeta({ ...query, store: "mireva-cr" }, shared, crAgain.fetcher);
    expect(crAgain.calls).toHaveLength(0);
  });

  it("is pending for Honduras without its variables", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await getPublicidadMeta(
      { level: "campaign", from: "2026-11-01", to: "2026-11-07", store: "mireva-hn" },
      crEnv,
      fetcher,
    );
    expect(result.status).toBe("pending");
    expect(result.message).toContain("Honduras: pendiente de configurar");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Marketing access per store", () => {
  const person = (tiendas: string[], permisos: string[] = ["marketing"]) =>
    ({ permisos, tiendas }) as Parameters<typeof marketingAllowed>[0];
  it("needs the marketing permission and the selected store in tiendas", () => {
    expect(marketingAllowed(person(["mireva-hn"]), { code: "mireva-hn" })).toBe(true);
    expect(marketingAllowed(person(["mireva-cr"]), { code: "mireva-cr" })).toBe(true);
    expect(marketingAllowed(person(["mireva-cr"]), { code: "mireva-hn" })).toBe(false);
    expect(marketingAllowed(person(["mireva-hn"]), { code: "mireva-cr" })).toBe(false);
    expect(marketingAllowed(person(["mireva-hn"], ["finanzas"]), { code: "mireva-hn" })).toBe(false);
    expect(marketingAllowed(person(["kenku-mx"]), { code: "kenku-mx" } as never)).toBe(false);
    expect(marketingAllowed(null, { code: "mireva-hn" })).toBe(false);
    expect(isMarketingStore("mireva-hn")).toBe(true);
    expect(isMarketingStore("kenku-mx")).toBe(false);
  });

  it("only lets a write name the store's own ad accounts (no TikTok in Honduras)", async () => {
    expect(await marketingAccountIds("meta", 2, bothEnv)).toEqual(
      metaConfigAccountIds(metaConfigFor("mireva-hn", bothEnv)),
    );
    expect(await marketingAccountIds("meta", 1, bothEnv)).toEqual(["111", "222"]);
    expect(await marketingAccountIds("meta", 2, crEnv)).toEqual([]);
    expect(
      await marketingAccountIds("tiktok", 2, { ...bothEnv, TIKTOK_CR_ADVERTISER_ID: "777" }),
    ).toEqual([]);
    expect(await marketingAccountIds("meta", 3, bothEnv)).toEqual([]);
  });

  it("names the store in the copy and the requests", () => {
    expect(marketingHourLabel("mireva-hn")).toBe("Hora de Honduras");
    expect(marketingHourLabel("mireva-cr")).toBe("Hora de Costa Rica");
    expect(marketingStoreInfo("mireva-hn")).toMatchObject({ id: 2, currency: "HNL", tiktok: false });
    expect(periodQuery({ from: "2026-11-01", to: "2026-11-02" })).toBe(
      "store=mireva-cr&from=2026-11-01&to=2026-11-02",
    );
    expect(periodQuery({ from: "2026-11-01", to: "2026-11-02" }, "mireva-hn")).toBe(
      "store=mireva-hn&from=2026-11-01&to=2026-11-02",
    );
  });
});

describe("HNL to USD", () => {
  const config = { crc_per_usd: null, rate_date: null, hero_product_keys: [] };
  it("without the team's rate: sin tipo de cambio, never as USD", () => {
    const fx = storeUsdRate(config, "HNL", new Date("2026-11-26T12:00:00Z"));
    expect(fx).toMatchObject({ rate: null, source: "unavailable", local: null, pen: null });
    expect(asUsd(2500, "HNL", fx)).toBeNull();
    expect(asUsd(10, "USD", fx)).toBe(10);
    // A Costa Rica fx never converts HNL either.
    const cr: UsdRate = {
      rate: 505,
      date: "2026-11-26",
      source: "hacienda",
      checkedAt: "",
      message: "",
      pen: null,
    };
    expect(asUsd(2500, "HNL", cr)).toBeNull();
    const [hnl] = storeRates(fx, "HNL");
    expect(hnl).toMatchObject({ currency: "HNL", rate: null, source: "unavailable", reference: null });
    expect(appliedRateText(hnl)).toContain("Sin tipo de cambio HNL");
    expect(storeRatesShortText([hnl])).toBe("USD · HNL sin tipo de cambio (sin convertir)");
  });

  it("with the team's rate (saved in the store's own row) it converts HNL only", () => {
    const fx = storeUsdRate({ ...config, crc_per_usd: 25, rate_date: "2026-11-26" }, "HNL");
    expect(fx.local).toEqual({ currency: "HNL", rate: 25, date: "2026-11-26", source: "manual" });
    expect(asUsd(2500, "HNL", fx)).toBe(100);
    expect(asUsd(2500, "CRC", fx)).toBeNull();
    const [hnl] = storeRates(fx, "HNL");
    expect(hnl).toMatchObject({ rate: 25, source: "manual" });
    expect(storeRatesShortText([hnl])).toBe("USD · 25,00 HNL/USD (tasa del equipo, 26 nov)");
  });

  it("leaves room for an official source (BCH) after the manual rate", () => {
    const official = { currency: "HNL", rate: 24.8, date: "2026-11-26", source: "bch" as const };
    expect(storeUsdRate(config, "HNL", new Date(), official).local).toEqual(official);
    expect(
      storeUsdRate({ ...config, crc_per_usd: 25, rate_date: "2026-11-26" }, "HNL", new Date(), official)
        .local?.source,
    ).toBe("manual");
    const [hnl] = storeRates(storeUsdRate(config, "HNL", new Date(), official), "HNL");
    expect(appliedRateText(hnl)).toBe("1 USD = 24,80 HNL (BCH, 26 nov)");
  });

  it("keeps Costa Rica's toolbar exactly as before", () => {
    const fx: UsdRate = {
      rate: 517.3,
      date: "2026-11-04",
      source: "hacienda",
      checkedAt: "",
      message: "",
      pen: { rate: 3.52, date: "2026-11-04", source: "bcrp" },
    };
    expect(storeRatesShortText(storeRates(fx, "CRC"))).toBe(appliedRatesShortText(appliedRates(fx)));
  });
});

describe("Honduras revenue and summary", () => {
  const period = marketingPeriod("2026-11-01", "2026-11-07")!;
  const order = (key: string, phone: string, created: string, value: number) => ({
    order_key: key,
    created_at: created,
    order_value: value,
    tracking_status: "delivered",
    delivered_on: created.slice(0, 10),
    items: [{ sku: "A", title: "Producto", quantity: 1 }],
  });
  it("revenue is in HNL and identifies customers with the 504 prefix", () => {
    const orders = [
      order("a", "", "2026-10-20T15:00:00Z", 1000),
      order("b", "", "2026-11-03T15:00:00Z", 1500),
    ] as never[];
    const phones = new Map([
      ["a", "50498765432"],
      ["b", "98765432"],
    ]);
    const now = new Date("2026-11-08T12:00:00Z");
    const hn = buildCharlieRevenue(orders, phones, period, [], now, "mireva-hn");
    expect(hn.currency).toBe("HNL");
    expect(hn.revenueCrc).toBe(1500);
    expect(hn.identifiedOrders).toBe(1);
    expect(hn.recurringOrders).toBe(1);
    const cr = buildCharlieRevenue(orders, phones, period, [], now);
    expect(cr.currency).toBe("CRC");
    // 504… is not a Costa Rica number: the old customer is not recognised.
    expect(cr.recurringOrders).toBe(0);
  });

  it("the summary takes Honduras' ads expenses in HNL, never Costa Rica's", () => {
    const expenses = [
      { store_id: 1, type: "ads", currency: "CRC", amount: 5000, expense_date: "2026-11-02", platform: "Meta" },
      { store_id: 2, type: "ads", currency: "HNL", amount: 300, expense_date: "2026-11-02", platform: "Meta" },
    ] as never[];
    const now = new Date("2026-11-08T12:00:00Z");
    const hn = buildMarketingSummary({
      orders: [],
      expenses,
      from: period.from,
      to: period.to,
      now,
      store: { id: 2, code: "mireva-hn", currency: "HNL" },
    });
    expect(hn).toMatchObject({ store: "mireva-hn", currency: "HNL" });
    expect(hn.totals.registeredAdSpend).toBe(300);
    const cr = buildMarketingSummary({ orders: [], expenses, from: period.from, to: period.to, now });
    expect(cr).toMatchObject({ store: "mireva-cr", currency: "CRC" });
    expect(cr.totals.registeredAdSpend).toBe(5000);
  });
});

describe("Pasar a COST CAP per store", () => {
  it("uses the selected store's Meta configuration", async () => {
    const { previewCostCapMove, MoveReadError } = await import(
      "../lib/marketing-cost-cap-move-server"
    );
    const assignments = async () => ({ families: [], mappings: [], keywords: [], enabled: true });
    const fetcher = vi.fn() as unknown as typeof fetch;
    // Honduras without META_HN_*: pending, never Costa Rica's token.
    await expect(
      previewCostCapMove({ account: "111", ad: "9" }, { store: "mireva-hn", env: crEnv, fetcher, assignments }),
    ).rejects.toMatchObject({ reason: "Meta Ads: pendiente de configurar el acceso.", status: 503 });
    // A Costa Rica account is not Honduras'.
    const error = await previewCostCapMove(
      { account: "111", ad: "9" },
      { store: "mireva-hn", env: bothEnv, fetcher, assignments },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(MoveReadError);
    expect(error).toMatchObject({ reason: "Cuenta no autorizada para Honduras.", status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("No TikTok in Honduras", () => {
  it("counts as zero spend (Meta alone is complete) and shows one note", async () => {
    const { reportChannel } = await import("../lib/marketing-team-report");
    const { accountStatusRows } = await import("../lib/marketing-account-status");
    const sources = {
      meta: { status: "ready", checkedAt: "", message: "", data: { accounts: [] } },
      tiktok: { status: "ready", checkedAt: "", message: "", data: { accounts: [] }, notConnected: true },
      shiphero: { status: "pending", checkedAt: "", message: "", data: null },
    } as never;
    expect(reportChannel(sources, "tiktok", null)).toEqual({ spend: 0, purchases: 0, conversions: 0 });
    const status = accountStatusRows({
      meta: [],
      metaError: false,
      tiktok: [],
      tiktokNotConnected: "TikTok Ads no está conectado para Honduras.",
      labels: [],
      today: "2026-11-26",
    });
    expect(status.notes).toEqual(["TikTok Ads no está conectado para Honduras."]);
  });
});
