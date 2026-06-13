import { NextRequest, NextResponse } from "next/server";

import { getShopifyOAuthCredentials, getStoreConfig } from "@/lib/stores";

// One-time OAuth flow to obtain a permanent Shopify access token.
// Visit:
// - Costa Rica: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-cr
// - Honduras: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-hn
export async function GET(req: NextRequest) {
  const store = getStoreConfig(req.nextUrl.searchParams.get("store"));
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
