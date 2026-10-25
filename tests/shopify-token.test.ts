// Token del Admin API: el de Vercel o, sin el, el de la app (client credentials).
//
// POR QUE ESTE TEST EXISTE: las apps de las Kenku (Dev Dashboard, octubre 2026)
// dan el token sin pasar por /api/shopify/auth. Si se pidiera uno nuevo en
// cada pagina del respaldo, o se siguiera usando uno vencido (duran 24 h), el
// respaldo se frenaria a dias del cierre de Shopify (28/10/2026).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { olvidarTokens, tokenShopify } from "../lib/shopify-token";

const TIENDA = {
  id: 3,
  code: "kenku-mx",
  label: "Kenku México",
  shopDomainEnv: "K_SHOP",
  accessTokenEnv: "K_TOKEN",
  clientIdEnv: "K_ID",
  clientSecretEnv: "K_SECRET",
};

const respuestaToken = (token: string) =>
  vi.fn(async () => new Response(JSON.stringify({ access_token: token, scope: "read_orders", expires_in: 86399 }), { status: 200 }));

beforeEach(() => {
  olvidarTokens();
  for (const k of ["K_SHOP", "K_TOKEN", "K_ID", "K_SECRET"]) delete process.env[k];
  process.env.K_SHOP = "kenku-mx.myshopify.com";
});

describe("token de la tienda", () => {
  it("el de Vercel manda: no pide nada a Shopify", async () => {
    process.env.K_TOKEN = "shpat_vercel";
    process.env.K_ID = "id";
    process.env.K_SECRET = "secreto";
    const pedir = respuestaToken("otro");
    expect(await tokenShopify(TIENDA, Date.now(), pedir)).toEqual({ ok: true, valor: { token: "shpat_vercel", origen: "vercel" } });
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin token, lo pide con la app y lo reusa hasta 10 minutos antes de que venza", async () => {
    process.env.K_ID = "id";
    process.env.K_SECRET = "secreto";
    const t0 = Date.parse("2026-10-25T12:00:00Z");
    const pedir = respuestaToken("shpat_app");
    const r = await tokenShopify(TIENDA, t0, pedir);
    expect(r).toEqual({ ok: true, valor: { token: "shpat_app", origen: "client_credentials" } });
    const [url, init] = pedir.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://kenku-mx.myshopify.com/admin/oauth/access_token");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "client_credentials",
      client_id: "id",
      client_secret: "secreto",
    });
    await tokenShopify(TIENDA, t0 + 23 * 3600_000, pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    await tokenShopify(TIENDA, t0 + 23 * 3600_000 + 55 * 60_000, pedir);
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("si Shopify no lo da (otra organización), dice por qué", async () => {
    process.env.K_ID = "id";
    process.env.K_SECRET = "secreto";
    const pedir = vi.fn(async () => new Response("Oauth error shop_not_permitted", { status: 400 }));
    const r = await tokenShopify(TIENDA, Date.now(), pedir);
    expect(r).toEqual({ ok: false, error: "Shopify 400 al pedir el token de Kenku México: Oauth error shop_not_permitted" });
  });

  it("con el dominio de la web en vez del interno, lo dice y no pide nada", async () => {
    process.env.K_SHOP = "kenku.com.mx";
    process.env.K_ID = "id";
    process.env.K_SECRET = "secreto";
    const pedir = respuestaToken("x");
    expect(await tokenShopify(TIENDA, Date.now(), pedir)).toEqual({
      ok: false,
      error: "K_SHOP tiene que ser el dominio .myshopify.com de la tienda, no kenku.com.mx",
    });
    expect(pedir).not.toHaveBeenCalled();
  });

  it("sin nada configurado, dice qué falta", async () => {
    expect(await tokenShopify(TIENDA)).toEqual({ ok: false, error: "Faltan K_TOKEN (o K_ID y K_SECRET)" });
    delete process.env.K_SHOP;
    expect(await tokenShopify(TIENDA)).toEqual({ ok: false, error: "Faltan K_SHOP y K_TOKEN" });
  });
});
