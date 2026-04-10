import { NextRequest } from "next/server";

// Shopify redirects here after merchant approves the app.
// This exchanges the code for a permanent access token and displays it.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const shop = searchParams.get("shop") ?? process.env.SHOPIFY_SHOP_DOMAIN ?? "";

  if (!code) {
    return new Response("Error: no se recibió el código de autorización.", { status: 400 });
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(`Error al obtener token: ${err}`, { status: 500 });
  }

  const { access_token, scope } = await tokenRes.json();

  // Show the token so the user can copy it to Vercel
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Token de Shopify obtenido</title>
  <style>
    body { font-family: monospace; background: #0a0a0a; color: #e5e5e5; padding: 40px; max-width: 700px; margin: auto; }
    h1 { color: #7c3aed; }
    .box { background: #1a1a1a; border: 1px solid #333; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .token { color: #4ade80; font-size: 14px; word-break: break-all; }
    .label { color: #888; font-size: 12px; margin-bottom: 8px; }
    .step { margin: 12px 0; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>✓ Token obtenido exitosamente</h1>
  <div class="box">
    <div class="label">SHOPIFY_ACCESS_TOKEN (copiá este valor):</div>
    <div class="token">${access_token}</div>
  </div>
  <div class="box">
    <div class="label">Scopes autorizados:</div>
    <div>${scope}</div>
  </div>
  <h2>Próximos pasos:</h2>
  <div class="step">1. Copiá el token de arriba.</div>
  <div class="step">2. Ir a <code>vercel.com → tu proyecto → Settings → Environment Variables</code></div>
  <div class="step">3. Agregá <code>SHOPIFY_ACCESS_TOKEN</code> con ese valor.</div>
  <div class="step">4. Hacé Redeploy (sin cache).</div>
  <div class="step">5. Guardá el token en un lugar seguro — Shopify no lo vuelve a mostrar.</div>
  <p style="color:#888;font-size:12px;margin-top:30px;">Esta página solo se muestra una vez. Una vez que guardaste el token en Vercel, ya no necesitás visitar esta URL.</p>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}
