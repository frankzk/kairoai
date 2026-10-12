import { NextRequest, NextResponse } from "next/server";
import { actorActual, identidadActual } from "@/lib/identidad";
import { actualizarUsuario, aPublico, buscarPorId, registrarEvento, type UsuarioFila } from "@/lib/usuarios";
import { validarAcceso } from "@/lib/usuarios-validar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { nombre, roles, permisos, tiendas, staff_id, activo }
// Los cambios de permisos y tiendas se notan en la sesion abierta en menos de
// 30 s (el middleware revalida contra la base). Desactivar corta la sesion.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Usuario inválido." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const u = await buscarPorId(id);
    if (!u) return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });

    const patch: Partial<UsuarioFila> = {};
    if ("nombre" in body || "permisos" in body || "tiendas" in body || "roles" in body || "staff_id" in body) {
      const v = validarAcceso({
        nombre: body.nombre ?? u.nombre,
        roles: body.roles ?? u.roles,
        permisos: body.permisos ?? u.permisos,
        tiendas: body.tiendas ?? u.tiendas,
        staff_id: "staff_id" in body ? body.staff_id : u.staff_id,
      });
      if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
      Object.assign(patch, v.datos);
    }
    if ("activo" in body) {
      const activo = body.activo === true;
      if (!activo && identidadActual()?.id === id) {
        return NextResponse.json({ error: "No puedes desactivar tu propio usuario." }, { status: 400 });
      }
      patch.activo = activo;
      // Desactivar corta en el acto cualquier sesion abierta.
      if (!activo) patch.session_version = u.session_version + 1;
    }

    const actualizado = await actualizarUsuario(id, patch);
    await registrarEvento(id, actorActual(), "cambio", patch as Record<string, unknown>);
    return NextResponse.json({ usuario: aPublico(actualizado) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("kairo_users_staff_key")) {
      return NextResponse.json({ error: "Esa asesora de la planilla ya tiene otro usuario." }, { status: 409 });
    }
    console.error("[users PATCH]", err);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }
}
