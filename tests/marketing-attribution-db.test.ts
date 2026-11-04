import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: mocks.from }) }));
import {
  listMarketingOrigins,
  orderMarketingOrigin,
} from "../lib/marketing-attribution-db";
function query(pages: Array<{ data: unknown; error: unknown }>) {
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    or: vi.fn(),
    range: vi.fn(),
    limit: vi.fn(),
  };
  for (const m of [q.select, q.eq, q.gte, q.lt, q.order, q.or])
    m.mockReturnValue(q);
  q.range.mockImplementation(async () => pages.shift());
  q.limit.mockImplementation(async () => pages.shift());
  mocks.from.mockReturnValue(q);
  return q;
}
beforeEach(() => vi.clearAllMocks());
describe("consulta privada y paginada de UTM", () => {
  it("recorre más de mil pedidos dentro de una tienda y período sin leer clientes", async () => {
    const q = query([
      { data: Array(1000).fill({ ad_origin: null }), error: null },
      { data: [{ ad_origin: { utm_source: "tiktok" } }], error: null },
    ]);
    expect(await listMarketingOrigins(2, "from", "to")).toHaveLength(1001);
    expect(q.eq).toHaveBeenCalledWith("store_id", 2);
    expect(q.gte).toHaveBeenCalledWith("payload->>created_at", "from");
    expect(q.lt).toHaveBeenCalledWith("payload->>created_at", "to");
    expect(q.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(q.select.mock.calls[0][0]).not.toMatch(
      /phone|customer|email|address|^\*$/,
    );
  });
  it("rechaza resultados parciales cuando falla una página", async () => {
    query([{ data: null, error: { message: "private" } }]);
    await expect(listMarketingOrigins(1, "from", "to")).rejects.toThrow(
      "No se pudieron consultar",
    );
  });
  it("no mezcla pedidos de referencia ambigua al abrir la ficha", async () => {
    const q = query([
      {
        data: [
          { ad_origin: { utm_source: "facebook" } },
          { ad_origin: { utm_source: "tiktok" } },
        ],
        error: null,
      },
    ]);
    expect(await orderMarketingOrigin(1, "IC-W638")).toBeNull();
    expect(q.eq).toHaveBeenCalledWith("store_id", 1);
    expect(q.limit).toHaveBeenCalledWith(2);
    mocks.from.mockClear();
    expect(await orderMarketingOrigin(1, "' arbitrary")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
