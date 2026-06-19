#!/usr/bin/env node
// scripts/icomfly-probe.mjs
// Sonda READ-ONLY de la API de iComfly. Determina si un pedido expone
//   (a) quién CONFIRMA el pedido, y (b) qué USUARIO genera la guía de transporte.
// Privacidad: imprime SOLO nombres de campo + tipo (valores enmascarados).
// El token/credenciales se leen de variables de entorno y NUNCA se imprimen.
//
// Preferido (token de API de solo lectura, panel "Conecta tu API"):
//   ICOMFLY_TOKEN='ik_live_xxx' node scripts/icomfly-probe.mjs
// Alternativa (login con email/contraseña):
//   ICOMFLY_EMAIL='tu@correo.com' ICOMFLY_PASSWORD='secreto' node scripts/icomfly-probe.mjs
// Opcional: ICOMFLY_STORE_ID (default 71), ICOMFLY_BASE

const BASE = (process.env.ICOMFLY_BASE || 'https://api.icomfly.com/api').replace(/\/+$/, '');
const TOKEN_ENV = process.env.ICOMFLY_TOKEN;
const EMAIL = process.env.ICOMFLY_EMAIL;
const PASSWORD = process.env.ICOMFLY_PASSWORD;
const STORE_ID = process.env.ICOMFLY_STORE_ID || '71';

if (!TOKEN_ENV && (!EMAIL || !PASSWORD)) {
  console.error('Define ICOMFLY_TOKEN (preferido) o ICOMFLY_EMAIL + ICOMFLY_PASSWORD.');
  process.exit(1);
}

const ACCEPT = { Accept: 'application/json' };

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? `array[${v.length}]` : typeof v);

function keyPaths(obj, prefix = '', out = [], depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return out;
  const entries = Array.isArray(obj) ? (obj.length ? [['0', obj[0]]] : []) : Object.entries(obj);
  for (const [k, v] of entries) {
    const path = prefix ? `${prefix}.${k}` : String(k);
    out.push({ path, type: typeOf(v) });
    if (v && typeof v === 'object') keyPaths(v, path, out, depth + 1);
  }
  return out;
}

const print = (paths) => paths.map((k) => `  ${k.path}: ${k.type}`).join('\n');

const INTEREST = [
  'confirm', 'approv', 'valid', 'accept', 'user', 'agent', 'seller', 'operator', 'staff',
  'admin', 'employee', '_by', 'createdby', 'generatedby', 'guia', 'guía', 'guide',
  'track', 'carrier', 'courier', 'ship', 'transport', 'waybill', 'label', 'status', 'history',
  'event', 'timeline', 'log',
];

function reportMatches(label, paths) {
  const hits = paths.filter(({ path }) => INTEREST.some((w) => path.toLowerCase().includes(w)));
  console.log(`\n[${label}] >>> llaves relacionadas con confirmador / generador de guía / envío:`);
  console.log(hits.length ? print(hits) : '  (ninguna)');
}

// ---- Veredicto heurístico (basado SOLO en nombres de campo) -----------------
const ATTR = /(_by\b|by$|user|agent|operator|staff|seller|admin|employee|created|generated|name|id)/;

function classify(allPaths) {
  const match = (re) => allPaths.map((p) => p.path).filter((p) => re.test(p.toLowerCase()));
  const confirmAll = match(/(confirm|approv|accept|validat)/);
  const confirmWho = confirmAll.filter((p) => ATTR.test(p.toLowerCase()) && !/_at$|date|time/.test(p.toLowerCase()));
  const guideAll = match(/(gu[ií]a|guide|waybill|label|tracking|courier|carrier|shipment|transport|sticker)/);
  const guideWho = guideAll.filter((p) => /(_by\b|by$|user|agent|operator|staff|created|generated)/.test(p.toLowerCase()));
  return { confirmAll, confirmWho, guideAll, guideWho };
}

function verdictLine(title, who, all) {
  if (who.length) {
    return `  ✅ ${title}\n     PROBABLE SÍ — campos con atribución de usuario:\n${who.map((p) => '        - ' + p).join('\n')}`;
  }
  if (all.length) {
    return `  ⚠️  ${title}\n     PARCIAL — hay campos relacionados pero SIN usuario/atribución evidente:\n${all.map((p) => '        - ' + p).join('\n')}`;
  }
  return `  ❌ ${title}\n     NO — no se detectaron campos relacionados.`;
}
// ----------------------------------------------------------------------------

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log(`\n[LOGIN] POST /auth/login -> ${r.status}`);
  const body = await r.json().catch(() => ({}));
  console.log('[LOGIN] llaves de respuesta:', Object.keys(body));
  const token = body.token || body.accessToken || body.access_token || body.jwt ||
    body?.data?.token || body?.data?.accessToken;
  if (!token) {
    console.error('[LOGIN] No se encontró campo de token. Mapa de llaves:');
    console.error(print(keyPaths(body)));
    process.exit(1);
  }
  console.log('[LOGIN] token OK (valor oculto).');
  return token;
}

// El token de "Conecta tu API" se usa como Bearer; probamos alternativas por
// robustez si la API rechazara la primera.
const authVariants = (token) => [
  { label: 'Bearer', headers: { Authorization: `Bearer ${token}` } },
  { label: 'raw-Authorization', headers: { Authorization: token } },
  { label: 'X-Api-Key', headers: { 'X-Api-Key': token } },
  { label: 'X-Api-Token', headers: { 'X-Api-Token': token } },
];

const listEndpoints = [
  `${BASE}/orders`,
  `${BASE}/orders?store_id=${STORE_ID}`,
  `${BASE}/orders?store=${STORE_ID}`,
  `${BASE}/orders?storeId=${STORE_ID}`,
  `${BASE}/stores/${STORE_ID}/orders`,
  `${BASE}/store/${STORE_ID}/orders`,
];

const extractArray = (body) =>
  Array.isArray(body) ? body
    : body?.data?.orders || body?.data || body?.orders || body?.results || body?.items;

async function main() {
  const token = TOKEN_ENV
    ? (console.log('[AUTH] Usando ICOMFLY_TOKEN (valor oculto).'), TOKEN_ENV)
    : await login();

  // 1) Encontrar esquema de auth + endpoint de listado que devuelva pedidos.
  let auth = null, orders = null, usedUrl = null, listBody = null;
  outer:
  for (const variant of authVariants(token)) {
    for (const url of listEndpoints) {
      let r;
      try {
        r = await fetch(url, { headers: { ...variant.headers, ...ACCEPT } });
      } catch (e) {
        console.log(`[ORDERS] [${variant.label}] GET ${url.replace(BASE, '')} -> ERROR ${e.message}`);
        continue;
      }
      console.log(`[ORDERS] [${variant.label}] GET ${url.replace(BASE, '')} -> ${r.status}`);
      if (r.status === 401 || r.status === 403) continue; // esquema/endpoint inválido
      if (!r.ok) continue;
      const body = await r.json().catch(() => null);
      const arr = extractArray(body);
      if (Array.isArray(arr)) {
        auth = { ...variant.headers, ...ACCEPT };
        orders = arr; usedUrl = url; listBody = body;
        console.log(`[ORDERS] OK con esquema "${variant.label}" en ${url.replace(BASE, '')} (${arr.length} pedidos).`);
        break outer;
      }
    }
  }

  if (!auth) {
    console.error('\n[RESULTADO] No se pudo listar pedidos con ningún esquema de auth/endpoint probado.');
    console.error('Revisa que el token sea válido y que el endpoint de pedidos exista.');
    process.exit(1);
  }
  if (listBody && !Array.isArray(listBody)) {
    console.log('[ORDERS] llaves nivel superior:', Object.keys(listBody));
  }
  if (!orders.length) { console.log('[ORDERS] Lista vacía: no hay pedidos para inspeccionar.'); return; }

  // 2) Mapa de llaves del primer pedido (vista de lista).
  const listPaths = keyPaths(orders[0]);
  console.log(`\n[ORDER:list] mapa de llaves del primer pedido (${usedUrl.replace(BASE, '')}):`);
  console.log(print(listPaths));
  reportMatches('ORDER:list', listPaths);

  // 3) Detalle del pedido (suele traer historial / atribución de usuario).
  let detailPaths = [];
  const id = orders[0].id ?? orders[0]._id ?? orders[0].orderId ?? orders[0].uuid ?? orders[0].number;
  if (id != null) {
    for (const durl of [`${BASE}/orders/${id}`, `${BASE}/stores/${STORE_ID}/orders/${id}`]) {
      const dr = await fetch(durl, { headers: auth });
      console.log(`\n[ORDER:detail] GET ${durl.replace(BASE, '')} -> ${dr.status}`);
      if (!dr.ok) continue;
      const d = await dr.json().catch(() => null);
      detailPaths = keyPaths(d?.data || d?.order || d);
      console.log('[ORDER:detail] mapa de llaves:');
      console.log(print(detailPaths));
      reportMatches('ORDER:detail', detailPaths);
      break;
    }
  }

  // 4) Veredicto.
  const all = [...listPaths, ...detailPaths];
  const c = classify(all);
  console.log('\n================== VEREDICTO (heurístico) ==================');
  console.log(verdictLine('¿La API dice quién CONFIRMÓ el pedido?', c.confirmWho, c.confirmAll));
  console.log(verdictLine('¿La API dice quién GENERÓ la guía?', c.guideWho, c.guideAll));
  console.log('\n  Nota: la "atribución" se infiere por el NOMBRE del campo; confírmalo');
  console.log('  inspeccionando los valores reales de los campos listados arriba.');
  console.log('============================================================');
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
