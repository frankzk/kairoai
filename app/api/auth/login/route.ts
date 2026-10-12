import { NextRequest, NextResponse } from "next/server";
import { claimsAdminLegado, esClaveAdminLegado, firmarSesion, opcionesCookie } from "@/lib/auth";
import { inicioDe } from "@/lib/permisos";
import { CODIGOS_TIENDA, claimsDeUsuario, ingresar, normalizarUsuario, registrarEvento } from "@/lib/usuarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { usuario, password }
//
// Cada persona entra con SU usuario y contraseña. El usuario "admin" con la
// contraseña compartida de siempre (ADMIN_PASSWORD) queda como acceso de
// administrador del dueño: desde ahi se crean los demas usuarios.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const usuario = normalizarUsuario(body?.usuario);
  const password = String(body?.password ?? "");
  if (!password) {
    return NextResponse.json({ error: "Escribe tu usuario y contraseña." }, { status: 400 });
  }

  try {
    let claims;
    if (usuario === "admin" || usuario === "") {
      if (!esClaveAdminLegado(password)) {
        return NextResponse.json({ error: "Usuario o contraseña incorrectos." }, { status: 401 });
      }
      claims = claimsAdminLegado(CODIGOS_TIENDA);
      await registrarEvento(null, "admin", "ingreso_admin");
    } else {
      const r = await ingresar(usuario, password);
      if (!r.ok) {
        const msg =
          r.motivo === "bloqueado"
            ? `Demasiados intentos fallidos. Prueba de nuevo después de las ${new Date(r.hasta!).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Costa_Rica" })}.`
            : r.motivo === "inactivo"
              ? "Tu usuario está desactivado. Habla con tu supervisora."
              : "Usuario o contraseña incorrectos.";
        return NextResponse.json({ error: msg }, { status: r.motivo === "bloqueado" ? 429 : 401 });
      }
      claims = claimsDeUsuario(r.usuario);
    }

    const res = NextResponse.json({ ok: true, inicio: claims.mc ? "/cuenta" : inicioDe(claims.p), nombre: claims.n });
    res.cookies.set({ ...opcionesCookie(), value: await firmarSesion(claims) });
    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "No se pudo iniciar sesión. Intenta de nuevo." }, { status: 500 });
  }
}
