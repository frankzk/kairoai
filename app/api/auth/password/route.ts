import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { ADMIN_LEGADO_ID, firmarSesion, HEADER_USUARIO, identidadDeHeader, opcionesCookie } from "@/lib/auth";
import { inicioDe } from "@/lib/permisos";
import {
  actualizarUsuario,
  buscarPorId,
  claimsDeUsuario,
  hashClave,
  problemaDeClave,
  registrarEvento,
  verificarClave,
} from "@/lib/usuarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { actual, nueva }: la persona cambia SU contraseña. Corta sus otras
// sesiones abiertas (sube session_version) y le deja una nueva en este equipo.
export async function POST(req: NextRequest) {
  const yo = identidadDeHeader(headers().get(HEADER_USUARIO));
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (yo.id === ADMIN_LEGADO_ID) {
    return NextResponse.json(
      { error: "La contraseña del administrador general se cambia en Vercel (ADMIN_PASSWORD)." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const actual = String(body?.actual ?? "");
  const nueva = String(body?.nueva ?? "");

  try {
    const u = await buscarPorId(yo.id);
    if (!u || !u.activo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await verificarClave(actual, u.password_hash))) {
      return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 });
    }
    const problema = problemaDeClave(nueva, u.username);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    if (nueva === actual) {
      return NextResponse.json({ error: "La nueva contraseña tiene que ser distinta de la actual." }, { status: 400 });
    }

    const actualizado = await actualizarUsuario(u.id, {
      password_hash: await hashClave(nueva),
      debe_cambiar_clave: false,
      session_version: u.session_version + 1,
    });
    await registrarEvento(u.id, u.username, "cambio_clave");

    const claims = claimsDeUsuario(actualizado);
    const res = NextResponse.json({ ok: true, inicio: inicioDe(claims.p) });
    res.cookies.set({ ...opcionesCookie(), value: await firmarSesion(claims) });
    return res;
  } catch (err) {
    console.error("[auth/password]", err);
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}
