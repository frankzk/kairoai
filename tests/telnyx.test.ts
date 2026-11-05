// Telefonia Telnyx: firma del webhook, eventos de la llamada y credenciales.
//
// POR QUE ESTE TEST EXISTE: el historial de llamadas del lead, la "ultima
// llamada" y la productividad salen de lo que escribe el webhook. Un webhook
// sin verificar dejaria a cualquiera escribir ahi; uno que cuenta mal dejaria
// "contestada · 0s" o "no contesto" en llamadas que si hubo. Y el numero a
// marcar tiene que salir de la base, nunca de la pantalla: si no, cualquiera
// con sesion llama a donde quiera a costa de la cuenta.

import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  callerIdDeTienda,
  codificarEstadoCliente,
  estadoDeColgado,
  leerEstadoCliente,
  leerEventoTelnyx,
  proveedorTelefonia,
  segundosDeConversacion,
  verificarFirmaTelnyx,
} from "../lib/telnyx";

// ─── Base en memoria: lo justo que usan lib/telnyx-calls.ts y las rutas ──────

type Fila = Record<string, unknown>;
const tablas: Record<string, Fila[]> = {};
let siguienteId = 1;

vi.mock("@/lib/db", () => {
  const tabla = (nombre: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    let una = false;
    let cambio: { tipo: "insert" | "update"; fila: Fila } | null = null;
    const correr = () => {
      const filas = (tablas[nombre] ??= []);
      if (cambio?.tipo === "insert") {
        filas.push({ id: siguienteId++, ...cambio.fila });
        return { data: null, error: null };
      }
      const elegidas = filas.filter((f) => filtros.every((ok) => ok(f)));
      if (cambio?.tipo === "update") {
        for (const f of elegidas) Object.assign(f, cambio.fila);
        return { data: null, error: null };
      }
      if (una) return { data: elegidas[0] ? { ...elegidas[0] } : null, error: null };
      return { data: elegidas.map((f) => ({ ...f })), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, v: unknown) => (filtros.push((f) => String(f[col]) === String(v)), api),
      is: (col: string, v: unknown) => (filtros.push((f) => (f[col] ?? null) === v), api),
      lt: (col: string, v: string) => (filtros.push((f) => String(f[col] ?? "") < v), api),
      maybeSingle: () => ((una = true), api),
      abortSignal: () => api,
      insert: (fila: Fila) => ((cambio = { tipo: "insert", fila }), api),
      update: (fila: Fila) => ((cambio = { tipo: "update", fila }), api),
      then: (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => Promise.resolve(correr()).then(ok, mal),
    };
    return api;
  };
  return { getDB: () => ({ from: tabla }) };
});

vi.mock("@/lib/leads", () => ({
  getLead: async (_store: number, id: number) => (id === 5 ? { id: 5, name: "Sonia", phone: "63567891" } : null),
}));
vi.mock("@/lib/incidents", () => ({
  getIncident: async (id: number, storeId: number) =>
    id === 9 && storeId === 1 ? { id: 9, store_id: 1, customer_phone: "8888-1234" } : null,
}));
vi.mock("@/lib/identidad", () => ({
  vendedoraEfectiva: (v: unknown) => (Number(v) > 0 ? Number(v) : null),
  tiendasPermitidas: () => null,
  identidadActual: () => null,
}));

// Un JWT como el de Telnyx: vence en 24 h.
const TOKEN = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86_400 })).toString("base64url")}.firma`;

// Telnyx simulado: guarda lo que se le pidio.
const pedidos: Array<{ url: string; body: unknown }> = [];
let credencialesCreadas = 0;
const fetchTelnyx = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  pedidos.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (u.endsWith("/telephony_credentials")) {
    credencialesCreadas++;
    return new Response(JSON.stringify({ data: { id: `cred-${credencialesCreadas}`, sip_username: "gencred1" } }), { status: 201 });
  }
  if (u.includes("/token")) return new Response(TOKEN, { status: 201 });
  return new Response(JSON.stringify({ data: { result: "ok" } }), { status: 200 });
});

// ─── Llaves de prueba ─────────────────────────────────────────────────────────

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUB_B64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("base64");

function firmar(cuerpo: string, ts = String(Math.floor(Date.now() / 1000))) {
  return { ts, firma: crypto.sign(null, Buffer.from(`${ts}|${cuerpo}`), privateKey).toString("base64") };
}

function evento(tipo: string, clientState: string | null, extra: Record<string, unknown> = {}, ocurrio?: string) {
  return JSON.stringify({
    data: {
      event_type: tipo,
      occurred_at: ocurrio ?? new Date().toISOString(),
      payload: { call_control_id: "v3:ctrl-1", client_state: clientState, ...extra },
    },
  });
}

async function webhook(cuerpo: string, firma = firmar(cuerpo)) {
  const { POST } = await import("../app/api/telnyx/webhook/route");
  return POST(
    new NextRequest("http://localhost/api/telnyx/webhook", {
      method: "POST",
      body: cuerpo,
      headers: { "telnyx-signature-ed25519": firma.firma, "telnyx-timestamp": firma.ts },
    })
  );
}

async function prepararLlamada(body: Record<string, unknown> = { store: "mireva-cr", vendedora_id: 7, lead_id: 5 }) {
  const { POST } = await import("../app/api/telnyx/llamada/route");
  return POST(new NextRequest("http://localhost/api/telnyx/llamada", { method: "POST", body: JSON.stringify(body) }));
}

const llamada = () => tablas.zadarma_calls?.[0] as Fila;

beforeEach(async () => {
  (await import("../lib/telnyx-calls")).olvidarTokensTelnyx();
  for (const k of Object.keys(tablas)) delete tablas[k];
  siguienteId = 1;
  pedidos.length = 0;
  credencialesCreadas = 0;
  vi.stubGlobal("fetch", fetchTelnyx);
  process.env.TELNYX_API_KEY = "KEY_test";
  process.env.TELNYX_CONNECTION_ID = "conn-1";
  process.env.TELNYX_PUBLIC_KEY = PUB_B64;
  process.env.TELNYX_CALLER_ID_CR = "+506 4000 1234";
  delete process.env.TELNYX_GRABAR;
  delete process.env.TELNYX_CALLER_ID_HN;
  tablas.payroll_staff = [{ id: 7, name: "Daleska", active: true, telnyx_credential_id: null }];
});

// ─── Piezas puras ─────────────────────────────────────────────────────────────

describe("firma del webhook", () => {
  const cuerpo = '{"data":{"event_type":"call.hangup"}}';

  it("acepta lo firmado con la llave de la cuenta", () => {
    const f = firmar(cuerpo);
    expect(verificarFirmaTelnyx({ cuerpo, firma: f.firma, timestamp: f.ts, publicKey: PUB_B64 })).toEqual({ ok: true });
  });

  it("rechaza un cuerpo cambiado, una firma ajena, un timestamp viejo y la falta de cabeceras", () => {
    const f = firmar(cuerpo);
    expect(verificarFirmaTelnyx({ cuerpo: cuerpo + " ", firma: f.firma, timestamp: f.ts, publicKey: PUB_B64 }).ok).toBe(false);
    const otra = crypto.generateKeyPairSync("ed25519");
    const ajena = crypto.sign(null, Buffer.from(`${f.ts}|${cuerpo}`), otra.privateKey).toString("base64");
    expect(verificarFirmaTelnyx({ cuerpo, firma: ajena, timestamp: f.ts, publicKey: PUB_B64 }).ok).toBe(false);
    const vieja = firmar(cuerpo, String(Math.floor(Date.now() / 1000) - 600));
    expect(verificarFirmaTelnyx({ cuerpo, firma: vieja.firma, timestamp: vieja.ts, publicKey: PUB_B64 })).toMatchObject({
      ok: false,
      motivo: "timestamp fuera de tiempo",
    });
    expect(verificarFirmaTelnyx({ cuerpo, firma: null, timestamp: null, publicKey: PUB_B64 }).ok).toBe(false);
  });
});

describe("piezas de la llamada", () => {
  it("client_state lleva solo el id de Kairo y rechaza lo ajeno", () => {
    const id = crypto.randomUUID();
    expect(leerEstadoCliente(codificarEstadoCliente(id))).toBe(id);
    expect(leerEstadoCliente(Buffer.from("otra-app:123").toString("base64"))).toBeNull();
    expect(leerEstadoCliente(null)).toBeNull();
  });

  it("como termino, en las palabras del CDR de Zadarma", () => {
    expect(estadoDeColgado("normal_clearing", true)).toBe("answered");
    expect(estadoDeColgado("user_busy", false)).toBe("busy");
    expect(estadoDeColgado("call_rejected", false)).toBe("busy");
    expect(estadoDeColgado("no_answer", false)).toBe("no answer");
    expect(estadoDeColgado("timeout", false)).toBe("no answer");
    expect(estadoDeColgado("originator_cancel", false)).toBe("cancel");
    expect(estadoDeColgado("not_found", false)).toBe("unallocated number");
    expect(estadoDeColgado("normal_clearing", false)).toBe("failed");
    expect(segundosDeConversacion("2026-11-01T10:00:00Z", "2026-11-01T10:01:25Z")).toBe(85);
    expect(segundosDeConversacion(null, "2026-11-01T10:01:25Z")).toBe(0);
  });

  it("el numero que ve el cliente va por pais; sin variable no hay", () => {
    expect(callerIdDeTienda("CR")).toBe("+50640001234");
    expect(callerIdDeTienda("HN")).toBeNull();
  });

  it("sin TELEFONIA=telnyx sigue Zadarma", () => {
    expect(proveedorTelefonia({})).toBe("zadarma");
    expect(proveedorTelefonia({ TELEFONIA: "Telnyx " })).toBe("telnyx");
  });

  it("solo lee los eventos que usa Kairo", () => {
    expect(leerEventoTelnyx(JSON.parse(evento("call.speak.ended", "x")))).toBeNull();
    expect(leerEventoTelnyx(JSON.parse(evento("call.hangup", "x", { hangup_cause: "user_busy" })))).toMatchObject({
      tipo: "call.hangup",
      hangupCause: "user_busy",
      callControlId: "v3:ctrl-1",
    });
  });
});

// ─── Rutas ────────────────────────────────────────────────────────────────────

describe("preparar la llamada", () => {
  it("el numero sale del lead (no de la pantalla) y el caller ID de la tienda", async () => {
    const res = await prepararLlamada({ store: "mireva-cr", vendedora_id: 7, lead_id: 5, phone: "+15550001111" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ destino: "+50663567891", caller_number: "+50640001234" });
    expect(llamada()).toMatchObject({
      provider: "telnyx",
      store_id: 1,
      lead_id: 5,
      vendedora: 7,
      phone: "50663567891",
      status: "calling",
    });
    expect(leerEstadoCliente(data.client_state)).toBe(String(llamada().pbx_call_id).replace("telnyx:", ""));
  });

  it("desde Novedades, el numero sale de la novedad guardada en esa tienda", async () => {
    const res = await prepararLlamada({ store: "mireva-cr", vendedora_id: 7, incident_id: 9, phone: "+15550001111" });
    expect(await res.json()).toMatchObject({ destino: "+50688881234" });
    expect(llamada()).toMatchObject({ lead_id: null, phone: "50688881234" });
    // La de otra tienda no se encuentra.
    process.env.TELNYX_CALLER_ID_HN = "+504 2200 0000";
    expect((await prepararLlamada({ store: "mireva-hn", vendedora_id: 7, incident_id: 9 })).status).toBe(404);
  });

  it("una llamada anterior de la asesora que nunca se marco queda como no marcada", async () => {
    const vieja = new Date(Date.now() - 5 * 60_000).toISOString();
    tablas.zadarma_calls = [
      { id: 90, provider: "telnyx", vendedora: 7, status: "calling", started_at: vieja },
      { id: 91, provider: "telnyx", vendedora: 8, status: "calling", started_at: vieja },
      { id: 92, provider: "telnyx", vendedora: 7, status: "answered", started_at: vieja },
    ];
    siguienteId = 100;
    await prepararLlamada();
    const estado = (id: number) => tablas.zadarma_calls.find((f) => f.id === id)?.status;
    expect(estado(90)).toBe("not_dialed");
    expect(estado(91)).toBe("calling"); // otra asesora
    expect(estado(92)).toBe("answered");
    expect(estado(100)).toBe("calling"); // la nueva
  });

  it("los historiales no muestran las que nunca salieron", async () => {
    const { esLlamadaReal } = await import("../lib/telnyx");
    const ahora = Date.parse("2026-11-02T03:00:00Z");
    expect(esLlamadaReal({ status: "not_dialed", started_at: "2026-11-02T02:59:00Z" }, ahora)).toBe(false);
    expect(esLlamadaReal({ status: "calling", started_at: "2026-11-02T02:50:00Z" }, ahora)).toBe(false);
    expect(esLlamadaReal({ status: "calling", started_at: "2026-11-02T02:59:00Z" }, ahora)).toBe(true);
    expect(esLlamadaReal({ status: "cancel", started_at: "2026-11-01T02:00:00Z" }, ahora)).toBe(true);
  });

  it("sin numero de la tienda no prepara nada y dice que variable falta", async () => {
    delete process.env.TELNYX_CALLER_ID_CR;
    const res = await prepararLlamada();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/TELNYX_CALLER_ID_CR/);
    expect(tablas.zadarma_calls ?? []).toEqual([]);
  });
});

describe("token del navegador", () => {
  it("un JWT rechazado se renueva también en el servidor sin recrear la credencial", async () => {
    const { POST } = await import("../app/api/telnyx/token/route");
    const pedir = (force = false) => POST(new NextRequest("http://localhost/api/telnyx/token", { method: "POST", body: JSON.stringify({ vendedora_id: 7, forzar_token: force }) }));
    await pedir();
    await pedir();
    expect(pedidos.filter(p => p.url.endsWith("/telephony_credentials/cred-1/token"))).toHaveLength(1);
    const response = await pedir(true);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(pedidos.filter(p => p.url.endsWith("/telephony_credentials/cred-1/token"))).toHaveLength(2);
    expect(credencialesCreadas).toBe(1);
  });
  it("crea la credencial de la asesora una sola vez y la reutiliza", async () => {
    const { POST } = await import("../app/api/telnyx/token/route");
    const pedir = () =>
      POST(new NextRequest("http://localhost/api/telnyx/token", { method: "POST", body: JSON.stringify({ vendedora_id: 7 }) }));
    const r1 = await pedir();
    expect(await r1.json()).toMatchObject({ token: TOKEN });
    expect(credencialesCreadas).toBe(1);
    expect(tablas.payroll_staff[0].telnyx_credential_id).toBe("cred-1");
    expect(pedidos.find((p) => p.url.endsWith("/telephony_credentials"))?.body).toMatchObject({ connection_id: "conn-1" });

    // Vencido el token en el servidor, se pide otro con la MISMA credencial.
    (await import("../lib/telnyx-calls")).olvidarTokensTelnyx();
    await pedir();
    expect(credencialesCreadas).toBe(1);
    expect(pedidos.filter((p) => p.url.endsWith("/telephony_credentials/cred-1/token"))).toHaveLength(2);
  });

  it("mientras el token sigue vigente, una pagina recargada no toca ni la base ni Telnyx", async () => {
    const { POST } = await import("../app/api/telnyx/token/route");
    const pedir = () =>
      POST(new NextRequest("http://localhost/api/telnyx/token", { method: "POST", body: JSON.stringify({ vendedora_id: 7 }) }));
    await pedir();
    const antes = pedidos.length;
    tablas.payroll_staff = []; // si se consultara la base, no encontraria a la asesora
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ token: TOKEN });
    expect(pedidos.length).toBe(antes);
  });

  it("lee el vencimiento del token (exp del JWT)", async () => {
    const { vencimientoToken } = await import("../lib/telnyx");
    expect(vencimientoToken(TOKEN)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(vencimientoToken("no-es-un-jwt")).toBeNull();
  });
});

describe("webhook", () => {
  async function estado() {
    const data = await (await prepararLlamada()).json();
    return data.client_state as string;
  }

  it("contestada: cuenta la conversacion desde que contesto el cliente", async () => {
    const cs = await estado();
    expect((await webhook(evento("call.initiated", cs))).status).toBe(200);
    expect(llamada().status).toBe("ringing");
    await webhook(evento("call.answered", cs, {}, "2026-11-01T10:00:00Z"));
    await webhook(evento("call.hangup", cs, { hangup_cause: "normal_clearing" }, "2026-11-01T10:02:05Z"));
    expect(llamada()).toMatchObject({ status: "answered", duration_seconds: 125, ended_at: "2026-11-01T10:02:05Z" });
  });

  it("ocupado: sin conversacion, 0 segundos", async () => {
    const cs = await estado();
    await webhook(evento("call.hangup", cs, { hangup_cause: "user_busy" }));
    expect(llamada()).toMatchObject({ status: "busy", duration_seconds: 0 });
  });

  it("un 'contestada' que llega despues del colgado corrige el estado", async () => {
    const cs = await estado();
    await webhook(evento("call.hangup", cs, { hangup_cause: "normal_clearing" }, "2026-11-01T10:01:00Z"));
    expect(llamada().status).toBe("failed");
    await webhook(evento("call.answered", cs, {}, "2026-11-01T10:00:30Z"));
    expect(llamada()).toMatchObject({ status: "answered", duration_seconds: 30 });
  });

  it("los repetidos no cambian nada", async () => {
    const cs = await estado();
    await webhook(evento("call.answered", cs, {}, "2026-11-01T10:00:00Z"));
    await webhook(evento("call.hangup", cs, { hangup_cause: "normal_clearing" }, "2026-11-01T10:01:00Z"));
    await webhook(evento("call.hangup", cs, { hangup_cause: "normal_clearing" }, "2026-11-01T10:09:00Z"));
    await webhook(evento("call.initiated", cs));
    expect(llamada()).toMatchObject({ status: "answered", duration_seconds: 60, ended_at: "2026-11-01T10:01:00Z" });
  });

  it("con TELNYX_GRABAR=1 graba al contestar y guarda la grabacion", async () => {
    process.env.TELNYX_GRABAR = "1";
    const cs = await estado();
    await webhook(evento("call.answered", cs));
    expect(pedidos.find((p) => p.url.endsWith("/calls/v3%3Actrl-1/actions/record_start"))?.body).toEqual({
      format: "mp3",
      channels: "dual",
    });
    await webhook(evento("call.recording.saved", cs, { recording_urls: { mp3: "https://rec.telnyx/x.mp3" } }));
    expect(llamada()).toMatchObject({ is_recorded: true, record_url: "https://rec.telnyx/x.mp3" });
  });

  it("sin grabar no le pide nada a Telnyx", async () => {
    const cs = await estado();
    await webhook(evento("call.answered", cs));
    expect(pedidos.some((p) => p.url.includes("record_start"))).toBe(false);
  });

  it("rechaza lo no firmado y no escribe", async () => {
    const cs = await estado();
    const cuerpo = evento("call.answered", cs);
    const res = await webhook(cuerpo, { ts: String(Math.floor(Date.now() / 1000)), firma: Buffer.alloc(64).toString("base64") });
    expect(res.status).toBe(401);
    expect(llamada().status).toBe("calling");
  });

  it("sin TELNYX_PUBLIC_KEY no acepta nada", async () => {
    delete process.env.TELNYX_PUBLIC_KEY;
    expect((await webhook(evento("call.answered", null))).status).toBe(503);
  });

  it("call.cost guarda lo que costo la llamada, en la moneda de Telnyx", async () => {
    const cs = await estado();
    await webhook(evento("call.answered", cs, {}, "2026-11-01T10:00:00Z"));
    await webhook(evento("call.hangup", cs, { hangup_cause: "normal_clearing" }, "2026-11-01T10:01:10Z"));
    await webhook(
      evento("call.cost", cs, {
        status: "success",
        total_cost: "0.0250",
        billed_duration_secs: 120,
        cost_parts: [{ call_part: "call-control", cost: "0.0250", currency: "usd", rate: "0.0125", billed_duration_secs: 120 }],
      })
    );
    expect(llamada()).toMatchObject({ status: "answered", cost: 0.025, cost_currency: "USD", billed_seconds: 120 });
  });

  it("call.cost sin client_state encuentra la llamada por su id de Telnyx", async () => {
    const cs = await estado();
    await webhook(evento("call.initiated", cs));
    expect(llamada().telnyx_call_control_id).toBe("v3:ctrl-1");
    await webhook(evento("call.cost", null, { status: "success", total_cost: "0.0125", billed_duration_secs: 60 }));
    expect(llamada()).toMatchObject({ cost: 0.0125, billed_seconds: 60 });
  });

  it("si Telnyx no pudo calcular el costo, queda vacio (no 0)", async () => {
    const cs = await estado();
    await webhook(evento("call.cost", cs, { status: "error", total_cost: null }));
    expect(llamada().cost ?? null).toBeNull();
    expect(leerEventoTelnyx(JSON.parse(evento("call.cost", cs, { total_cost: "" })))?.costo).toBeNull();
  });

  it("una llamada que no salio de Kairo se ignora con 200 (Telnyx no reintenta)", async () => {
    await estado();
    const res = await webhook(evento("call.hangup", Buffer.from("otra-app").toString("base64")));
    expect(res.status).toBe(200);
    expect(llamada().status).toBe("calling");
  });
});
