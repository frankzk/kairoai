#!/usr/bin/env node
// scripts/icomfly-probe.mjs
// Sonda READ-ONLY de la API de iComfly. Determina si un pedido expone
//   (a) quién CONFIRMA el pedido, y (b) qué USUARIO genera la guía de transporte.
// Privacidad: imprime SOLO nombres de campo + tipo (valores enmascarados).
// Las credenciales se leen de variables de entorno y nunca se imprimen.
//
// Uso:
//   ICOMFLY_EMAIL='tu@correo.com' ICOMFLY_PASSWORD='secreto' node scripts/icomfly-probe.mjs
// Opcional: ICOMFLY_STORE_ID (default 71), ICOMFLY_BASE

const BASE = process.env.ICOMFLY_BASE || 'https://api.icomfly.com/api';
const EMAIL = process.env.ICOMFLY_EMAIL;
const PASSWORD = process.env.ICOMFLY_PASSWORD;
const STORE_ID = process.env.ICOMFLY_STORE_ID || '71';

if (!EMAIL || !PASSWORD) {
  console.error('Define ICOMFLY_EMAIL y ICOMFLY_PASSWORD.');
  process.exit(1);
}

const INTEREST = [
  'confirm', 'approv', 'valid', 'accept', 'user', 'agent', 'seller', 'operator', 'staff',
  'admin', 'created_by', 'createdby', 'generated_by', 'generatedby', 'guia', 'guía', 'guide',
  'track', 'carrier', 'courier', 'ship', 'transport', 'waybill', 'label', 'status', 'history',
  'event', 'timeline', 'log',
];

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? `array[${v.length}]` : typeof v);

function keyPaths(obj, prefix = '', out = [], depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return out;
  const entries = Array.isArray(obj) ? (obj.length ? [['0', obj[0]]] : []) : Object.entries(obj);
  for (const [k, v] of entries) {
    const path = prefix ? `${prefix}.${k}` : String(k);
    out.push({ path, type: typeOf(v) });
    if (v && typeof v === 'object') keyPaths(v, path, out, depth + 1);
  }
  return out;
}

const print = (paths) => paths.map((k) => `  ${k.path}: ${k.type}`).join('\n');

function reportMatches(label, paths) {
  const hits = paths.filter(({ path }) => INTEREST.some((w) => path.toLowerCase().includes(w)));
  console.log(`\n[${label}] >>> llaves relacionadas con confirmador / generador de guía / envío:`);
  console.log(hits.length ? print(hits) : '  (ninguna)');
}

async function main() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log(`\n[LOGIN] POST /auth/login -> ${loginRes.status}`);
  const loginBody = await loginRes.json().catch(() => ({}));
  console.log('[LOGIN] llaves de respuesta:', Object.keys(loginBody));
  const token = loginBody.token || loginBody.accessToken || loginBody.access_token ||
    loginBody.jwt || loginBody?.data?.token || loginBody?.data?.accessToken;
  if (!token) {
    console.error('[LOGIN] No se encontró campo de token. Mapa de llaves:');
    console.error(print(keyPaths(loginBody)));
    process.exit(1);
  }
  console.log('[LOGIN] token OK (valor oculto).');
  const auth = { Authorization: `Bearer ${token}` };

  const variants = [
    `${BASE}/orders`, `${BASE}/orders?store=${STORE_ID}`,
    `${BASE}/orders?storeId=${STORE_ID}`, `${BASE}/orders?store_id=${STORE_ID}`,
  ];
  let orders, usedUrl, listBody;
  for (const url of variants) {
    const r = await fetch(url, { headers: auth });
    console.log(`\n[ORDERS] GET ${url.replace(BASE, '')} -> ${r.status}`);
    if (!r.ok) continue;
    listBody = await r.json().catch(() => null);
    const arr = Array.isArray(listBody) ? listBody
      : listBody?.data || listBody?.orders || listBody?.results || listBody?.items;
    if (Array.isArray(arr)) { orders = arr; usedUrl = url; if (arr.length) break; }
  }
  if (listBody) {
    console.log('[ORDERS] llaves nivel superior:',
      Array.isArray(listBody) ? 'array' : Object.keys(listBody));
  }
  if (!orders || !orders.length) { console.log('[ORDERS] Sin pedidos para inspeccionar.'); return; }

  const listPaths = keyPaths(orders[0]);
  console.log(`\n[ORDER:list] mapa de llaves del primer pedido (de ${usedUrl.replace(BASE, '')}):`);
  console.log(print(listPaths));

  const id = orders[0].id ?? orders[0]._id ?? orders[0].orderId ?? orders[0].uuid;
  if (id != null) {
    const dr = await fetch(`${BASE}/orders/${id}`, { headers: auth });
    console.log(`\n[ORDER:detail] GET /orders/${id} -> ${dr.status}`);
    if (dr.ok) {
      const d = await dr.json().catch(() => null);
      const detailPaths = keyPaths(d?.data || d?.order || d);
      console.log('[ORDER:detail] mapa de llaves:');
      console.log(print(detailPaths));
      reportMatches('ORDER:detail', detailPaths);
    }
  }
  reportMatches('ORDER:list', listPaths);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
