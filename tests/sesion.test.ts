// Sesion firmada, revalidacion contra la base y la puerta del middleware.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  claimsAdminLegado,
  esClaveAdminLegado,
  firmarSesion,
  HEADER_USUARIO,
  identidadDeHeader,
  leerSesion,
  SESSION_COOKIE,
  type SesionClaims,
} from "../lib/auth";
import { aplicarEstado, limpiarCache } from "../lib/sesion-revalidar";

const AHORA = 1_800_000_000;

function claims(over: Partial<SesionClaims> = {}): SesionClaims {
  return { u: 7, n: "Susan", p: ["leads"], s: ["mireva-cr"], st: 3, sv: 1, mc: false, exp: AHORA + 3600, ...over };
}

beforeEach(() => {
  process.env.AUTH_SECRET = "secreto-de-prueba";
  process.env.ADMIN_PASSWORD = "clave-compartida-larga";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  limpiarCache();
});

describe("cookie firmada", () => {
  it("lo que se firma se lee igual", async () => {
    const c = claims();
    expect(await leerSesion(await firmarSesion(c), AHORA)).toEqual(c);
  });

  it("NADIE puede darse permisos editando la cookie", async () => {
    const valor = await firmarSesion(claims());
    const [pre, payload, firma] = valor.split(".");
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    json.p = ["leads", "finanzas", "usuarios"];
    const trucho = Buffer.from(JSON.stringify(json)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await leerSesion(`${pre}.${trucho}.${firma}`, AHORA)).toBeNull();
  });

  it("una cookie vencida no vale", async () => {
    expect(await leerSesion(await firmarSesion(claims({ exp: AHORA - 1 })), AHORA)).toBeNull();
  });

  it("firmada con otro secreto no vale", async () => {
    const valor = await firmarSesion(claims());
    process.env.AUTH_SECRET = "otro";
    expect(await leerSesion(valor, AHORA)).toBeNull();
  });

  it("la cookie VIEJA compartida (antes del 12/10) ya no vale", async () => {
    expect(await leerSesion("kairo-admin.abcdef0123", AHORA)).toBeNull();
  });

  it("la clave compartida solo sirve tal cual", () => {
    expect(esClaveAdminLegado("clave-compartida-larga")).toBe(true);
    expect(esClaveAdminLegado("clave-compartida-larg")).toBe(false);
    expect(esClaveAdminLegado("")).toBe(false);
  });

  it("el admin de la clave compartida tiene todo en todas las tiendas", () => {
    const c = claimsAdminLegado(["mireva-cr", "mireva-hn"], AHORA);
    expect(c.u).toBe(0);
    expect(c.p).toContain("usuarios");
    expect(c.s).toEqual(["mireva-cr", "mireva-hn"]);
  });
});

describe("aplicarEstado (lo que dice la base manda sobre la cookie)", () => {
  const base = { activo: true, sv: 1, nombre: "Susan", permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 3, debeCambiar: false };

  it("desactivada: la sesion deja de valer", () => {
    expect(aplicarEstado(claims(), { ...base, activo: false })).toBeNull();
  });
  it("contraseña reseteada (version nueva): deja de valer", () => {
    expect(aplicarEstado(claims(), { ...base, sv: 2 })).toBeNull();
  });
  it("borrada: deja de valer", () => {
    expect(aplicarEstado(claims(), null)).toBeNull();
  });
  it("permisos y tiendas nuevos se aplican sin volver a entrar", () => {
    const r = aplicarEstado(claims(), { ...base, permisos: ["leads", "novedades"], tiendas: ["mireva-hn"] });
    expect(r?.p).toEqual(["leads", "novedades"]);
    expect(r?.s).toEqual(["mireva-hn"]);
  });
  it("si la base no responde, sigue con lo firmado (una caida no deja a todos afuera)", () => {
    expect(aplicarEstado(claims(), "sin_datos")).toEqual(claims());
  });
});

// ── El middleware entero ─────────────────────────────────────────────────────

async function pedir(ruta: string, opts: { cookie?: string; metodo?: string; headers?: Record<string, string> } = {}) {
  const { middleware } = await import("../middleware");
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", `${SESSION_COOKIE}=${opts.cookie}`);
  return middleware(new NextRequest(`http://localhost${ruta}`, { method: opts.metodo ?? "GET", headers }));
}

function identidadPasada(res: Response): ReturnType<typeof identidadDeHeader> {
  return identidadDeHeader(res.headers.get(`x-middleware-request-${HEADER_USUARIO}`));
}

describe("middleware", () => {
  afterEach(() => vi.useRealTimers());

  it("sin sesion: la API responde 401 y las paginas mandan al login", async () => {
    expect((await pedir("/api/leads?store=mireva-cr")).status).toBe(401);
    const res = await pedir("/admin/leads");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Fadmin%2Fleads");
  });

  it("una asesora entra a Leads pero NO a Finanzas ni a usuarios", async () => {
    const cookie = await firmarSesion(claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    expect((await pedir("/api/leads?store=mireva-cr", { cookie })).status).toBe(200);
    expect((await pedir("/api/finance/settlements?store=mireva-cr", { cookie })).status).toBe(403);
    expect((await pedir("/api/users", { cookie })).status).toBe(403);
    // La pagina de finanzas la manda a su inicio, no le muestra un error.
    const pag = await pedir("/admin/finance", { cookie });
    expect(pag.headers.get("location")).toContain("/admin/leads");
  });

  it("NO puede pedir datos de una tienda que no es suya", async () => {
    const cookie = await firmarSesion(claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    const res = await pedir("/api/leads?store=mireva-hn", { cookie });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("tienda");
  });

  it("la ruta recibe la identidad, y el navegador NO puede inventarla", async () => {
    const cookie = await firmarSesion(claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    const falsa = encodeURIComponent(JSON.stringify({ id: 0, nombre: "x", permisos: ["usuarios"], tiendas: ["mireva-hn"], staffId: null }));
    const res = await pedir("/api/leads?store=mireva-cr", { cookie, headers: { [HEADER_USUARIO]: falsa } });
    expect(identidadPasada(res)).toMatchObject({ id: 7, permisos: ["leads"], staffId: 3 });
  });

  it("en una ruta publica el header de identidad que manda el navegador se borra", async () => {
    const falsa = encodeURIComponent(JSON.stringify({ id: 0, permisos: ["usuarios"] }));
    const res = await pedir("/api/shopify/webhook", { metodo: "POST", headers: { [HEADER_USUARIO]: falsa } });
    expect(identidadPasada(res)).toBeNull();
  });

  it("con contraseña inicial pendiente, primero la cambia", async () => {
    const cookie = await firmarSesion(claims({ mc: true, exp: Math.floor(Date.now() / 1000) + 600 }));
    expect((await pedir("/admin/leads", { cookie })).headers.get("location")).toContain("/cuenta");
    expect((await pedir("/api/leads?store=mireva-cr", { cookie })).status).toBe(403);
    expect((await pedir("/api/auth/password", { cookie, metodo: "POST" })).status).toBe(200);
  });

  it("logueada, /login la manda a su inicio", async () => {
    const cookie = await firmarSesion(claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    expect((await pedir("/login", { cookie })).headers.get("location")).toContain("/admin/leads");
  });

  it("si la base dice que la desactivaron, la saca aunque la cookie sea valida", async () => {
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ activo: false, session_version: 1, nombre: "Susan", permisos: ["leads"], tiendas: ["mireva-cr"], staff_id: 3, debe_cambiar_clave: false }]), { status: 200 })) as typeof fetch;
    try {
      const cookie = await firmarSesion(claims({ u: 99, exp: Math.floor(Date.now() / 1000) + 600 }));
      const res = await pedir("/api/leads?store=mireva-cr", { cookie });
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

describe("cookie legible del navegador (kairo_yo)", () => {
  it("lo que escribe el middleware se lee en el navegador (Next codifica una sola vez)", async () => {
    const { yoDeCookie, yoACookie } = await import("../lib/sesion-cliente");
    const yo = { id: 7, nombre: "Susan Pérez", permisos: ["leads" as const], tiendas: ["mireva-cr"], staffId: 3, debeCambiar: false };
    // Asi la guarda el navegador: el valor codificado UNA vez por Next.
    const enDocumentCookie = encodeURIComponent(yoACookie(yo));
    expect(yoDeCookie(enDocumentCookie)).toEqual(yo);
  });

  it("el middleware la deja en las paginas, no en la API", async () => {
    const cookie = await firmarSesion(claims({ exp: Math.floor(Date.now() / 1000) + 600 }));
    const pagina = await pedir("/admin/leads", { cookie });
    expect(pagina.headers.get("set-cookie")).toContain("kairo_yo=");
    const api = await pedir("/api/leads?store=mireva-cr", { cookie });
    expect(api.headers.get("set-cookie") ?? "").not.toContain("kairo_yo=");
  });
});

describe("cache de la revalidacion", () => {
  it("tras cambiar la contraseña (cookie con version nueva) NO la deja afuera por la cache vieja", async () => {
    const { consultarEstado } = await import("../lib/sesion-revalidar");
    process.env.SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    let version = 1;
    let llamadas = 0;
    const fake = (async () => {
      llamadas++;
      return new Response(JSON.stringify([{ activo: true, session_version: version, nombre: "S", permisos: ["leads"], tiendas: ["mireva-cr"], staff_id: 3, debe_cambiar_clave: version === 1 }]));
    }) as typeof fetch;
    const t = 1_000_000;
    expect(await consultarEstado(50, t, fake, 1)).toMatchObject({ sv: 1, debeCambiar: true });
    // Cambia la contraseña: la base y la cookie pasan a version 2.
    version = 2;
    expect(await consultarEstado(50, t + 1000, fake, 2)).toMatchObject({ sv: 2, debeCambiar: false });
    expect(llamadas).toBe(2);
    // Con la misma version, dentro de los 30 s, usa la cache.
    await consultarEstado(50, t + 2000, fake, 2);
    expect(llamadas).toBe(2);
  });
});
