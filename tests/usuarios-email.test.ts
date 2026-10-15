// Entrar con el correo (además del usuario corto) y cuentas creadas sin
// contraseña, que el dueño completa desde Usuarios.

import { beforeEach, describe, expect, it, vi } from "vitest";

const filtros: Array<[string, unknown]> = [];
let fila: object | null = null;

vi.mock("../lib/db", () => ({
  getDB: () => {
    const q: Record<string, unknown> = {};
    const encadenar = () => q;
    Object.assign(q, {
      from: encadenar,
      select: encadenar,
      update: encadenar,
      insert: encadenar,
      order: encadenar,
      eq: (columna: string, valor: unknown) => {
        filtros.push([columna, valor]);
        return q;
      },
      maybeSingle: async () => ({ data: fila, error: null }),
      single: async () => ({ data: fila, error: null }),
    });
    return q;
  },
}));

import { aPublico, hashClave, ingresar, normalizarEmail, problemaDeEmail, SIN_CLAVE, type UsuarioFila } from "../lib/usuarios";
import { validarAcceso } from "../lib/usuarios-validar";

async function leny(passwordHash?: string): Promise<UsuarioFila> {
  return {
    id: 7,
    username: "leny",
    email: "lenilef20@gmail.com",
    nombre: "Leny",
    password_hash: passwordHash ?? (await hashClave("Rio-Celeste-44")),
    roles: ["asesora"],
    permisos: ["leads"],
    tiendas: ["mireva-cr", "mireva-hn"],
    staff_id: 2,
    activo: true,
    debe_cambiar_clave: true,
    session_version: 1,
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    ultimo_ingreso: null,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
  };
}

beforeEach(() => {
  filtros.length = 0;
  fila = null;
});

describe("entrar con el correo", () => {
  it("busca por correo si trae @, escrito como sea", async () => {
    fila = await leny();
    const r = await ingresar("  Lenilef20@Gmail.com ", "Rio-Celeste-44");
    expect(r.ok).toBe(true);
    expect(filtros[0]).toEqual(["email", "lenilef20@gmail.com"]);
  });

  it("sigue entrando con el usuario corto", async () => {
    fila = await leny();
    const r = await ingresar("Leny", "Rio-Celeste-44");
    expect(r.ok).toBe(true);
    expect(filtros[0]).toEqual(["username", "leny"]);
  });
});

describe("cuenta creada sin contraseña", () => {
  it("no deja entrar con ninguna contraseña hasta que el dueño le ponga una", async () => {
    fila = await leny(SIN_CLAVE);
    for (const intento of ["", "pendiente", "Rio-Celeste-44"]) {
      expect(await ingresar("leny", intento)).toMatchObject({ ok: false, motivo: "credenciales" });
    }
  });

  it("la pantalla de usuarios la marca, sin mostrar nunca el hash", async () => {
    const pendiente = aPublico(await leny(SIN_CLAVE));
    expect(pendiente.sin_clave).toBe(true);
    expect(pendiente).not.toHaveProperty("password_hash");
    expect(aPublico(await leny()).sin_clave).toBe(false);
  });
});

describe("validación del correo", () => {
  it("se guarda en minúscula y vacío queda sin correo", () => {
    expect(normalizarEmail(" Stefanno.Job@Gmail.com ")).toBe("stefanno.job@gmail.com");
    expect(normalizarEmail("")).toBeNull();
    expect(normalizarEmail(undefined)).toBeNull();
  });

  it("rechaza lo que no es un correo", () => {
    expect(problemaDeEmail("leny")).toMatch(/correo/);
    expect(problemaDeEmail("leny@gmail")).toMatch(/correo/);
    expect(problemaDeEmail("le ny@gmail.com")).toMatch(/correo/);
    expect(problemaDeEmail("lenilef20@gmail.com")).toBeNull();
    expect(problemaDeEmail(null)).toBeNull();
  });

  it("validarAcceso lo normaliza y frena uno inválido", () => {
    const base = { nombre: "Leny", roles: ["asesora"], permisos: ["leads"], tiendas: ["mireva-cr"], staff_id: 2 };
    expect(validarAcceso({ ...base, email: "LeniLef20@gmail.com" })).toMatchObject({ datos: { email: "lenilef20@gmail.com" } });
    expect(validarAcceso({ ...base, email: "no-es-correo" })).toEqual({ error: "El correo no es válido." });
  });
});
