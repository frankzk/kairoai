import { describe, expect, it, vi } from "vitest";
import {
  changesFromUpdatedTime,
  classifyMetaActivity,
  normalizeMetaActivities,
  readMetaActivities,
} from "../lib/marketing-meta-activity";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const base = "https://graph.facebook.com/v24.0/act_123";
const adsets = new Map([["2001", "1001"]]);

describe("Meta activity log", () => {
  it("classifies the event types the rules use", () => {
    expect(classifyMetaActivity("update_campaign_budget")).toBe("presupuesto");
    expect(classifyMetaActivity("update_ad_set_budget")).toBe("presupuesto");
    expect(classifyMetaActivity("update_ad_set_bid_amount")).toBe("puja");
    expect(classifyMetaActivity("create_ad")).toBe("creativo");
    expect(classifyMetaActivity("update_ad_creative")).toBe("creativo");
    expect(classifyMetaActivity("update_ad_run_status")).toBe("estado");
    expect(classifyMetaActivity("update_campaign_run_status")).toBe("estado");
    expect(classifyMetaActivity("create_campaign_group")).toBe("lanzamiento");
    expect(classifyMetaActivity("ad_review_approved")).toBeNull();
    expect(classifyMetaActivity("update_campaign_name")).toBeNull();
  });

  it("drops system events and resolves campaigns from campaign, ad set and ad rows", () => {
    const changes = normalizeMetaActivities(
      [
        {
          event_type: "ad_delivered",
          event_time: "2026-11-04T10:00:00+0000",
          actor_id: "0",
          object_type: "CAMPAIGN_GROUP",
          object_id: "1001",
        },
        {
          event_type: "update_campaign_budget",
          translated_event_type: "Presupuesto de la campaña actualizado",
          event_time: "2026-11-04T22:26:00+0000",
          actor_id: "55",
          actor_name: "Ana",
          object_type: "CAMPAIGN_GROUP",
          object_id: "1001",
          extra_data: JSON.stringify({
            old_value: { old_value: 5000 },
            new_value: { new_value: 6000 },
          }),
        },
        {
          event_type: "update_ad_set_bid_amount",
          event_time: "2026-11-03T15:00:00-0600",
          actor_id: "55",
          object_type: "CAMPAIGN",
          object_id: "2001",
          extra_data: '{"old_value":850,"new_value":"900"}',
        },
        {
          event_type: "create_ad",
          event_time: "2026-11-02T15:00:00+0000",
          actor_id: "56",
          object_type: "ADGROUP",
          object_id: "3001",
          extra_data: '{"campaign_id":"1001"}',
        },
        {
          event_type: "update_ad_run_status",
          event_time: "2026-11-02T16:00:00+0000",
          actor_id: "56",
          object_type: "ADGROUP",
          object_id: "3002",
          extra_data: '{"campaign_id":"2001"}',
        },
        {
          event_type: "create_ad",
          event_time: "2026-11-02T17:00:00+0000",
          actor_id: "56",
          object_type: "ADGROUP",
          object_id: "3003",
          extra_data: '{"campaign_id":"999999"}',
        },
        {
          event_type: "update_ad_set_bid_amount",
          event_time: "2026-11-02T18:00:00+0000",
          actor_id: "56",
          object_type: "CAMPAIGN",
          object_id: "unknown",
        },
      ],
      "123",
      adsets,
    );
    expect(changes).toEqual([
      {
        platform: "meta",
        accountId: "123",
        campaignId: "1001",
        at: "2026-11-04T22:26:00.000Z",
        kind: "presupuesto",
        detail: "Presupuesto de la campaña actualizado: 50.00 → 60.00",
        source: "meta",
        by: "Ana",
      },
      {
        platform: "meta",
        accountId: "123",
        campaignId: "1001",
        at: "2026-11-03T21:00:00.000Z",
        kind: "puja",
        detail: "update_ad_set_bid_amount: 8.50 → 9.00",
        source: "meta",
      },
      {
        platform: "meta",
        accountId: "123",
        campaignId: "1001",
        at: "2026-11-02T16:00:00.000Z",
        kind: "estado",
        detail: "update_ad_run_status",
        source: "meta",
      },
      {
        platform: "meta",
        accountId: "123",
        campaignId: "1001",
        at: "2026-11-02T15:00:00.000Z",
        kind: "creativo",
        detail: "create_ad",
        source: "meta",
      },
    ]);
  });

  it("pages with cursors only and rejects a repeated cursor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [],
          paging: {
            next: "https://evil.invalid/?token=x",
            cursors: { after: "c1" },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              event_type: "create_campaign_group",
              event_time: "2026-11-01T12:00:00+0000",
              actor_id: "1",
              object_type: "CAMPAIGN_GROUP",
              object_id: "1001",
            },
          ],
        }),
      );
    const changes = await readMetaActivities(
      base,
      { Authorization: "Bearer t" },
      new AbortController().signal,
      fetcher,
      "2026-10-23",
      adsets,
      { now: new Date("2026-11-05T12:00:00Z") },
    );
    expect(changes).toMatchObject([
      { kind: "lanzamiento", campaignId: "1001" },
    ]);
    const first = new URL(String(fetcher.mock.calls[0][0]));
    expect(first.pathname).toBe("/v24.0/act_123/activities");
    expect(first.searchParams.get("since")).toBe(
      String(Date.parse("2026-10-23T06:00:00Z") / 1000),
    );
    expect(first.searchParams.get("until")).toBe(
      String(Date.parse("2026-11-05T12:00:00Z") / 1000),
    );
    const second = new URL(String(fetcher.mock.calls[1][0]));
    expect(second.hostname).toBe("graph.facebook.com");
    expect(second.searchParams.get("after")).toBe("c1");

    const looping = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [],
          paging: { next: "x", cursors: { after: "same" } },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [],
          paging: { next: "x", cursors: { after: "same" } },
        }),
      );
    await expect(
      readMetaActivities(
        base,
        {},
        new AbortController().signal,
        looping,
        "2026-10-23",
        adsets,
      ),
    ).rejects.toThrow();
  });

  it("fails without forwarding provider errors", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ error: { message: "secret token" } }, 403));
    await expect(
      readMetaActivities(
        base,
        {},
        new AbortController().signal,
        fetcher,
        "2026-10-23",
        adsets,
      ),
    ).rejects.toThrow("Activity unavailable");
  });

  it("builds last-edit entries from updated_time", () => {
    expect(
      changesFromUpdatedTime("123", [
        { id: "1", updatedTime: "2026-11-04T10:00:00.000Z" },
        { id: "2", updatedTime: null },
      ]),
    ).toEqual([
      {
        platform: "meta",
        accountId: "123",
        campaignId: "1",
        at: "2026-11-04T10:00:00.000Z",
        kind: "otro",
        detail: "Última edición en Meta (sin detalle)",
        source: "meta_edicion",
      },
    ]);
  });
});
