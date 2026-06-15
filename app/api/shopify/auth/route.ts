import { NextRequest, NextResponse } from "next/server";

import { getRequiredStoreConfig, getShopifyOAuthCredentials } from "@/lib/stores";

// One-time OAuth flow to obtain a permanent Shopify access token.
// Visit:
// - Costa Rica: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-cr
// - Honduras: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-hn
export async function GET(req: NextRequest) {
  const store = getRequiredStoreConfig(req.nextUrl.searchParams.get("store"));
  if (!store) {
    return new NextResponse("store requerido: usa mireva-cr o mireva-hn.", { status: 400 });
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

  const scopes = [
    "read_products",
    "read_orders",
    "read_all_orders",
    "write_orders",
    "read_draft_orders",
    "write_draft_orders",
    "read_customers",
    "read_checkouts",
    // Fulfillments/tracking: sin estos scopes, order.fulfillments vuelve vacio
    // para pedidos despachados por apps/3PL (bot, Boxful) y NO se captura la guia
    // aunque Shopify marque el pedido como "fulfilled".
    "read_fulfillments",
    "read_merchant_managed_fulfillment_orders",
    "read_assigned_fulfillment_orders",
    "read_third_party_fulfillment_orders",
  ].join(",");

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
