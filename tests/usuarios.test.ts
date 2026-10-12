// Contraseñas, bloqueo por intentos, validaciones y restricciones por persona.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashClave, problemaDeClave, problemaDeUsuario, trasFallo, verificarClave, MAX_INTENTOS } from "../lib/usuarios";
import { validarAcceso } from "../lib/usuarios-validar";

let headerIdentidad: string | null = null;
vi.mock("next/headers", () => ({
  headers: () => ({ get: (k: string) => (k === "x-kairo-usuario" ? headerIdentidad : null) }),
}));

function como(yo: { id: number; permisos: string[]; tiendas: string[]; staffId: number | null } | null) {
  headerIdentidad = yo ? encodeURIComponent(JSON.stringify({ nombre: "x", ...yo })) : null;
}

beforeEach(() => como(null));

describe("contraseñas", () => {
  it("se guarda el hash, nunca la contraseña, y verifica bien", async () => {
    const h = await hashClave("Mireva-2026!");
    expect(h).not.toContain("Mireva-2026!");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verificarClave("Mireva-2026!", h)).toBe(true);
    expect(await verificarClave("mireva-2026!", h)).toBe(false);
  });

  it("la misma contraseña da hashes distintos (sal propia)", async () => {
    expect(await hashClave("Una-clave-buena")).not.toBe(await hashClave("Una-clave-buena"));
  });

  it("rechaza contraseñas cortas, obvias o que contienen el usuario", () => {
    expect(problemaDeClave("corta")).toMatch(/8/);
    expect(problemaDeClave("12345678")).toMatch(/fácil/);
    expect(problemaDeClave("susan2026!", "susan")).toMatch(/usuario/);
    expect(problemaDeClave("Rio-Celeste-44")).toBeNull();
  });

  it("usuarios: minuscula, sin espacios, y 'admin' reservado", () => {
    expect(problemaDeUsuario("susan")).toBeNull();
    expect(problemaDeUsuario("susan perez")).not.toBeNull();
    expect(problemaDeUsuario("admin")).toMatch(/reservado/);
  });
});

describe("bloqueo por intentos", () => {
  it(`al ${MAX_INTENTOS}º fallo seguido bloquea 15 minutos`, () => {
    const ahora = new Date("2026-10-12T15:00:00Z");
    expect(trasFallo(MAX_INTENTOS - 2, ahora)).toEqual({ intentos: MAX_INTENTOS - 1, bloqueadoHasta: null });
    expect(trasFallo(MAX_INTENTOS - 1, ahora)).toEqual({ intentos: 0, bloqueadoHasta: "2026-10-12T15:15:00.000Z" });
  });
});

describe("validarAcceso", () => {
  const ok = { nombre: "Susan", roles: ["asesora"], permisos: ["leads"], tiendas: ["mireva-cr"], staff_id: 3 };

  it("acepta una asesora completa", () => {
    expect(validarAcceso(ok)).toEqual({ datos: { ...ok, email: null, roles: ["asesora"] } });
  });
  it("exige al menos una pantalla y una tienda", () => {
    expect(validarAcceso({ ...ok, permisos: [] })).toHaveProperty("error");
    expect(validarAcceso({ ...ok, tiendas: [] })).toHaveProperty("error");
  });
  it("una asesora sin supervision TIENE que estar vinculada a la planilla", () => {
    expect(validarAcceso({ ...ok, staff_id: null })).toEqual({ error: expect.stringMatching(/planilla/) });
    // Supervision puede no estar vinculada.
    expect(validarAcceso({ ...ok, permisos: ["leads", "leads_equipo"], staff_id: null })).toHaveProperty("datos");
  });
  it("descarta permisos y tiendas que no existen", () => {
    const r = validarAcceso({ ...ok, permisos: ["leads", "dios"], tiendas: ["mireva-cr", "mireva-mx"] });
    expect(r).toMatchObject({ datos: { permisos: ["leads"], tiendas: ["mireva-cr"] } });
  });
});

describe("la asesora queda SIEMPRE a su nombre", () => {
  it("una asesora no puede registrar a nombre de otra", async () => {
    const { vendedoraEfectiva } = await import("../lib/identidad");
    como({ id: 7, permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 3 });
    expect(vendedoraEfectiva(12)).toBe(3);
  });
  it("supervision si puede elegir", async () => {
    const { vendedoraEfectiva } = await import("../lib/identidad");
    como({ id: 8, permisos: ["leads", "leads_equipo"], tiendas: ["mireva-cr"], staffId: 1 });
    expect(vendedoraEfectiva(12)).toBe(12);
  });
  it("un proceso del sistema (sin persona) usa lo que viene", async () => {
    const { vendedoraEfectiva } = await import("../lib/identidad");
    expect(vendedoraEfectiva(12)).toBe(12);
    expect(vendedoraEfectiva("x")).toBeNull();
  });
});

describe("tiendas", () => {
  it("una tienda ajena se trata como inexistente (aunque venga en el cuerpo del pedido)", async () => {
    const { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } = await import("../lib/stores");
    como({ id: 7, permisos: ["leads"], tiendas: ["mireva-cr"], staffId: 3 });
    expect(getRequiredStoreFromBody({ store: "mireva-hn" })).toBeNull();
    expect(getRequiredStoreFromBody({ store: "mireva-cr" })?.code).toBe("mireva-cr");
    expect(getRequiredStoreFromSearchParams(new URLSearchParams("store=mireva-hn"))).toBeNull();
  });
  it("sin tienda, cae en la primera PERMITIDA (no siempre en Costa Rica)", async () => {
    const { getStoreFromSearchParams, getStoreFromBody } = await import("../lib/stores");
    como({ id: 9, permisos: ["leads"], tiendas: ["mireva-hn"], staffId: 4 });
    expect(getStoreFromSearchParams(new URLSearchParams()).code).toBe("mireva-hn");
    expect(getStoreFromBody({ store: "mireva-cr" }).code).toBe("mireva-hn");
  });
  it("un proceso del sistema no tiene restriccion", async () => {
    const { getRequiredStoreFromBody } = await import("../lib/stores");
    expect(getRequiredStoreFromBody({ store: "mireva-hn" })?.code).toBe("mireva-hn");
  });
});
