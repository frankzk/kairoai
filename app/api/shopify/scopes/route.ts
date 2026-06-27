import { NextRequest, NextResponse } from "next/server";

import { FINANCE_STORES, getShopifyCredentials, getStoreConfig } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 30;

// Scopes de fulfillment imprescindibles para capturar guias/tracking de pedidos
// despachados por apps/3PL (bot, Boxful). Sin estos, order.fulfillments vuelve
// vacio aunque Shopify marque el pedido como "fulfilled" y la guia nunca se
// persiste.
const FULFILLMENT_SCOPES = [
  "read_fulfillments",
  "read_merchant_managed_fulfillment_orders",
  "read_assigned_fulfillment_orders",
  "read_third_party_fulfillment_orders",
];

// Diagnostico: le pregunta a Shopify que scopes tiene REALMENTE el token de cada
// tienda (GET /admin/oauth/access_scopes.json). Sirve para confirmar, sin
// adivinar, si un token recien re-autorizado ya trae los scopes de fulfillment
// antes de correr un sync/refresh.
// Visitar:
// - Una tienda: https://kairoai-pearl.vercel.app/api/shopify/scopes?store=mireva-hn
// - Todas:      https://kairoai-pearl.vercel.app/api/shopify/scopes
export async function GET(req: NextRequest) {
  const storeFilter = req.nextUrl.searchParams.get("store");
  const targets = storeFilter
    ? FINANCE_STORES.filter((store) => store.code === storeFilter)
    : FINANCE_STORES;

  if (targets.length === 0) {
    return NextResponse.json(
      { error: "store invalido: usa mireva-cr o mireva-hn (u omitilo para revisar todas)" },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    targets.map(async (publicStore) => {
      const store = getStoreConfig(publicStore.code);
      const { shop, token, missing } = getShopifyCredentials(store);
      if (!shop || !token) {
        return {
          store: store.code,
          ok: false as const,
          error: `Faltan variables en Vercel: ${missing.join(", ")}.`,
        };
      }
      try {
        const res = await fetch(`https://${shop}/admin/oauth/access_scopes.json`, {
          headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text();
          return {
            store: store.code,
            ok: false as const,
            shop,
            error: `Shopify ${res.status}: ${text.slice(0, 200)}`,
          };
        }
        const data = await res.json();
        const granted = ((data.access_scopes as Array<{ handle?: string }>) ?? [])
          .map((scope) => String(scope.handle ?? ""))
          .filter(Boolean);
        const missingFulfillment = FULFILLMENT_SCOPES.filter((scope) => !granted.includes(scope));
        return {
          store: store.code,
          ok: true as const,
          shop,
          has_fulfillment_scopes: missingFulfillment.length === 0,
          missing_fulfillment_scopes: missingFulfillment,
          granted_scopes: granted.sort(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error consultando scopes";
        return { store: store.code, ok: false as const, shop, error: message };
      }
    })
  );

  return NextResponse.json({ ok: true, results });
}
