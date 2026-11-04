import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIcomflyOrder } from "../lib/icomfly";

const fetchMock = vi.fn();
const lines = [{ product_id: 8207, quantity: 1, product_price: 19900, variant_id: 1, variant_name: "Talla única" }];
const original = { id: 821719, store_id: 71, order_number: "74456", status: "Confirmada", total: 19900 };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
beforeEach(() => { vi.stubEnv("ICOMFLY_CR_TOKEN", "test-only-token"); vi.stubEnv("ICOMFLY_CR_STORE_ID", "71"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("leer las líneas reales del pedido desde Icomfly", () => {
  it("conserva la lectura directa si ya incluye sus líneas", async () => {
    fetchMock.mockResolvedValueOnce(response({ data: { ...original, items: lines } }));
    expect((await getIcomflyOrder("mireva-cr", "821719")).items).toEqual(lines);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("recupera del listado en vivo las líneas que omite el detalle de IC-74456", async () => {
    fetchMock.mockResolvedValueOnce(response({ data: original }));
    fetchMock.mockResolvedValueOnce(response({ data: [{ ...original, items: lines }] }));
    const result = await getIcomflyOrder("mireva-cr", "821719");
    expect(result.items).toEqual(lines);
    expect(result.status).toBe("Confirmada");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/orders?store_id=71&withAttribution=1&withAdOrigin=1&page=1&limit=100");
  });
  it("preserva todas las líneas de un carrito, incluso cuando la primera página no contiene el pedido", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...original, items: [] }));
    fetchMock.mockResolvedValueOnce(response({ data: Array.from({ length: 100 }, (_, id) => ({ id, store_id: 71 })) }));
    const cart = [...lines, { product_id: 3188, quantity: 2, product_price: 10000, variant_id: 3 }];
    fetchMock.mockResolvedValueOnce(response({ data: [{ ...original, items: cart }] }));
    expect((await getIcomflyOrder("mireva-cr", "821719")).items).toEqual(cart);
    expect(String(fetchMock.mock.calls[2][0])).toContain("page=2");
  });
  it("no mezcla el producto de otra tienda ni inventa una línea a partir de la cabecera", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...original, product_id: 8207, quantity: 3, product_price: 19900 }));
    fetchMock.mockResolvedValueOnce(response({ data: [{ ...original, store_id: 99, items: lines }] }));
    await expect(getIcomflyOrder("mireva-cr", "821719")).rejects.toThrow(/líneas completas/);
  });
  it("rechaza otra tienda antes de consultar el listado", async () => {
    fetchMock.mockResolvedValueOnce(response({ ...original, store_id: 99 }));
    await expect(getIcomflyOrder("mireva-cr", "821719")).rejects.toThrow(/esta tienda/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
