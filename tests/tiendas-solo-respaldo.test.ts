// Tiendas de solo respaldo (las Kenku) y los permisos que se le piden a la app
// de Shopify de cada tienda.
//
// POR QUE ESTE TEST EXISTE: las Kenku se respaldan antes del cierre de Shopify
// (28/10/2026) pero NO son tiendas de Kairo todavia: si se colaran en
// FINANCE_STORES aparecerian en Gestion, Leads y Novedades en colones y con hora
// de Costa Rica. Y su app de Shopify solo tiene que leer.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FINANCE_STORES } from "../lib/store-config";
import { esSoloRespaldo, getStoreConfig, tiendaShopifyPorCodigo, tiendasARespaldar, TIENDAS_SOLO_RESPALDO } from "../lib/stores";
import { SCOPES_RESPALDO, scopesParaTienda } from "../lib/shopify-scopes";

describe("tiendas de solo respaldo", () => {
  it("se respaldan, pero no son tiendas de Kairo", () => {
    expect(TIENDAS_SOLO_RESPALDO.map((t) => t.code)).toEqual(["kenku-mx", "kenku-ar", "kenku-it"]);
    const deKairo = new Set(FINANCE_STORES.map((s) => s.code as string));
    expect(TIENDAS_SOLO_RESPALDO.some((t) => deKairo.has(t.code))).toBe(false);
    expect(tiendasARespaldar().map((t) => t.code)).toEqual(["mireva-cr", "mireva-hn", "kenku-mx", "kenku-ar", "kenku-it"]);
    expect(esSoloRespaldo({ code: "kenku-it" })).toBe(true);
    expect(esSoloRespaldo({ code: "mireva-cr" })).toBe(false);
  });

  it("cada una con sus propias variables y un id que no choca", () => {
    const ids = tiendasARespaldar().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tiendaShopifyPorCodigo("kenku-mx")).toMatchObject({
      id: 3,
      shopDomainEnv: "SHOPIFY_KENKU_MX_SHOP_DOMAIN",
      accessTokenEnv: "SHOPIFY_KENKU_MX_ACCESS_TOKEN",
      clientIdEnv: "SHOPIFY_KENKU_MX_CLIENT_ID",
      clientSecretEnv: "SHOPIFY_KENKU_MX_CLIENT_SECRET",
    });
    expect(tiendaShopifyPorCodigo(" KENKU-AR ")?.id).toBe(4);
    expect(tiendaShopifyPorCodigo("mireva-hn")?.accessTokenEnv).toBe("SHOPIFY_HN_ACCESS_TOKEN");
    expect(tiendaShopifyPorCodigo("kenku-pe")).toBeNull();
    expect(tiendaShopifyPorCodigo(undefined)).toBeNull();
  });

  it("la base tiene la misma tienda con el mismo id, apagada (migración 0052)", () => {
    const sql = readFileSync("supabase/migrations/0052_shopify_archivo_todo.sql", "utf8");
    for (const t of TIENDAS_SOLO_RESPALDO) {
      expect(sql).toMatch(new RegExp(`\\(${t.id}, '${t.code}', '${t.label}',[^)]*, false, '\\{"solo_respaldo": true\\}'\\)`));
    }
  });
});

describe("permisos de la app de Shopify", () => {
  it("reautoriza México con los tres permisos publicados sin pedirlos a otras tiendas", () => {
    const extra = ["read_discounts", "read_markets", "read_locales"];
    const mexico = scopesParaTienda({ code: "kenku-mx" });
    expect(mexico).toEqual(expect.arrayContaining(extra));
    expect(mexico).not.toContain("read_returns");
    expect(new Set(mexico).size).toBe(mexico.length);
    for (const code of ["kenku-ar", "kenku-it", "mireva-cr", "mireva-hn"] as const) {
      expect(scopesParaTienda({ code }).filter(scope => extra.includes(scope))).toEqual([]);
    }
  });

  it("las de solo respaldo solo leen, con todos los pedidos y todo el respaldo", () => {
    const scopes = scopesParaTienda({ code: "kenku-mx" });
    expect(scopes.filter((s) => !s.startsWith("read_"))).toEqual([]);
    expect(scopes).toEqual(expect.arrayContaining(["read_orders", "read_all_orders", "read_customers", "read_checkouts", ...SCOPES_RESPALDO]));
  });

  it("las de Kairo siguen escribiendo pedidos y borradores, y piden lo del respaldo", () => {
    const scopes = scopesParaTienda(getStoreConfig("mireva-cr"));
    expect(scopes).toEqual(
      expect.arrayContaining(["write_orders", "write_draft_orders", "read_all_orders", "read_fulfillments", ...SCOPES_RESPALDO])
    );
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});
