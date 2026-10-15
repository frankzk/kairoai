import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchShopifyPage, isShopifyAdminUrl } from "../lib/shopify-sync";
import type { FinanceStoreConfig } from "../lib/stores";

// Regresion de seguridad: el cron publico /api/cron/shopify-refresh tomaba
// ?next_url de la query y fetchShopifyPage le mandaba el header
// X-Shopify-Access-Token a esa URL, fuera cual fuera el dominio. Con una sola
// peticion cualquiera se llevaba el token de administrador de la tienda.
const store = {
  id: 1,
  code: "mireva-cr",
  label: "Tienda de prueba",
  shortLabel: "Prueba",
  countryCode: "CR",
  currency: "CRC",
  locale: "es-CR",
  logisticsProvider: "moovin",
  shopDomainEnv: "TEST_GUARD_SHOP",
  accessTokenEnv: "TEST_GUARD_TOKEN",
  clientIdEnv: "TEST_GUARD_CLIENT_ID",
  clientSecretEnv: "TEST_GUARD_CLIENT_SECRET",
} as unknown as FinanceStoreConfig;

const TIENDA = "https://mireva-cr.myshopify.com/admin/api/2024-01/orders.json";

beforeEach(() => {
  process.env.TEST_GUARD_SHOP = "mireva-cr.myshopify.com";
  process.env.TEST_GUARD_TOKEN = "shpat_secreto";
});

afterEach(() => {
  delete process.env.TEST_GUARD_SHOP;
  delete process.env.TEST_GUARD_TOKEN;
  vi.restoreAllMocks();
});

describe("isShopifyAdminUrl", () => {
  it("acepta las URLs que arma el servidor y el cursor de paginacion de Shopify", () => {
    expect(isShopifyAdminUrl(`${TIENDA}?status=any&limit=250`, store)).toBe(true);
    expect(isShopifyAdminUrl(`${TIENDA}?limit=250&page_info=eyJsYXN0X2lkIjoxfQ`, store)).toBe(true);
  });

  it("rechaza cualquier otro dominio, incluida otra tienda de Shopify", () => {
    expect(isShopifyAdminUrl("https://atacante.example/admin/api/2024-01/orders.json", store)).toBe(false);
    expect(isShopifyAdminUrl("https://otra-tienda.myshopify.com/admin/api/2024-01/orders.json", store)).toBe(false);
  });

  it("no se deja enganar con credenciales en la URL ni con dominios parecidos", () => {
    expect(isShopifyAdminUrl("https://mireva-cr.myshopify.com@atacante.example/admin/api/", store)).toBe(false);
    expect(isShopifyAdminUrl("https://mireva-cr.myshopify.com.atacante.example/admin/api/", store)).toBe(false);
  });

  it("exige https y la ruta del Admin API", () => {
    expect(isShopifyAdminUrl("http://mireva-cr.myshopify.com/admin/api/2024-01/orders.json", store)).toBe(false);
    expect(isShopifyAdminUrl("https://mireva-cr.myshopify.com/pages/contacto", store)).toBe(false);
  });

  it("rechaza lo que no es una URL", () => {
    expect(isShopifyAdminUrl("", store)).toBe(false);
    expect(isShopifyAdminUrl("no es una url", store)).toBe(false);
  });
});

describe("fetchShopifyPage", () => {
  it("con una URL ajena no hace la llamada: el token nunca sale del servidor", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await expect(fetchShopifyPage("https://atacante.example/robar", store)).rejects.toThrow(/token de Shopify/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("con la URL de la tienda si llama, y con el token", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await fetchShopifyPage(`${TIENDA}?status=any`, store);
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "X-Shopify-Access-Token": "shpat_secreto" });
  });
});
