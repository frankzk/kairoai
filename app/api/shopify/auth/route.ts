import { NextResponse } from "next/server";

// One-time OAuth flow to obtain a permanent Shopify access token.
// Visit: https://kairoai-pearl.vercel.app/api/shopify/auth
export async function GET() {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const shop = process.env.SHOPIFY_SHOP_DOMAIN;

  if (!clientId || !shop) {
    return new NextResponse(
      "Faltan variables: SHOPIFY_CLIENT_ID y SHOPIFY_SHOP_DOMAIN deben estar en Vercel.",
      { status: 500 }
    );
  }

  const scopes = [
    "read_products",
    "read_orders",
    "write_orders",
    "read_draft_orders",
    "write_draft_orders",
    "read_customers",
    "read_checkouts",
  ].join(",");

  const redirectUri = `https://kairoai-pearl.vercel.app/api/shopify/auth/callback`;
  const state = Math.random().toString(36).slice(2);

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return NextResponse.redirect(authUrl);
}
