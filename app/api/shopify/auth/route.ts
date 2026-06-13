import { NextRequest, NextResponse } from "next/server";

import { getStoreConfig } from "@/lib/stores";

// One-time OAuth flow to obtain a permanent Shopify access token.
// Visit:
// - Costa Rica: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-cr
// - Honduras: https://kairoai-pearl.vercel.app/api/shopify/auth?store=mireva-hn
export async function GET(req: NextRequest) {
  const store = getStoreConfig(req.nextUrl.searchParams.get("store"));
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const shop =
    process.env[store.shopDomainEnv] ||
    (store.legacyShopDomainEnv ? process.env[store.legacyShopDomainEnv] : "");

  if (!clientId || !shop) {
    return new NextResponse(
      `Faltan variables: SHOPIFY_CLIENT_ID y ${store.shopDomainEnv} deben estar en Vercel.`,
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
