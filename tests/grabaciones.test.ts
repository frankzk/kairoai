// Grabaciones de las llamadas en nuestro almacenamiento.
//
// POR QUE ESTE TEST EXISTE: los enlaces de los proveedores vencen (Telnyx en
// ~10 minutos, Zadarma a los 60 dias). Si la copia al bucket falla en
// silencio, o el cron reintenta para siempre un enlace muerto, o la ruta de
// escuchar deja oir una llamada de otra tienda, el dueño se entera cuando ya
// no hay grabacion. Y ningun enlace con firma puede quedar en un log ni en la
// base como "error".

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ─── Base y Storage en memoria ──────────────────────────────────────────────

type Fila = Record<string, unknown>;
const tablas: Record<string, Fila[]> = {};
const subidas: Array<{ bucket: string; path: string; bytes: number; opts: Record<string, unknown> }> = [];
const firmadas: Array<{ bucket: string; path: string; ttl: number }> = [];
let falloSubida: string | null = null;
let sinMigracion = false;

function valor(f: Fila, c: string) {
  return f[c] ?? null;
}

vi.mock("@/lib/db", () => {
  const tabla = (nombre: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    const orden: Array<{ col: string; asc: boolean }> = [];
    let limite = Infinity;
    let una = false;
    let columnas = "";
    let cambio: Fila | null = null;
    const correr = () => {
      if (sinMigracion && /recording_|order_name/.test(columnas)) {
        return { data: null, error: { code: "42703", message: "column zadarma_calls.recording_attempts does not exist" } };
      }
      const filas = (tablas[nombre] ??= []);
      const elegidas = filas.filter((f) => filtros.every((ok) => ok(f)));
      if (cambio) {
        for (const f of elegidas) Object.assign(f, cambio);
        return { data: null, error: null };
      }
      const ordenadas = [...elegidas].sort((a, b) => {
        for (const { col, asc } of orden) {
          const va = valor(a, col);
          const vb = valor(b, col);
          if (va === vb) continue;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va < vb ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
      // Como PostgREST: solo las columnas pedidas.
      const campos = columnas && !columnas.includes("*") ? columnas.split(",").map((c) => c.trim()) : null;
      const salida = ordenadas
        .slice(0, limite)
        .map((f) => (campos ? Object.fromEntries(campos.filter((c) => c in f).map((c) => [c, f[c]])) : { ...f }));
      return una ? { data: salida[0] ?? null, error: null } : { data: salida, error: null };
    };
    const api: Record<string, unknown> = {
      select: (c: string) => ((columnas = c), api),
      eq: (c: string, v: unknown) => (filtros.push((f) => valor(f, c) === v), api),
      is: (c: string, v: unknown) => (filtros.push((f) => valor(f, c) === v), api),
      in: (c: string, vs: unknown[]) => (filtros.push((f) => vs.includes(valor(f, c))), api),
      lt: (c: string, v: number) => (filtros.push((f) => Number(valor(f, c) ?? 0) < v), api),
      not: (c: string, op: string, v: unknown) => (filtros.push((f) => !(op === "is" && valor(f, c) === v)), api),
      or: (expr: string) => {
        const partes = expr.split(",").map((p) => p.split(".not.is.null")[0]);
        filtros.push((f) => partes.some((c) => valor(f, c) !== null));
        return api;
      },
      order: (col: string, o: { ascending?: boolean } = {}) => (orden.push({ col, asc: o.ascending !== false }), api),
      limit: (n: number) => ((limite = n), api),
      maybeSingle: () => ((una = true), api),
      update: (f: Fila) => ((cambio = f), api),
      upsert: () => api,
      then: (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => Promise.resolve(correr()).then(ok, mal),
    };
    return api;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: ArrayBuffer, opts: Record<string, unknown>) => {
        if (falloSubida) return { data: null, error: { message: falloSubida } };
        subidas.push({ bucket, path, bytes: bytes.byteLength, opts });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string, ttl: number) => {
        firmadas.push({ bucket, path, ttl });
        return { data: { signedUrl: `https://supa.test/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null };
      },
    }),
  };
  return { getDB: () => ({ from: tabla, storage }) };
});

let yo: { id: number; nombre: string; permisos: string[]; tiendas: string[]; staffId: number | null } | null = null;
vi.mock("@/lib/identidad", () => ({
  identidadActual: () => yo,
  tiendasPermitidas: () => (yo ? yo.tiendas : null),
  vendedoraEfectiva: (v: unknown) => (Number(v) > 0 ? Number(v) : null),
  actorActual: () => "test",
  autorDeGestion: () => null,
}));

// ─── Proveedores simulados ──────────────────────────────────────────────────

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]);
const pedidos: Array<{ url: string; auth: string | null }> = [];
/** Respuesta por URL (sin query): status y tipo. */
let respuestas: Record<string, { status: number; tipo?: string; json?: unknown }> = {};

const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const headers = new Headers(init?.headers);
  pedidos.push({ url: u, auth: headers.get("authorization") });
  const r = respuestas[u.split("?")[0]];
  if (!r) return new Response("no", { status: 404 });
  if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  return new Response(r.status === 200 ? MP3 : "x", { status: r.status, headers: { "content-type": r.tipo ?? "audio/mpeg" } });
});

const CFG = { apiKey: "KEY_test", connectionId: "conn-1" };

function llamada(over: Fila): Fila {
  return {
    id: 1,
    provider: "telnyx",
    store_id: 1,
    started_at: "2026-11-05T15:00:00Z",
    created_at: "2026-11-05T15:00:00Z",
    is_recorded: true,
    recording_id: null,
    record_url: null,
    recording_path: null,
    recording_attempts: 0,
    recording_error: null,
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tablas)) delete tablas[k];
  subidas.length = 0;
  firmadas.length = 0;
  pedidos.length = 0;
  respuestas = {};
  falloSubida = null;
  sinMigracion = false;
  yo = null;
  vi.stubGlobal("fetch", fetchFalso);
});

// ─── Piezas puras ───────────────────────────────────────────────────────────

describe("piezas", () => {
  it("ruta en el bucket: tienda/año/mes/id de la llamada", async () => {
    const { rutaGrabacion } = await import("../lib/grabaciones");
    expect(rutaGrabacion({ id: 77, store_id: 2, started_at: "2026-01-31T23:59:00Z" })).toBe("2/2026/01/77.mp3");
    expect(rutaGrabacion({ id: 78, store_id: null, started_at: null, created_at: "2026-09-02T10:00:00Z" })).toBe(
      "sin-tienda/2026/09/78.mp3"
    );
  });

  it("los errores nunca guardan enlaces con firma", async () => {
    const { errorSinSecretos } = await import("../lib/grabaciones");
    const e = errorSinSecretos(new Error("fallo https://s3.aws/x.mp3?X-Amz-Signature=SECRETO&X-Amz-Expires=600 al bajar"));
    expect(e).not.toMatch(/SECRETO|s3\.aws|https?:/);
    expect(errorSinSecretos("x".repeat(1000)).length).toBe(300);
  });

  it("estado para la pantalla", async () => {
    const { estadoGrabacion } = await import("../lib/grabaciones");
    expect(estadoGrabacion({ is_recorded: true, recording_path: "1/2026/11/1.mp3" })).toBe("lista");
    expect(estadoGrabacion({ is_recorded: true, recording_path: null, recording_attempts: 2 })).toBe("procesando");
    expect(estadoGrabacion({ is_recorded: true, recording_path: null, recording_attempts: 6 })).toBe("no_disponible");
    expect(estadoGrabacion({ is_recorded: false })).toBeNull();
  });
});

// ─── Copiar ─────────────────────────────────────────────────────────────────

describe("copiar una grabacion", () => {
  it("con el enlace del webhook: baja el mp3 sin credenciales, lo sube al bucket privado y lo anota", async () => {
    const { copiarGrabacion } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ recording_id: "rec-1", recording_attempts: 2, recording_error: "antes" })];
    respuestas["https://s3.telnyx/rec.mp3"] = { status: 200 };
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { url: "https://s3.telnyx/rec.mp3?X-Amz-Signature=s", cfg: CFG });
    expect(r).toEqual({ ok: true, path: "1/2026/11/1.mp3" });
    expect(pedidos).toEqual([{ url: "https://s3.telnyx/rec.mp3?X-Amz-Signature=s", auth: null }]);
    expect(subidas).toEqual([
      { bucket: "call-recordings", path: "1/2026/11/1.mp3", bytes: MP3.byteLength, opts: { contentType: "audio/mpeg", upsert: true } },
    ]);
    expect(tablas.zadarma_calls[0]).toMatchObject({ recording_path: "1/2026/11/1.mp3", recording_error: null });
    expect(tablas.zadarma_calls[0].recording_saved_at).toEqual(expect.any(String));
  });

  it("sin enlace vigente pide uno nuevo a Telnyx con el recording_id", async () => {
    const { copiarGrabacion } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ recording_id: "rec-1", record_url: "https://s3.telnyx/viejo.mp3" })];
    respuestas["https://api.telnyx.com/v2/recordings/rec-1"] = {
      status: 200,
      json: { data: { id: "rec-1", download_urls: { mp3: "https://s3.telnyx/nuevo.mp3?sig=1" } } },
    };
    respuestas["https://s3.telnyx/nuevo.mp3"] = { status: 200 };
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { cfg: CFG });
    expect(r.ok).toBe(true);
    expect(pedidos.map((p) => [p.url.split("?")[0], p.auth])).toEqual([
      ["https://api.telnyx.com/v2/recordings/rec-1", "Bearer KEY_test"],
      ["https://s3.telnyx/nuevo.mp3", null],
    ]);
  });

  it("si falla la subida: anota el error (sin enlaces), suma un intento y no lanza", async () => {
    const { copiarGrabacion } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ recording_attempts: 1 })];
    respuestas["https://s3.telnyx/rec.mp3"] = { status: 200 };
    falloSubida = "Bucket not found";
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { url: "https://s3.telnyx/rec.mp3?X-Amz-Signature=s", cfg: CFG });
    expect(r).toMatchObject({ ok: false, definitivo: false });
    expect(tablas.zadarma_calls[0]).toMatchObject({ recording_path: null, recording_attempts: 2 });
    expect(String(tablas.zadarma_calls[0].recording_error)).toContain("Bucket not found");
  });

  it("un enlace vencido (4xx) es definitivo: no se reintenta y el error no guarda el enlace", async () => {
    const { copiarGrabacion, MAX_INTENTOS_GRABACION } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ provider: "zadarma", record_url: "https://api.zadarma.com/rec/abc.mp3?sign=SECRETO" })];
    respuestas["https://api.zadarma.com/rec/abc.mp3"] = { status: 403 };
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { cfg: null });
    expect(r).toMatchObject({ ok: false, definitivo: true });
    expect(tablas.zadarma_calls[0].recording_attempts).toBe(MAX_INTENTOS_GRABACION);
    expect(String(tablas.zadarma_calls[0].recording_error)).toBe("descarga: HTTP 403");
    expect(subidas).toEqual([]);
  });

  it("un 200 que no es audio (pagina de error) no se guarda como grabacion", async () => {
    const { copiarGrabacion } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ provider: "zadarma", record_url: "https://api.zadarma.com/rec/x.mp3" })];
    respuestas["https://api.zadarma.com/rec/x.mp3"] = { status: 200, tipo: "text/html; charset=utf-8" };
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { cfg: null });
    expect(r).toMatchObject({ ok: false, definitivo: true });
    expect(subidas).toEqual([]);
  });

  it("un 5xx del proveedor se reintenta despues", async () => {
    const { copiarGrabacion } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [llamada({ recording_id: "rec-1" })];
    respuestas["https://api.telnyx.com/v2/recordings/rec-1"] = { status: 503, json: { errors: [{ detail: "down" }] } };
    const r = await copiarGrabacion(tablas.zadarma_calls[0] as never, { cfg: CFG });
    expect(r).toMatchObject({ ok: false, definitivo: false });
    expect(tablas.zadarma_calls[0].recording_attempts).toBe(1);
  });
});

// ─── Cron ───────────────────────────────────────────────────────────────────

describe("cron call-recordings", () => {
  function telnyx(id: number, over: Fila = {}) {
    return llamada({ id, recording_id: `rec-${id}`, started_at: `2026-11-0${id}T15:00:00Z`, ...over });
  }
  function fresca(id: number) {
    respuestas[`https://api.telnyx.com/v2/recordings/rec-${id}`] = {
      status: 200,
      json: { data: { download_urls: { mp3: `https://s3.telnyx/${id}.mp3?sig=x` } } },
    };
    respuestas[`https://s3.telnyx/${id}.mp3`] = { status: 200 };
  }

  it("copia las pendientes de Telnyx con enlace nuevo, la mas reciente primero, y respeta el tope", async () => {
    const { copiarGrabacionesPendientes } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [
      telnyx(1),
      telnyx(2),
      telnyx(3),
      telnyx(4, { recording_path: "1/2026/11/4.mp3" }), // ya copiada
      telnyx(5, { is_recorded: false, recording_id: null }), // sin grabacion
      telnyx(6, { recording_attempts: 6 }), // dada por perdida
    ];
    [1, 2, 3, 6].forEach(fresca);
    const r = await copiarGrabacionesPendientes({ cfg: CFG, limite: 2, hastaMs: Date.now() + 60_000 });
    expect(r).toMatchObject({ ok: true, telnyx: { copiadas: 2, fallidas: 0 }, zadarma: { copiadas: 0, fallidas: 0 } });
    expect(subidas.map((s) => s.path)).toEqual(["1/2026/11/3.mp3", "1/2026/11/2.mp3"]);
    expect(pedidos.filter((p) => p.url.includes("/recordings/")).map((p) => p.url)).toEqual([
      "https://api.telnyx.com/v2/recordings/rec-3",
      "https://api.telnyx.com/v2/recordings/rec-2",
    ]);
  });

  it("con cupo sobrante intenta las de Zadarma con enlace; las vencidas quedan marcadas y no vuelven", async () => {
    const { copiarGrabacionesPendientes } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [
      llamada({ id: 20, provider: "zadarma", record_url: "https://api.zadarma.com/rec/20.mp3?s=1", started_at: "2026-09-20T10:00:00Z" }),
      llamada({ id: 21, provider: "zadarma", record_url: "https://api.zadarma.com/rec/21.mp3?s=1", started_at: "2026-07-01T10:00:00Z" }),
      llamada({ id: 22, provider: "zadarma", record_url: null, started_at: "2026-09-21T10:00:00Z" }),
    ];
    respuestas["https://api.zadarma.com/rec/20.mp3"] = { status: 200 };
    respuestas["https://api.zadarma.com/rec/21.mp3"] = { status: 404 };
    const r1 = await copiarGrabacionesPendientes({ cfg: CFG, limite: 10, hastaMs: Date.now() + 60_000 });
    expect(r1.zadarma).toEqual({ copiadas: 1, fallidas: 1 });
    expect(subidas.map((s) => s.path)).toEqual(["1/2026/09/20.mp3"]);
    pedidos.length = 0;
    const r2 = await copiarGrabacionesPendientes({ cfg: CFG, limite: 10, hastaMs: Date.now() + 60_000 });
    expect(r2.zadarma).toEqual({ copiadas: 0, fallidas: 0 });
    expect(pedidos).toEqual([]);
  });

  it("sin TELNYX_API_KEY no toca las de Telnyx (sin gastarles intentos), pero si las de Zadarma", async () => {
    const { copiarGrabacionesPendientes } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [
      telnyx(1),
      llamada({ id: 20, provider: "zadarma", record_url: "https://api.zadarma.com/rec/20.mp3" }),
    ];
    respuestas["https://api.zadarma.com/rec/20.mp3"] = { status: 200 };
    const r = await copiarGrabacionesPendientes({ cfg: null, limite: 10, hastaMs: Date.now() + 60_000 });
    expect(r).toMatchObject({ telnyx_sin_llave: true, telnyx: { copiadas: 0, fallidas: 0 }, zadarma: { copiadas: 1 } });
    expect(tablas.zadarma_calls[0].recording_attempts).toBe(0);
  });

  it("sin tiempo no empieza otra copia", async () => {
    const { copiarGrabacionesPendientes } = await import("../lib/grabaciones");
    tablas.zadarma_calls = [telnyx(1), telnyx(2)];
    [1, 2].forEach(fresca);
    let t = 0;
    const r = await copiarGrabacionesPendientes({ cfg: CFG, limite: 10, hastaMs: 1, ahora: () => t++ });
    expect(r).toMatchObject({ sin_tiempo: true, telnyx: { copiadas: 1 } });
  });

  it("sin la migracion responde ok sin hacer nada y dice que falta", async () => {
    const { copiarGrabacionesPendientes } = await import("../lib/grabaciones");
    sinMigracion = true;
    const r = await copiarGrabacionesPendientes({ cfg: CFG, limite: 10, hastaMs: Date.now() + 60_000 });
    expect(r).toMatchObject({ ok: true, pendiente_migracion: expect.stringContaining("20261107130000_call_recordings.sql") });
  });

  it("la ruta del cron usa TELNYX_API_KEY y anota la corrida", async () => {
    delete process.env.TELNYX_API_KEY;
    tablas.zadarma_calls = [telnyx(1)];
    const { GET } = await import("../app/api/cron/call-recordings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, telnyx_sin_llave: true });
  });
});

// ─── Escuchar ───────────────────────────────────────────────────────────────

describe("GET /api/calls/[id]/recording", () => {
  async function escuchar(id: string) {
    const { GET } = await import("../app/api/calls/[id]/recording/route");
    return GET(new NextRequest(`http://localhost/api/calls/${id}/recording`), { params: { id } });
  }
  const asesoraCR = { id: 3, nombre: "Daleska", permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 7 };

  beforeEach(() => {
    tablas.zadarma_calls = [
      llamada({ id: 1, recording_path: "1/2026/11/1.mp3" }),
      llamada({ id: 2, recording_path: null }),
      llamada({ id: 3, is_recorded: false }),
      llamada({ id: 4, store_id: 2, recording_path: "2/2026/11/4.mp3" }),
      llamada({ id: 5, store_id: null, recording_path: "sin-tienda/2026/09/5.mp3" }),
    ];
  });

  it("copiada: redirige a una URL firmada de 10 minutos, sin cache", async () => {
    yo = asesoraCR;
    const res = await escuchar("1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://supa.test/storage/v1/object/sign/call-recordings/1/2026/11/1.mp3?token=t");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(firmadas).toEqual([{ bucket: "call-recordings", path: "1/2026/11/1.mp3", ttl: 600 }]);
  });

  it("grabada pero todavia no copiada: 409 'Grabación procesándose' (nunca el enlace del proveedor)", async () => {
    yo = asesoraCR;
    tablas.zadarma_calls[1].record_url = "https://s3.telnyx/x.mp3?sig=1";
    const res = await escuchar("2");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Grabación procesándose" });
    expect(firmadas).toEqual([]);
  });

  it("sin grabacion: 404", async () => {
    yo = asesoraCR;
    expect((await escuchar("3")).status).toBe(404);
    expect((await escuchar("999")).status).toBe(404);
  });

  it("de una tienda que no es suya: 403 y no firma nada", async () => {
    yo = asesoraCR;
    expect((await escuchar("4")).status).toBe(403);
    // Sin tienda: solo quien tiene todas.
    expect((await escuchar("5")).status).toBe(403);
    expect(firmadas).toEqual([]);
    yo = { ...asesoraCR, permisos: ["pedidos"], tiendas: ["mireva-cr", "mireva-hn"] };
    expect((await escuchar("4")).status).toBe(302);
    expect((await escuchar("5")).status).toBe(302);
  });

  it("sin un permiso que vea llamadas: 403; sin sesion: 401; id raro: 400", async () => {
    yo = { ...asesoraCR, permisos: ["marketing"] };
    expect((await escuchar("1")).status).toBe(403);
    yo = { ...asesoraCR, permisos: ["novedades"] };
    expect((await escuchar("1")).status).toBe(302);
    yo = null;
    expect((await escuchar("1")).status).toBe(401);
    yo = asesoraCR;
    expect((await escuchar("1;drop")).status).toBe(400);
  });

  it("la regla del middleware: Leads, Gestion y Novedades", async () => {
    const { exigenciaDe } = await import("../lib/permisos");
    expect(exigenciaDe("/api/calls/12/recording")).toEqual({
      tipo: "permiso",
      alguno: ["leads", "leads_equipo", "pedidos", "finanzas", "novedades"],
    });
    // La otra ruta de /api/calls sigue igual.
    expect(exigenciaDe("/api/calls/trigger")).toEqual({ tipo: "permiso", alguno: ["panel"] });
  });
});

// ─── Historial del lead ─────────────────────────────────────────────────────

describe("historial del lead", () => {
  it("cada llamada dice si se puede escuchar; sin la migracion, las llamadas igual", async () => {
    const { getLeadHistory } = await import("../lib/leads");
    tablas.lead_calls = [];
    tablas.payroll_staff = [{ id: 7, name: "Daleska" }];
    tablas.zadarma_calls = [
      llamada({ id: 1, lead_id: 5, status: "answered", duration_seconds: 30, vendedora: 7, recording_path: "1/2026/11/1.mp3" }),
      llamada({ id: 2, lead_id: 5, status: "answered", duration_seconds: 30, vendedora: 7, started_at: "2026-11-06T15:00:00Z" }),
      llamada({ id: 3, lead_id: 5, status: "busy", is_recorded: false, started_at: "2026-11-04T15:00:00Z" }),
    ];
    const h = await getLeadHistory(1, 5);
    expect(h.map((r) => [r.id, r.kind, r.grabacion])).toEqual([
      [2, "phone", "procesando"],
      [1, "phone", "lista"],
      [3, "phone", null],
    ]);
    expect(JSON.stringify(h)).not.toContain(".mp3");

    sinMigracion = true;
    const sin = await getLeadHistory(1, 5);
    expect(sin.map((r) => [r.id, r.grabacion])).toEqual([[2, null], [1, null], [3, null]]);
  });
});
