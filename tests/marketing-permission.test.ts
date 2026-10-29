import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISOS, PERMISO_INFO, cumple, exigenciaDe, inicioDe, normalizarPermisos, pantallasDe, permisosDeRoles } from "../lib/permisos";
import { firmarSesion, identidadDeHeader, leerSesion, SESSION_COOKIE, type SesionClaims } from "../lib/auth";
import { aplicarEstado, limpiarCache } from "../lib/sesion-revalidar";
import { validarAcceso } from "../lib/usuarios-validar";
import { middleware } from "../middleware";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); limpiarCache(); });
const claims = (overrides: Partial<SesionClaims> = {}): SesionClaims => ({
  u: 0, n: "Administrador", p: ["usuarios"], s: ["mireva-cr"], st: null, sv: 1, mc: false,
  exp: Math.floor(Date.now() / 1000) + 3600, ...overrides,
});

describe("independent Marketing access", () => {
  it("offers a valid Marketing checkbox and saves it without financial permissions or an adviser", () => {
    expect(PERMISOS).toContain("marketing");
    expect(PERMISO_INFO.marketing.label).toBe("Marketing");
    expect(normalizarPermisos(["marketing", "marketing", "unknown"])).toEqual(["marketing"]);
    expect(validarAcceso({ nombre: "Marketing CR", roles: [], permisos: ["marketing"], tiendas: ["mireva-cr"], staff_id: null })).toMatchObject({
      datos: { permisos: ["marketing"], tiendas: ["mireva-cr"], staff_id: null },
    });
  });

  it("opens the dashboard and its readers without granting finance, orders, settings or user administration", () => {
    const permissions = ["marketing"] as const;
    expect(pantallasDe(permissions).map(page => page.ruta)).toEqual(["/admin/marketing"]);
    expect(inicioDe(permissions)).toBe("/admin/marketing");
    for (const route of ["/admin/marketing", "/api/marketing/summary", "/api/marketing/sources"]) {
      expect(cumple(exigenciaDe(route), permissions), route).toBe(true);
      expect(cumple(exigenciaDe(route), ["finanzas"]), route).toBe(false);
      expect(cumple(exigenciaDe(route), []), route).toBe(false);
    }
    for (const route of ["/admin/finance", "/api/finance/orders", "/api/finance/expenses", "/api/finance/product-costs", "/api/users", "/admin/settings"]) {
      expect(cumple(exigenciaDe(route), permissions), route).toBe(false);
    }
    expect(permisosDeRoles(["admin"])).toContain("marketing");
  });

  it("applies grants and revocations to a normal user's revalidated session", () => {
    const original = claims({ u: 7, p: ["panel"] });
    const state = { activo: true, sv: 1, nombre: "Marketing CR", permisos: ["marketing"], tiendas: ["mireva-cr"], staffId: null, debeCambiar: false };
    expect(aplicarEstado(original, state)?.p).toEqual(["marketing"]);
    expect(aplicarEstado({ ...original, p: ["marketing"] }, { ...state, permisos: ["panel"] })?.p).toEqual(["panel"]);
  });

  it("refreshes the full catalog only for a verified legacy admin, preserving expiration", async () => {
    vi.stubEnv("AUTH_SECRET", "marketing-permission-test-secret");
    const old = claims();
    expect(await leerSesion(await firmarSesion(old))).toMatchObject({ p: [...PERMISOS], exp: old.exp });
    const normal = claims({ u: 7, p: ["finanzas"] });
    expect(await leerSesion(await firmarSesion(normal))).toMatchObject({ p: ["finanzas"] });
  });

  it("keeps the store boundary enforced by middleware after Marketing is available", async () => {
    vi.stubEnv("AUTH_SECRET", "marketing-permission-test-secret");
    vi.stubEnv("SUPABASE_URL", "https://database.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    limpiarCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      activo: true, session_version: 1, nombre: "Marketing CR", permisos: ["marketing"], tiendas: ["mireva-cr"], staff_id: null, debe_cambiar_clave: false,
    }]), { status: 200 })));
    const cookie = await firmarSesion(claims({ u: 77, p: ["marketing"] }));
    const request = (store: string) => new NextRequest(`https://kairo.test/api/marketing/sources?store=${store}&month=2026-10`, {
      headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
    });
    const allowed = await middleware(request("mireva-cr"));
    expect(allowed.status).toBe(200);
    expect(identidadDeHeader(allowed.headers.get("x-middleware-request-x-kairo-usuario"))?.permisos).toEqual(["marketing"]);
    expect((await middleware(request("mireva-hn"))).status).toBe(403);
    const denied = await middleware(new NextRequest("https://kairo.test/api/finance/expenses?store=mireva-cr", { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } }));
    expect(denied.status).toBe(403);
  });
});
