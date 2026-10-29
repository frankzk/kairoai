import { describe, expect, it, vi } from "vitest";
import { getCharlieReport } from "../lib/marketing-charlie-source";
import { marketingPeriod } from "../lib/marketing-dates";
const period = marketingPeriod("2026-10-29", "2026-10-29")!,
  now = new Date("2026-10-29T20:00:00Z");
const env = {
  META_CR_AD_ACCOUNT_IDS: "123",
  META_CR_GRAPH_VERSION: "v26.0",
  META_CR_ACCESS_TOKEN: "private-token-fixture",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const reportRow = {
  ad_id: "1",
  ad_name: "Anuncio real",
  adset_id: "11",
  campaign_id: "22",
  date_start: "2026-10-29",
  spend: "12.50",
  impressions: "1000",
  clicks: "15",
  frequency: "1.13",
  actions: [
    { action_type: "omni_purchase", value: "2" },
    { action_type: "purchase", value: "2" },
    { action_type: "post_engagement", value: "10" },
  ],
  action_values: [
    { action_type: "omni_purchase", value: "48" },
    { action_type: "purchase", value: "48" },
  ],
};
describe("Charlie Meta reader", () => {
  it("requests daily ad insights and expands the trailing series, keeping tokens in headers", async () => {
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(String(input)).not.toContain(env.META_CR_ACCESS_TOKEN);
        expect(init?.headers).toEqual({
          Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}`,
        });
        expect(init?.redirect).toBe("error");
        if (url.pathname.endsWith("act_123"))
          return json({
            id: "act_123",
            currency: "USD",
            timezone_name: "America/Costa_Rica",
          });
        if (url.pathname.endsWith("/insights")) {
          expect(url.searchParams.get("level")).toBe("ad");
          expect(url.searchParams.get("time_increment")).toBe("1");
          expect(JSON.parse(url.searchParams.get("time_range")!)).toEqual({
            since: "2026-10-23",
            until: "2026-10-29",
          });
          return json({ data: [reportRow] });
        }
        if (url.pathname.endsWith("/ads"))
          return json({
            data: [
              {
                id: "1",
                name: "Anuncio real",
                adset_id: "11",
                campaign_id: "22",
                effective_status: "ACTIVE",
                creative: {
                  id: "9",
                  effective_object_story_id: "99_88",
                  asset_feed_spec: {
                    bodies: [{ text: "Uno" }, { text: "Dos" }],
                    titles: [{ text: "A" }],
                  },
                },
              },
            ],
          });
        return json({
          data: [
            {
              id: "11",
              name: "Control",
              campaign_id: "22",
              effective_status: "ACTIVE",
              is_dynamic_creative: false,
            },
          ],
        });
      },
    );
    const result = await getCharlieReport(period, env, fetcher, now);
    expect(result.status).toBe("ready");
    expect(result.data?.accounts[0].ads[0]).toMatchObject({
      postId: "99_88",
      assets: { creatives: null, bodies: 2, titles: 1 },
      daily: [
        { purchases: 2, purchaseValue: 48, interactions: 10, frequency: 1.13 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(env.META_CR_ACCESS_TOKEN);
  });
  it("rebuilds pagination on Meta's host instead of following untrusted next links", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("graph.facebook.com");
      if (url.pathname.endsWith("act_123"))
        return json({
          id: "act_123",
          currency: "USD",
          timezone_name: "America/Costa_Rica",
        });
      if (url.pathname.endsWith("/insights"))
        return url.searchParams.has("after")
          ? json({ data: [{ ...reportRow, ad_id: "2" }] })
          : json({
              data: [reportRow],
              paging: {
                next: "https://untrusted.invalid/?token=private",
                cursors: { after: "trusted-cursor" },
              },
            });
      return json({ data: [] });
    });
    expect(
      (await getCharlieReport(period, env, fetcher, now)).data?.accounts[0].ads,
    ).toHaveLength(2);
  });
  it("keeps performance usable when metadata fails and does not manufacture missing frequency or purchase value", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("act_123"))
        return json({
          id: "act_123",
          currency: "USD",
          timezone_name: "America/Costa_Rica",
        });
      if (url.pathname.endsWith("/insights"))
        return json({
          data: [
            { ...reportRow, frequency: undefined, action_values: undefined },
          ],
        });
      return json({ error: { message: env.META_CR_ACCESS_TOKEN } }, 403);
    });
    const result = await getCharlieReport(period, env, fetcher, now);
    expect(result.status).toBe("ready");
    expect(result.data?.accounts[0].metadataMessage).toBeTruthy();
    expect(result.data?.accounts[0].ads[0].daily[0]).toMatchObject({
      frequency: null,
      purchaseValue: null,
      purchases: 2,
    });
  });
  it("rejects a duplicate day, incomplete pagination or inaccessible configured account instead of partial totals", async () => {
    for (const mode of ["duplicate", "pagination", "account"]) {
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("act_456"))
          return json({ error: { message: "private-token-fixture" } }, 403);
        if (url.pathname.endsWith("act_123"))
          return json({
            id: "act_123",
            currency: "USD",
            timezone_name: "America/Costa_Rica",
          });
        if (url.pathname.endsWith("/insights"))
          return mode === "duplicate"
            ? json({ data: [reportRow, reportRow] })
            : mode === "pagination"
              ? json({
                  data: [reportRow],
                  paging: { next: "https://elsewhere.invalid" },
                })
              : json({ data: [reportRow] });
        return json({ data: [] });
      });
      const result = await getCharlieReport(
        period,
        {
          ...env,
          META_CR_AD_ACCOUNT_IDS: mode === "account" ? "123,456" : "123",
        },
        fetcher,
        now,
      );
      expect(result).toMatchObject({ status: "error", data: null });
      expect(JSON.stringify(result)).not.toContain("private-token-fixture");
    }
  });
  it("does not contact Meta without configuration", async () => {
    const fetcher = vi.fn();
    expect((await getCharlieReport(period, {}, fetcher, now)).status).toBe(
      "pending",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
