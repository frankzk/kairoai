import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mocks.from }) }));
vi.mock("@/lib/marketing-origin-catalog", () => ({
  readOriginCatalog: mocks.catalog,
}));
import {
  listMarketingOrigins,
  orderMarketingOrigin,
} from "../lib/marketing-attribution-db";
function setup(
  tables: Record<string, Array<{ data: unknown; error: unknown }>> = {},
) {
  const queries: Record<string, ReturnType<typeof chain>[]> = {};
  function chain(table: string) {
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of [
      "select",
      "eq",
      "gte",
      "lt",
      "order",
      "or",
      "range",
      "limit",
      "in",
      "not",
    ])
      q[name] = vi.fn(() => q);
    q.then = vi.fn((resolve: (v: unknown) => unknown) =>
      Promise.resolve(tables[table]?.shift() ?? { data: [], error: null }).then(
        resolve,
      ),
    );
    return q;
  }
  mocks.from.mockImplementation((table: string) => {
    const q = chain(table);
    (queries[table] ??= []).push(q);
    return q;
  });
  return queries;
}
const from = "2026-10-01T06:00:00Z",
  to = "2026-11-01T06:00:00Z";
const origin = { utm_source: "facebook", campaign_id: "123456789" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.mockResolvedValue([]);
});
describe("recuperación privada de UTM", () => {
  it("pagina y restringe todas las fuentes por tienda sin leer clientes", async () => {
    const q = setup({
      icomfly_order_payloads: [
        { data: Array(1000).fill({ ad_origin: null }), error: null },
        { data: [{ ad_origin: origin }], error: null },
      ],
      shopify_orders: [
        {
          data: [
            {
              name: "#MCRC123",
              shopify_order_id: "88",
              note_attributes: [
                { name: "utm_campaign", value: "CBO%20NAD---123456789" },
                { name: "utm_source", value: "facebook" },
                { name: "email", value: "private" },
              ],
            },
          ],
          error: null,
        },
      ],
    });
    const result = await listMarketingOrigins(2, from, to);
    expect(result).toHaveLength(1002);
    expect(result.at(-1)).toMatchObject({
      originSource: "shopify_saved",
      resolvedOrigin: { campaignId: "123456789", campaignName: "CBO NAD" },
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(q.icomfly_order_payloads.map((x) => x.range.mock.calls[0])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    for (const qs of Object.values(q))
      for (const query of qs) {
        expect(query.eq).toHaveBeenCalledWith("store_id", 2);
        expect(query.select.mock.calls[0][0]).not.toMatch(
          /phone|customer|email|address|^\*$/,
        );
      }
    expect(q.shopify_orders[0].gte).toHaveBeenCalledWith(
      "shopify_created_at",
      from,
    );
    expect(q.shopify_archivo[0].eq).toHaveBeenCalledWith("recurso", "order");
    expect(q.icomfly_order_payloads[0].gte).toHaveBeenCalledWith(
      "payload->>created_at",
      "2026-09-30",
    );
  });
  it("rechaza resultados parciales cuando falla una página", async () => {
    setup({ shopify_archivo: [{ data: null, error: { message: "private" } }] });
    await expect(listMarketingOrigins(1, from, to)).rejects.toThrow(
      "No se pudieron consultar",
    );
  });
  it("hereda únicamente reemplazos completados, incluyendo cadenas de upsell", async () => {
    const q = setup({
      order_upsell_replacements: [
        {
          data: [
            {
              original_id: "1",
              replacement_id: "2",
              replacement_name: "IC-W2",
            },
            {
              original_id: "2",
              replacement_id: "3",
              replacement_name: "IC-W3",
            },
          ],
          error: null,
        },
      ],
      icomfly_order_payloads: [
        { data: [], error: null },
        {
          data: [
            { icomfly_order_id: "1", ad_origin: origin },
            { icomfly_order_id: "2", ad_origin: null },
          ],
          error: null,
        },
      ],
    });
    const result = await listMarketingOrigins(1, from, to);
    expect(
      result.find(
        (r) =>
          r.shopify_display_number === "IC-W3" && r.resolvedOrigin?.campaignId,
      ),
    ).toMatchObject({ originSource: "upsell_original", tracking_number: null });
    expect(q.order_upsell_replacements[0].not).toHaveBeenCalledWith(
      "completed_at",
      "is",
      null,
    );
  });
  it("no mezcla referencias ambiguas al abrir la ficha", async () => {
    setup({
      icomfly_order_payloads: [
        { data: [{ ad_origin: origin }, { ad_origin: origin }], error: null },
      ],
    });
    expect(await orderMarketingOrigin(1, "IC-W638")).toBeNull();
    mocks.from.mockClear();
    expect(await orderMarketingOrigin(1, "' arbitrary")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("recupera la ficha por nombre exacto de Shopify y catálogo verificado", async () => {
    mocks.catalog.mockResolvedValue([
      { platform: "meta", accountId: "123", campaignId: "123456789" },
    ]);
    const q = setup({
      shopify_archivo: [
        {
          data: [
            {
              name: "#MCRC123",
              shopify_id: "88",
              note_attributes: [{ name: "utm_campaign", value: "123456789" }],
            },
          ],
          error: null,
        },
      ],
    });
    expect(await orderMarketingOrigin(1, "#MCRC123")).toMatchObject({
      platform: "meta",
      campaignId: "123456789",
    });
    expect(q.shopify_archivo[0].in).toHaveBeenCalledWith("payload->>name", [
      "MCRC123",
      "#MCRC123",
    ]);
  });
});
