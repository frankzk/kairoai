#!/usr/bin/env node
// scripts/icomfly-leads-probe.mjs
// Sonda READ-ONLY de Fase 0 del módulo de Leads (docs/leads-spec/).
// Responde lo que falta del cuestionario de 04-contrato-adaptador-crm.md:
//   (Q1) ¿existen endpoints de conversaciones/mensajes tras autenticarse?
//   (Q4) ¿en qué formato entrega Icomfly el teléfono del cliente?
//   (¿?) ¿/customers incluye contactos que solo chatearon (sin pedido)?
//   (Q2) catálogo real de suscripciones de webhook (vía Conector MCP).
// Privacidad: imprime SOLO nombres de campo + tipos; teléfonos enmascarados
// (se conserva prefijo y longitud). Nunca imprime credenciales ni valores.
//
// Uso:
//   ICOMFLY_EMAIL='tu@correo.com' ICOMFLY_PASSWORD='secreto' node scripts/icomfly-leads-probe.mjs
// Opcional:
//   ICOMFLY_STORE_ID   id externo de tienda (default 71, CR)
//   ICOMFLY_BASE       default https://api.icomfly.com/api
//   ICOMFLY_MCP_TOKEN  token icf_... para listar webhooks vía /mcp/{store_id}

const BASE = process.env.ICOMFLY_BASE || 'https://api.icomfly.com/api';
const EMAIL = process.env.ICOMFLY_EMAIL;
const PASSWORD = process.env.ICOMFLY_PASSWORD;
const STORE_ID = process.env.ICOMFLY_STORE_ID || '71';
const MCP_TOKEN = process.env.ICOMFLY_MCP_TOKEN;

if (!EMAIL || !PASSWORD) {
  console.error('Define ICOMFLY_EMAIL y ICOMFLY_PASSWORD.');
  process.exit(1);
}

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

// Enmascara un teléfono conservando el patrón: '50661234567' -> '506########'
// y '+506 6123-4567' -> '+506 ####-####'. Solo se reemplazan dígitos después
// de los primeros 3 (posible código de país).
function maskPhone(value) {
  const s = String(value);
  let digitsSeen = 0;
  return s.replace(/\d/g, (d) => (++digitsSeen <= 3 ? d : '#'));
}

function extractArray(body) {
  if (Array.isArray(body)) return body;
  const b = body ?? {};
  const arr = b.data ?? b.customers ?? b.orders ?? b.results ?? b.items;
  return Array.isArray(arr) ? arr : [];
}

function findPhones(obj, out = [], depth = 0) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (/phone|telefono|teléfono|celular|movil|móvil|whatsapp|wa_id/i.test(k) && v != null && v !== '') {
      out.push({ key: k, masked: maskPhone(v), len: String(v).replace(/\D/g, '').length });
    } else if (v && typeof v === 'object') {
      findPhones(v, out, depth + 1);
    }
  }
  return out;
}

async function main() {
  // ── Login (JWT ~30 días según docs) ────────────────────────────────────────
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  console.log(`[LOGIN] POST /auth/login -> ${loginRes.status}`);
  const loginBody = await loginRes.json().catch(() => ({}));
  const token = loginBody.token || loginBody.accessToken || loginBody.access_token ||
    loginBody.jwt || loginBody?.data?.token || loginBody?.data?.accessToken;
  if (!token) {
    console.error('[LOGIN] Sin token. Llaves:', print(keyPaths(loginBody)));
    process.exit(1);
  }
  console.log('[LOGIN] token OK (valor oculto).');
  const auth = { Authorization: `Bearer ${token}`, 'X-Active-Store-Ids': STORE_ID };

  // ── Q1: rutas de conversaciones/mensajes, ahora autenticado ────────────────
  // Sin token todas dieron 404; se re-testean por si el router las oculta a
  // anónimos. 404 autenticado = no existen, punto final.
  console.log('\n[Q1] Rutas candidatas de chats (autenticado):');
  for (const p of ['conversations', 'chats', 'messages', 'chats/export', 'inbox', 'threads']) {
    const r = await fetch(`${BASE}/${p}?store_id=${STORE_ID}&limit=1`, { headers: auth });
    console.log(`  GET /${p} -> ${r.status}`);
  }

  // ── Q4 + contactos sin pedido: /customers ──────────────────────────────────
  const cr = await fetch(`${BASE}/customers?store_id=${STORE_ID}&page=1&limit=5`, { headers: auth });
  console.log(`\n[Q4] GET /customers -> ${cr.status}`);
  if (cr.ok) {
    const body = await cr.json().catch(() => null);
    console.log('[Q4] llaves nivel superior:', Array.isArray(body) ? 'array' : Object.keys(body ?? {}));
    const customers = extractArray(body);
    if (customers.length) {
      console.log('[Q4] mapa de llaves del primer cliente:');
      console.log(print(keyPaths(customers[0])));
      console.log('[Q4] teléfonos detectados (enmascarados, prefijo+longitud):');
      for (const c of customers) {
        for (const ph of findPhones(c)) {
          console.log(`  ${ph.key}: ${ph.masked}  (digitos=${ph.len})`);
        }
      }
      // Señales de "contacto sin pedido": contadores de pedidos u origen chat.
      const hints = keyPaths(customers[0]).filter(({ path }) =>
        /order|pedido|purchase|compra|source|origen|chat|conversation|last_/i.test(path));
      console.log('[¿?] llaves que insinúan pedidos/origen del contacto:');
      console.log(hints.length ? print(hints) : '  (ninguna)');
      const total = body?.total ?? body?.count ?? body?.meta?.total ?? body?.pagination?.total;
      if (total != null) console.log(`[¿?] total de clientes reportado: ${total} (comparar contra total de pedidos)`);
    } else {
      console.log('[Q4] respuesta sin filas para inspeccionar.');
    }
  }

  // Total de pedidos para comparar (¿clientes > pedidos ⇒ hay contactos sin compra?)
  const or = await fetch(`${BASE}/orders?store_id=${STORE_ID}&page=1&limit=1`, { headers: auth });
  if (or.ok) {
    const body = await or.json().catch(() => null);
    const total = body?.total ?? body?.count ?? body?.meta?.total ?? body?.pagination?.total;
    console.log(`\n[¿?] GET /orders -> ${or.status}; total de pedidos reportado: ${total ?? '(no expuesto)'}`);
  }

  // ── Q2: catálogo real de webhooks vía Conector MCP ─────────────────────────
  if (MCP_TOKEN) {
    const mr = await fetch(`https://api.icomfly.com/mcp/${STORE_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MCP_TOKEN}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'listar_webhooks_suscripciones', arguments: {} },
      }),
    });
    console.log(`\n[Q2] MCP listar_webhooks_suscripciones -> ${mr.status}`);
    const body = await mr.json().catch(() => null);
    if (body) console.log(print(keyPaths(body)));
  } else {
    console.log('\n[Q2] ICOMFLY_MCP_TOKEN no definido; se omite el listado de webhooks MCP.');
  }

  console.log('\nListo. Pega esta salida completa en la sesión de Claude Code.');
}

main().catch((err) => {
  console.error('Error de la sonda:', err?.message ?? err);
  process.exit(1);
});
