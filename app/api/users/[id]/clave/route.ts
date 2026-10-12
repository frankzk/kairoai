import { NextRequest, NextResponse } from "next/server";
import { actorActual } from "@/lib/identidad";
import { actualizarUsuario, buscarPorId, hashClave, problemaDeClave, registrarEvento } from "@/lib/usuarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clave, pedir_cambio }: contraseña nueva puesta por quien administra
// (se le olvido, se le bloqueo, persona nueva). La escribe el dueño o se
// genera. Corta sus sesiones abiertas y la desbloquea si estaba trabada por
// intentos fallidos.
//
// pedir_cambio (por defecto true): si la persona tiene que cambiarla al entrar.
// El dueño puede apagarlo para resolver rapido ("te la cambie, entra con X").
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { clave?: unknown; pedir_cambio?: unknown };
  const clave = String(body?.clave ?? "");
  const pedirCambio = body?.pedir_cambio !== false;
  try {
    const u = await buscarPorId(id);
    if (!u) return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    const problema = problemaDeClave(clave, u.username);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    await actualizarUsuario(id, {
      password_hash: await hashClave(clave),
      debe_cambiar_clave: pedirCambio,
      session_version: u.session_version + 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    });
    await registrarEvento(id, actorActual(), "reseteo_clave", { pedir_cambio: pedirCambio });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[users clave]", err);
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}
