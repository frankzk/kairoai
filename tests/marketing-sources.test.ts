import { describe, expect, it, vi } from "vitest";
import { getMarketingSources, hourOfBreakdown, metaAccountIds } from "../lib/marketing-sources";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const metaEnv = { META_CR_AD_ACCOUNT_ID: "act_123", META_CR_GRAPH_VERSION: "v24.0", META_CR_ACCESS_TOKEN: "private-meta-token" };
const tiktokEnv = { TIKTOK_CR_ADVERTISER_ID: "456", TIKTOK_CR_ACCESS_TOKEN: "private-tiktok-token" };
const shipEnv = { SHIPHERO_CR_ACCESS_TOKEN: "private-ship-token", SHIPHERO_CR_ACCOUNT_ID: "account-cr", SHIPHERO_CR_WAREHOUSE_ID: "warehouse-cr" };

describe("marketing source readers", () => {
  it("does not call providers or expose zero metrics without configuration", async () => {
    const fetcher = vi.fn();
    const result = await getMarketingSources("2026-10", {}, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    for (const source of Object.values(result)) expect(source).toMatchObject({ status: "pending", data: null });
  });

  it("keeps Meta credentials in headers and paginates with trusted URLs only", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: "act_123", currency: "USD", timezone_name: "America/Los_Angeles" }))
      .mockResolvedValueOnce(response({ data: [{ campaign_id: "C1", campaign_name: "Campaña", spend: "10.25", impressions: "100", clicks: "4" }], paging: { next: "https://untrusted.invalid/?access_token=secret", cursors: { after: "next-cursor" } } }))
      .mockResolvedValueOnce(response({ data: [{ campaign_id: "C2", campaign_name: "Segunda", spend: "2", impressions: "30", clicks: "1" }] }));
    const result = await getMarketingSources("2026-10", metaEnv, fetcher);
    expect(result.meta.status).toBe("ready");
    expect(result.meta.data?.accounts[0]).toMatchObject({ currency: "USD", timezone: "America/Los_Angeles", campaigns: [{ id: "C1", spend: 10.25 }, { id: "C2", spend: 2 }] });
    const lastUrl = new URL(String(fetcher.mock.calls[2][0]));
    expect(lastUrl.hostname).toBe("graph.facebook.com");
    expect(lastUrl.searchParams.get("after")).toBe("next-cursor");
    expect(lastUrl.searchParams.get("time_range")).toBe('{"since":"2026-10-01","until":"2026-10-31"}');
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain(metaEnv.META_CR_ACCESS_TOKEN);
      expect(init.headers.Authorization).toBe(`Bearer ${metaEnv.META_CR_ACCESS_TOKEN}`);
      expect(init.redirect).toBe("error");
    }
    expect(JSON.stringify(result)).not.toContain(metaEnv.META_CR_ACCESS_TOKEN);
  });

  it("rejects incomplete pagination and never forwards provider errors or tokens", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: "act_123", currency: "CRC", timezone_name: "America/Costa_Rica" }))
      .mockResolvedValueOnce(response({ data: [], paging: { next: "https://somewhere.invalid/private-meta-token" } }));
    const result = await getMarketingSources("2026-10", metaEnv, fetcher);
    expect(result.meta).toMatchObject({ status: "error", data: null });
    expect(JSON.stringify(result)).not.toContain("private-meta-token");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reads TikTok account metadata and all report pages without mixing currency", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ code: 0, data: { list: [{ advertiser_id: "456", currency: "USD", timezone: "Etc/GMT+6" }] } }))
      .mockResolvedValueOnce(response({ code: 0, data: { list: [{ dimensions: { campaign_id: "A" }, metrics: { campaign_name: "TikTok A", spend: "5.20", impressions: "50", clicks: "2" } }], page_info: { total_page: 2 } } }))
      .mockResolvedValueOnce(response({ code: 0, data: { list: [{ dimensions: { campaign_id: "B" }, metrics: { campaign_name: "TikTok B", spend: "1", impressions: "10", clicks: "1" } }], page_info: { total_page: 2 } } }));
    const result = await getMarketingSources("2026-10", tiktokEnv, fetcher);
    expect(result.tiktok).toMatchObject({ status: "ready", data: { accounts: [{ accountId: "456", currency: "USD", campaigns: [{ id: "A", spend: 5.2 }, { id: "B", spend: 1 }] }] } });
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get("page")).toBe("2");
    expect(fetcher.mock.calls[1][1].headers["Access-Token"]).toBe("private-tiktok-token");
  });

  it("distinguishes a successful empty report from failed or malformed metrics", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ id: "act_123", currency: "CRC", timezone_name: "America/Costa_Rica" }))
      .mockResolvedValueOnce(response({ data: [] }));
    expect((await getMarketingSources("2026-10", metaEnv, fetcher)).meta).toMatchObject({ status: "ready", data: { accounts: [{ campaigns: [] }] } });
    fetcher.mockResolvedValueOnce(response({ id: "act_123", currency: "CRC", timezone_name: "America/Costa_Rica" }))
      .mockResolvedValueOnce(response({ data: [{ campaign_id: "X", spend: "NaN", impressions: 1, clicks: 0 }] }));
    expect((await getMarketingSources("2026-10", metaEnv, fetcher)).meta).toMatchObject({ status: "error", data: null });
  });

  it("scopes ShipHero by account and warehouse and preserves genuine zero stock", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: { warehouse_products: { data: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [{ node: { id: "wp1", account_id: "account-cr", warehouse_id: "warehouse-cr", sku: "SKU1", on_hand: 3, allocated: 3, available: 0 } }],
    } } } }));
    const result = await getMarketingSources("2026-10", shipEnv, fetcher);
    expect(result.shiphero).toMatchObject({ status: "ready", data: { stock: [{ sku: "SKU1", available: 0, onHand: 3, allocated: 3 }] } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).variables).toMatchObject({ account: "account-cr", warehouse: "warehouse-cr" });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).query).not.toContain("mutation");
  });

  it("rejects inventory from another account rather than showing it in Costa Rica", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: { warehouse_products: { data: {
      pageInfo: { hasNextPage: false }, edges: [{ node: { id: "wp1", account_id: "other", warehouse_id: "warehouse-cr", sku: "SKU1", on_hand: 50, allocated: 0, available: 50 } }],
    } } } }));
    expect((await getMarketingSources("2026-10", shipEnv, fetcher)).shiphero).toMatchObject({ status: "error", data: null });
  });

  it("isolates provider failures and requires a fully configured inventory scope", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private-meta-token"));
    const result = await getMarketingSources("2026-10", { ...metaEnv, SHIPHERO_CR_ACCESS_TOKEN: "private-ship-token" }, fetcher);
    expect(result.meta.status).toBe("error");
    expect(result.shiphero.status).toBe("pending");
    expect(result.tiktok.status).toBe("pending");
    expect(JSON.stringify(result)).not.toContain("private-meta-token");
  });

  it("deduplicates Meta account IDs and keeps same-named campaigns in separate accounts", async () => {
    expect(metaAccountIds({ META_CR_AD_ACCOUNT_IDS: "act_123,456,123" })).toEqual(["123", "456"]);
    expect(() => metaAccountIds({ META_CR_AD_ACCOUNT_IDS: "123,https://invalid" })).toThrow();
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const id = url.pathname.includes("act_123") ? "123" : "456";
      return url.pathname.endsWith("/insights")
        ? response({ data: [{ campaign_id: "same-id", campaign_name: "Misma campaña", spend: id === "123" ? "10" : "20", impressions: "100", clicks: "4" }] })
        : response({ id: `act_${id}`, name: `Cuenta ${id}`, currency: id === "123" ? "USD" : "CRC", timezone_name: "America/Costa_Rica" });
    });
    const result = await getMarketingSources("2026-10", { ...metaEnv, META_CR_AD_ACCOUNT_IDS: "123,456,123" }, fetcher);
    expect(result.meta.status).toBe("ready");
    expect(result.meta.data?.accounts.map(account => [account.accountId, account.currency, account.campaigns[0].spend])).toEqual([["123", "USD", 10], ["456", "CRC", 20]]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("keeps the readable Meta accounts and lists the one that cannot be read (partial, never complete)", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("act_456")) return response({ error: { message: "private-meta-token" } }, 403);
      return url.pathname.endsWith("/insights") ? response({ data: [] })
        : response({ id: "act_123", currency: "CRC", timezone_name: "America/Costa_Rica" });
    });
    const result = await getMarketingSources("2026-10", { ...metaEnv, META_CR_AD_ACCOUNT_IDS: "123,456" }, fetcher);
    expect(result.meta.status).toBe("ready");
    expect(result.meta.data?.accounts.map((a) => a.accountId)).toEqual(["123"]);
    expect(result.meta.data?.unavailable).toEqual([{ accountId: "456", reason: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain("private-meta-token");
  });

  describe("actions and hourly scopes", () => {
    const now = new Date("2026-11-05T20:35:00Z");
    const period = { from: "2026-10-23", to: "2026-11-05" };
    function router(options: { timezone?: string; fail?: string[] } = {}) {
      return vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const path = url.pathname;
        if (options.fail?.some((part) => path.endsWith(part) || url.searchParams.get("date_preset") === part || url.searchParams.get("breakdowns")?.startsWith(part)))
          return response({ error: { message: "private-meta-token" } }, 400);
        if (path.endsWith("/act_123"))
          return response({ id: "act_123", name: "Arqui Nexo DC003 CR4", currency: "USD", timezone_name: options.timezone ?? "America/Costa_Rica" });
        if (path.endsWith("/campaigns"))
          return response({ data: [{ id: "1001", name: "COST CAP_SELERB NAD", effective_status: "ACTIVE", bid_strategy: "COST_CAP", created_time: "2026-10-20T10:00:00-0600", start_time: "2026-10-21T00:00:00-0600", updated_time: "2026-11-03T09:00:00-0600" }] });
        if (path.endsWith("/adsets"))
          return response({ data: [{ id: "2001", campaign_id: "1001", effective_status: "ACTIVE", daily_budget: "5000", bid_amount: "850", updated_time: "2026-11-04T16:26:00-0600" }] });
        if (path.endsWith("/activities"))
          return response({ data: [{ event_type: "update_ad_set_budget", event_time: "2026-11-04T22:26:00+0000", actor_id: "9", object_type: "CAMPAIGN", object_id: "2001" }] });
        if (path.endsWith("/insights")) {
          if (url.searchParams.get("date_preset") === "maximum")
            return response({ data: [{ campaign_id: "1001", spend: "320.5", actions: [{ action_type: "omni_purchase", value: "30" }, { action_type: "purchase", value: "30" }] }] });
          if (url.searchParams.get("breakdowns"))
            return response({ data: [
              { date_start: "2026-11-05", spend: "12.5", hourly_stats_aggregated_by_advertiser_time_zone: "14:00:00 - 14:59:59" },
              { date_start: "2026-11-05", spend: "2.5", hourly_stats_aggregated_by_advertiser_time_zone: "00:00:00 - 00:59:59" },
              { date_start: "2026-11-04", spend: "7", hourly_stats_aggregated_by_advertiser_time_zone: "14:00:00 - 14:59:59" },
            ] });
          return response({ data: [{ campaign_id: "1001", campaign_name: "COST CAP_SELERB NAD", date_start: "2026-11-04", spend: "40", impressions: "1000", clicks: "20", actions: [{ action_type: "omni_purchase", value: "4" }] }] });
        }
        return response({}, 404);
      });
    }

    it("parses the hourly breakdown label", () => {
      expect(hourOfBreakdown("14:00:00 - 14:59:59")).toBe(14);
      expect(hourOfBreakdown("00:00:00 - 00:59:59")).toBe(0);
      expect(hourOfBreakdown("24:00:00 - 24:59:59")).toBeNull();
      expect(hourOfBreakdown("")).toBeNull();
    });

    it("requests bids, lifetime and activities for scope=actions", async () => {
      const fetcher = router();
      const result = await getMarketingSources(period, metaEnv, fetcher, { actions: true, now });
      expect(result.meta.status).toBe("ready");
      const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
      expect(urls.find((u) => u.pathname.endsWith("/adsets"))?.searchParams.get("fields")).toContain("bid_amount");
      expect(urls.find((u) => u.pathname.endsWith("/campaigns"))?.searchParams.get("fields")).toContain("bid_strategy");
      expect(urls.some((u) => u.searchParams.get("date_preset") === "maximum")).toBe(true);
      expect(urls.some((u) => u.pathname.endsWith("/activities"))).toBe(true);
      expect(urls.some((u) => u.searchParams.get("breakdowns"))).toBe(false);
      const account = result.meta.data!.accounts[0];
      expect(account.campaigns[0]).toMatchObject({
        id: "1001",
        bidStrategy: "COST_CAP",
        bidAmount: 8.5,
        bidAmountMixed: false,
        dailyBudget: 50,
        startTime: "2026-10-21T06:00:00.000Z",
        updatedTime: "2026-11-04T22:26:00.000Z",
        lifetime: { spend: 320.5, purchases: 30, firstDate: "2026-10-21" },
        daily: [{ date: "2026-11-04", spend: 40, purchases: 4 }],
      });
      expect(account.changesStatus).toBe("activity");
      expect(account.changes).toMatchObject([{ campaignId: "1001", kind: "presupuesto", source: "meta" }]);
      expect(JSON.stringify(result)).not.toContain("private-meta-token");
    });

    it("keeps the account ready when lifetime or activities fail, falling back to updated_time", async () => {
      const result = await getMarketingSources(period, metaEnv, router({ fail: ["maximum", "/activities"] }), { actions: true, now });
      expect(result.meta.status).toBe("ready");
      const account = result.meta.data!.accounts[0];
      expect(account.lifetimeMessage).toBeTruthy();
      expect(account.campaigns[0].lifetime).toBeUndefined();
      expect(account.changesStatus).toBe("updated_time");
      expect(account.changes).toEqual([
        expect.objectContaining({ campaignId: "1001", source: "meta_edicion", kind: "otro", at: "2026-11-04T22:26:00.000Z" }),
      ]);
      const none = await getMarketingSources(period, metaEnv, router({ fail: ["/activities", "/campaigns"] }), { actions: true, now });
      expect(none.meta.data!.accounts[0]).toMatchObject({ changesStatus: "unavailable", changes: [] });
      // Activities without the catalog lose ad set events: the log is incomplete.
      const noCatalog = await getMarketingSources(period, metaEnv, router({ fail: ["/campaigns"] }), { actions: true, now });
      expect(noCatalog.meta.data!.accounts[0].changesStatus).toBe("unavailable");
    });

    it("adds hourly spend for the last 8 CR days only on Costa Rica accounts", async () => {
      const fetcher = router();
      const result = await getMarketingSources(period, metaEnv, fetcher, { daily: true, hourly: true, now });
      const hourlyUrl = fetcher.mock.calls.map(([url]) => new URL(String(url))).find((u) => u.searchParams.get("breakdowns"));
      expect(hourlyUrl?.searchParams.get("level")).toBe("account");
      expect(JSON.parse(hourlyUrl!.searchParams.get("time_range")!)).toEqual({ since: "2026-10-29", until: "2026-11-05" });
      const hourly = result.meta.data!.accounts[0].hourly!;
      expect(hourly.days.map((d) => d.date)).toEqual(["2026-11-04", "2026-11-05"]);
      expect(hourly.days[1].hours[14]).toBe(12.5);
      expect(hourly.days[1].hours[0]).toBe(2.5);
      expect(hourly.days[1].hours).toHaveLength(24);

      const other = router({ timezone: "America/Los_Angeles" });
      const skipped = await getMarketingSources(period, metaEnv, other, { daily: true, hourly: true, now });
      expect(other.mock.calls.some(([url]) => new URL(String(url)).searchParams.get("breakdowns"))).toBe(false);
      expect(skipped.meta.data!.accounts[0]).toMatchObject({ hourlyMessage: expect.stringContaining("Costa Rica") });
      expect(skipped.meta.data!.accounts[0].hourly).toBeUndefined();

      const failed = await getMarketingSources(period, metaEnv, router({ fail: ["hourly"] }), { daily: true, hourly: true, now });
      expect(failed.meta.status).toBe("ready");
      expect(failed.meta.data!.accounts[0].hourlyMessage).toBeTruthy();
    });
  });
});

describe("ShipHero: saved connection snapshot before the static env", () => {
  const saved = {
    status: "ready" as const,
    checkedAt: "2026-11-06T16:13:00Z",
    message: "Inventario de ShipHero del 6 nov, 10:13.",
    data: { stock: [{ sku: "SKU1", warehouseId: "w", onHand: 1, available: 1, allocated: 0 }], origin: "shiphero" as const, snapshotDate: "2026-11-06" },
  };

  it("uses the saved snapshot and never calls ShipHero live", async () => {
    const fetcher = vi.fn();
    const result = await getMarketingSources("2026-10", shipEnv, fetcher, { shipheroGuardado: async () => saved });
    expect(result.shiphero).toBe(saved);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("without a saved connection (null or a failed read) the static env still works, now with origin", async () => {
    for (const shipheroGuardado of [async () => null, async () => { throw new Error("db down"); }]) {
      const fetcher = vi.fn().mockResolvedValue(response({ data: { warehouse_products: { data: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [{ node: { id: "wp1", account_id: "account-cr", warehouse_id: "warehouse-cr", sku: "SKU1", on_hand: 3, allocated: 3, available: 0 } }],
      } } } }));
      const result = await getMarketingSources("2026-10", shipEnv, fetcher, { shipheroGuardado });
      expect(result.shiphero).toMatchObject({ status: "ready", data: { origin: "shiphero", stock: [{ sku: "SKU1", available: 0 }] } });
    }
    const none = await getMarketingSources("2026-10", {}, vi.fn(), { shipheroGuardado: async () => null });
    expect(none.shiphero.status).toBe("pending");
  });

  it("a connection without a ready snapshot does not shadow a working static env", async () => {
    const pending = { status: "pending" as const, checkedAt: "x", message: "ShipHero conectado. Falta elegir qué inventario leer.", data: null, connection: "needs_scope" as const };
    const fetcher = vi.fn().mockResolvedValue(response({ data: { warehouse_products: { data: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [{ node: { id: "wp1", account_id: "account-cr", warehouse_id: "warehouse-cr", sku: "SKU1", on_hand: 3, allocated: 0, available: 3 } }],
    } } } }));
    const live = await getMarketingSources("2026-10", shipEnv, fetcher, { shipheroGuardado: async () => pending });
    expect(live.shiphero).toMatchObject({ status: "ready", data: { origin: "shiphero", stock: [{ sku: "SKU1" }] } });
    // Without the static env the pending connection says what it waits for.
    const alone = await getMarketingSources("2026-10", {}, vi.fn(), { shipheroGuardado: async () => pending });
    expect(alone.shiphero).toBe(pending);
  });
});
