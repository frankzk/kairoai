import { describe, expect, it, vi } from "vitest";
import { getMarketingSources, metaAccountIds } from "../lib/marketing-sources";

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

  it("withholds incomplete Meta results if one configured account cannot be read", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("act_456")) return response({ error: { message: "private-meta-token" } }, 403);
      return url.pathname.endsWith("/insights") ? response({ data: [] })
        : response({ id: "act_123", currency: "CRC", timezone_name: "America/Costa_Rica" });
    });
    const result = await getMarketingSources("2026-10", { ...metaEnv, META_CR_AD_ACCOUNT_IDS: "123,456" }, fetcher);
    expect(result.meta).toMatchObject({ status: "error", data: null });
    expect(JSON.stringify(result)).not.toContain("private-meta-token");
  });
});
