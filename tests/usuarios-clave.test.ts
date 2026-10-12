// El dueño le cambia la contraseña a un trabajador cuando le falla.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const actualizar = vi.fn();
vi.mock("@/lib/usuarios", async (orig) => {
  const real = await orig<typeof import("../lib/usuarios")>();
  return {
    ...real,
    buscarPorId: async () => ({ id: 5, username: "susan", session_version: 3 }),
    actualizarUsuario: (...a: unknown[]) => actualizar(...a),
    registrarEvento: async () => undefined,
  };
});
vi.mock("@/lib/identidad", () => ({ actorActual: () => "Dueño" }));

async function cambiar(body: Record<string, unknown>) {
  const { POST } = await import("../app/api/users/[id]/clave/route");
  return POST(new NextRequest("http://localhost/api/users/5/clave", { method: "POST", body: JSON.stringify(body) }), {
    params: { id: "5" },
  });
}

beforeEach(() => actualizar.mockReset());

describe("cambiar la contraseña de un trabajador", () => {
  it("con la contraseña que elige el dueño; por defecto debe cambiarla al entrar", async () => {
    const res = await cambiar({ clave: "Playa-Tamarindo-9" });
    expect(res.status).toBe(200);
    const [, patch] = actualizar.mock.calls[0];
    expect(patch.debe_cambiar_clave).toBe(true);
    expect(patch.password_hash).toMatch(/^scrypt\$/);
  });

  it("si el dueño lo desmarca, entra directo con esa contraseña", async () => {
    await cambiar({ clave: "Playa-Tamarindo-9", pedir_cambio: false });
    expect(actualizar.mock.calls[0][1].debe_cambiar_clave).toBe(false);
  });

  it("siempre la desbloquea y le cierra la sesion abierta", async () => {
    await cambiar({ clave: "Playa-Tamarindo-9", pedir_cambio: false });
    expect(actualizar.mock.calls[0][1]).toMatchObject({ intentos_fallidos: 0, bloqueado_hasta: null, session_version: 4 });
  });

  it("no acepta una contraseña debil", async () => {
    const res = await cambiar({ clave: "1234" });
    expect(res.status).toBe(400);
    expect(actualizar).not.toHaveBeenCalled();
  });
});
