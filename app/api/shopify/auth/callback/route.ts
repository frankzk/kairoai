import { NextRequest } from "next/server";

import { getStoreConfig, normalizeFinanceStoreCode } from "@/lib/stores";

// Shopify redirects here after merchant approves the app.
// This exchanges the code for a permanent access token and displays it once.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const shop = searchParams.get("shop") ?? process.env.SHOPIFY_SHOP_DOMAIN ?? "";
  const store = getStoreConfig(getStoreCodeFromOAuthState(searchParams.get("state")));
  const tokenEnv = store.accessTokenEnv;

  if (!code) {
    return textResponse("Error: no se recibio el codigo de autorizacion.", 400);
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    return textResponse(
      [
        "Faltan variables para completar OAuth de Shopify.",
        "",
        `SHOPIFY_SHOP_DOMAIN: ${shop ? "ok" : "faltante"}`,
        `SHOPIFY_CLIENT_ID: ${clientId ? "ok" : "faltante"}`,
        `SHOPIFY_CLIENT_SECRET: ${clientSecret ? "ok" : "faltante"}`,
      ].join("\n"),
      500
    );
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return textResponse(
      [
        `Error al obtener token de Shopify (${tokenRes.status}).`,
        "",
        "Revisa que SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET correspondan a la misma app que autorizaste.",
        "Si agregaste nuevos scopes, reautoriza la app desde /api/shopify/auth.",
        "",
        err.slice(0, 1200),
      ].join("\n"),
      500
    );
  }

  const { access_token, scope } = await tokenRes.json();
  const hasReadAllOrders = String(scope ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes("read_all_orders");

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Token de Shopify obtenido</title>
  <style>
    body { font-family: monospace; background: #0a0a0a; color: #e5e5e5; padding: 40px; max-width: 760px; margin: auto; }
    h1 { color: #7c3aed; }
    .box { background: #1a1a1a; border: 1px solid #333; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .token { color: #4ade80; font-size: 14px; word-break: break-all; }
    .label { color: #888; font-size: 12px; margin-bottom: 8px; }
    .step { margin: 12px 0; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; }
    .warn { color: #facc15; }
  </style>
</head>
<body>
  <h1>Token obtenido exitosamente</h1>
  <div class="box">
    <div class="label">${escapeHtml(tokenEnv)}</div>
    <div class="token">${escapeHtml(access_token)}</div>
  </div>
  <div class="box">
    <div class="label">Scopes autorizados</div>
    <div>${escapeHtml(scope ?? "")}</div>
    ${
      hasReadAllOrders
        ? ""
        : '<p class="warn">Advertencia: este token no incluye read_all_orders.</p>'
    }
  </div>
  <h2>Proximos pasos</h2>
  <div class="step">1. Copia el token de arriba.</div>
  <div class="step">2. Ve a <code>Vercel -> kairoai -> Settings -> Environment Variables</code>.</div>
  <div class="step">3. Actualiza <code>${escapeHtml(tokenEnv)}</code> con ese valor.</div>
  <div class="step">4. Haz redeploy sin cache.</div>
  <div class="step">5. Guarda el token en un lugar seguro. Shopify no lo vuelve a mostrar.</div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function getStoreCodeFromOAuthState(state: string | null) {
  return normalizeFinanceStoreCode(state?.split(":")[0]);
}

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
