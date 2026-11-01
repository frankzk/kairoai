import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ queries: [] as Array<Array<[string, unknown]>>, rows: [] as Array<{ icomfly_order_id: string }[]>, read: vi.fn() }));
vi.mock("@/lib/icomfly", () => ({ getIcomflyOrder: mocks.read }));
vi.mock("@/lib/db", () => ({ getDB: () => ({ from: () => {
  const filters: Array<[string, unknown]> = []; mocks.queries.push(filters);
  const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; }, limit: () => chain,
    then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: mocks.rows.shift() ?? [], error: null }).then(resolve) };
  return chain;
} }) }));
import { resolveUpsellOriginal } from "../lib/order-upsell-db";
beforeEach(() => { mocks.queries.length = 0; mocks.rows.length = 0; mocks.read.mockReset(); });

describe("referencias originales de Icomfly", () => {
  it("encuentra un número largo con # conservando cada dígito como texto", async () => {
    const number = "1793491500244484348";
    mocks.rows.push([], [], [{ icomfly_order_id: "821191" }]);
    mocks.read.mockResolvedValue({ id: 821191, order_number: `#${number}` });
    expect((await resolveUpsellOriginal(1, "mireva-cr", `IC-${number}`)).id).toBe(821191);
    expect(mocks.queries.flat()).toContainEqual(["payload->>order_number", `#${number}`]);
    expect(mocks.read).toHaveBeenCalledWith("mireva-cr", "821191");
  });
  it("sigue encontrando números simples como IC-74456", async () => {
    mocks.rows.push([], [{ icomfly_order_id: "821719" }], []);
    mocks.read.mockResolvedValue({ id: 821719, order_number: "74456" });
    expect((await resolveUpsellOriginal(1, "mireva-cr", "IC-74456")).id).toBe(821719);
  });
  it("rechaza una colisión entre números distintos en vez de escoger un pedido al azar", async () => {
    mocks.rows.push([{ icomfly_order_id: "74456" }], [{ icomfly_order_id: "821719" }], []);
    await expect(resolveUpsellOriginal(1, "mireva-cr", "IC-74456")).rejects.toThrow(/único pedido/);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
