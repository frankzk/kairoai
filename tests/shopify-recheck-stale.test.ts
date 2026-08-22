import { afterEach, describe, expect, it } from "vitest";
import { buildByIdsUrl } from "../lib/shopify-sync";
import { getStoreConfig } from "../lib/stores";

const store = getStoreConfig("mireva-cr");

afterEach(() => {
  delete process.env[store.shopDomainEnv];
  delete process.env[store.accessTokenEnv];
});

describe("buildByIdsUrl (re-chequeo por id contra Shopify)", () => {
  it("arma la URL con status=any e ids exactos, sin ventana de tiempo", () => {
    process.env[store.shopDomainEnv] = "mireva-cr.myshopify.com";
    process.env[store.accessTokenEnv] = "shpat_test";

    const url = buildByIdsUrl(["111", "222", "333"], store);
    const parsed = new URL(url);
    const params = parsed.searchParams;

    expect(parsed.host).toBe("mireva-cr.myshopify.com");
    expect(parsed.pathname).toBe("/admin/api/2024-01/orders.json");
    // status=any es lo unico que trae anulados/cerrados (el fix): sin esto un
    // pedido ya anulado en Shopify no volveria en la respuesta.
    expect(params.get("status")).toBe("any");
    expect(params.get("ids")).toBe("111,222,333");
    expect(params.get("limit")).toBe("250");
    // Sin filtro por updated_at: el objetivo es descongelar justo los que la
    // ventana incremental nunca vuelve a mirar.
    expect(params.get("updated_at_min")).toBeNull();
    expect(params.get("created_at_min")).toBeNull();
    // Trae cancelled_at para poder marcar Anulado.
    expect(params.get("fields")).toContain("cancelled_at");
  });

  it("falla claro si faltan credenciales de la tienda", () => {
    expect(() => buildByIdsUrl(["1"], store)).toThrow(/no configurado/);
  });
});
