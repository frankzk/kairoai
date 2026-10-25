import { NextRequest, NextResponse } from "next/server";

import { getShopifyOAuthCredentials, tiendaShopifyPorCodigo } from "@/lib/stores";
import { scopesParaTienda } from "@/lib/shopify-scopes";

// One-time OAuth flow to obtain a permanent Shopify access token.
// Visit:
// - Costa Rica: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-cr
// - Honduras: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-hn
// - Solo respaldo: ?store=kenku-mx, kenku-ar o kenku-it (lib/stores.ts)
export async function GET(req: NextRequest) {
  const store = tiendaShopifyPorCodigo(req.nextUrl.searchParams.get("store"));
  if (!store) {
    return new NextResponse("store requerido: usa mireva-cr, mireva-hn, kenku-mx, kenku-ar o kenku-it.", { status: 400 });
  }
  const { clientId, missing: missingOAuth } = getShopifyOAuthCredentials(store);
  const shop =
    process.env[store.shopDomainEnv] ||
    (store.legacyShopDomainEnv ? process.env[store.legacyShopDomainEnv] : "");
  const missing = [...missingOAuth];
  if (!shop) missing.push(store.shopDomainEnv);

  if (missing.length > 0) {
    return new NextResponse(
      `Faltan variables para ${store.label}: ${missing.join(", ")} deben estar en Vercel.`,
      { status: 500 }
    );
  }

  const scopes = scopesParaTienda(store).join(",");

  const redirectUri = `https://kairoai-pearl.vercel.app/api/shopify/auth/callback`;
  const state = `${store.code}:${Math.random().toString(36).slice(2)}`;

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authUrl);
}
