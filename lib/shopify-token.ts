// Token del Admin API de una tienda de Shopify.
//
// Primero el token guardado en Vercel (SHOPIFY_*_ACCESS_TOKEN), como siempre.
// Si no hay, y la app tiene client id y secret, se pide con el client
// credentials grant: Shopify lo da sin pasar por /api/shopify/auth cuando la
// app y la tienda son de la misma organizacion del Dev Dashboard (las apps de
// las Kenku, creadas en octubre de 2026). Ese token dura 24 h: se guarda en
// memoria y se pide otro antes de que venza.

import { getShopifyCredentials, getShopifyOAuthCredentials, type TiendaShopify } from "@/lib/stores";

// Se renueva 10 minutos antes de que venza.
const MARGEN_MS = 10 * 60_000;
const cache = new Map<string, { token: string; vence: number }>();

export interface TokenShopify {
  token: string;
  origen: "vercel" | "client_credentials";
}

export async function tokenShopify(
  store: TiendaShopify,
  ahora: number = Date.now(),
  pedir: typeof fetch = fetch
): Promise<{ ok: true; valor: TokenShopify } | { ok: false; error: string }> {
  const { shop, token, missing } = getShopifyCredentials(store);
  if (!shop) return { ok: false, error: `Faltan ${missing.join(" y ")}` };
  if (token) return { ok: true, valor: { token, origen: "vercel" } };

  // El API solo responde en el dominio interno: kenku.com.mx sigue siendo la
  // web, pero aca va kenku-xxxx.myshopify.com.
  if (!/\.myshopify\.com$/i.test(shop.trim())) {
    return { ok: false, error: `${store.shopDomainEnv} tiene que ser el dominio .myshopify.com de la tienda, no ${shop}` };
  }
  const { clientId, clientSecret } = getShopifyOAuthCredentials(store);
  if (!clientId || !clientSecret) {
    return { ok: false, error: `Faltan ${store.accessTokenEnv} (o ${store.clientIdEnv} y ${store.clientSecretEnv})` };
  }
  const clave = `${shop}:${clientId}`;
  const guardado = cache.get(clave);
  if (guardado && guardado.vence - MARGEN_MS > ahora) return { ok: true, valor: { token: guardado.token, origen: "client_credentials" } };

  const res = await pedir(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const texto = (await res.text().catch(() => "")).slice(0, 200);
    // shop_not_permitted: la app no es de la misma organizacion que la tienda.
    // Entonces el token sale de /api/shopify/auth?store=<codigo>.
    return { ok: false, error: `Shopify ${res.status} al pedir el token de ${store.label}: ${texto}` };
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return { ok: false, error: `Shopify no devolvio token para ${store.label}` };
  cache.set(clave, { token: data.access_token, vence: ahora + Number(data.expires_in ?? 0) * 1000 });
  return { ok: true, valor: { token: data.access_token, origen: "client_credentials" } };
}

/** Solo para tests. */
export function olvidarTokens(): void {
  cache.clear();
}
