import { NextRequest, NextResponse } from "next/server";
import { actorActual } from "@/lib/identidad";
import { actualizarUsuario, buscarPorId, hashClave, problemaDeClave, registrarEvento } from "@/lib/usuarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clave }: contraseña nueva puesta por quien administra (olvido,
// persona nueva). Corta sus sesiones abiertas, desbloquea, y la obliga a
// cambiarla al entrar.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { clave?: unknown };
  const clave = String(body?.clave ?? "");
  try {
    const u = await buscarPorId(id);
    if (!u) return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
    const problema = problemaDeClave(clave, u.username);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    await actualizarUsuario(id, {
      password_hash: await hashClave(clave),
      debe_cambiar_clave: true,
      session_version: u.session_version + 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    });
    await registrarEvento(id, actorActual(), "reseteo_clave");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[users clave]", err);
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}
