import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { actorActual } from "@/lib/identidad";
import { PERMISO_INFO, PERMISOS, ROL_INFO, ROLES } from "@/lib/permisos";
import { FINANCE_STORES } from "@/lib/store-config";
import {
  aPublico,
  buscarPorUsuario,
  crearUsuario,
  hashClave,
  listarUsuarios,
  normalizarUsuario,
  problemaDeClave,
  problemaDeUsuario,
  registrarEvento,
} from "@/lib/usuarios";
import { validarAcceso } from "@/lib/usuarios-validar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Administracion de usuarios. El middleware ya exige el permiso "usuarios".

// GET: usuarios, asesoras de la planilla para vincular, y el catalogo.
export async function GET() {
  try {
    const [usuarios, staffRes] = await Promise.all([
      listarUsuarios(),
      getDB().from("payroll_staff").select("id,name,role,active").order("name"),
    ]);
    if (staffRes.error) throw new Error(staffRes.error.message);
    return NextResponse.json({
      usuarios: usuarios.map(aPublico),
      staff: staffRes.data ?? [],
      catalogo: {
        permisos: PERMISOS.map((p) => ({ id: p, ...PERMISO_INFO[p] })),
        roles: ROLES.map((r) => ({ id: r, ...ROL_INFO[r] })),
        tiendas: FINANCE_STORES.map((s) => ({ code: s.code, label: s.label ?? s.code })),
      },
    });
  } catch (err) {
    console.error("[users GET]", err);
    return NextResponse.json({ error: "No se pudieron cargar los usuarios." }, { status: 500 });
  }
}

// POST { username, email, nombre, clave, roles, permisos, tiendas, staff_id }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const username = normalizarUsuario(body.username);
  const problemaU = problemaDeUsuario(username);
  if (problemaU) return NextResponse.json({ error: problemaU }, { status: 400 });

  const clave = String(body.clave ?? "");
  const problemaC = problemaDeClave(clave, username);
  if (problemaC) return NextResponse.json({ error: problemaC }, { status: 400 });

  const v = validarAcceso(body);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  try {
    if (await buscarPorUsuario(username)) {
      return NextResponse.json({ error: `Ya existe el usuario "${username}".` }, { status: 409 });
    }
    const actor = actorActual();
    const u = await crearUsuario({
      username,
      ...v.datos,
      password_hash: await hashClave(clave),
      activo: true,
      debe_cambiar_clave: true,
      creado_por: actor,
    });
    await registrarEvento(u.id, actor, "alta", { ...v.datos });
    return NextResponse.json({ usuario: aPublico(u) }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("kairo_users_staff_key")) {
      return NextResponse.json({ error: "Esa asesora de la planilla ya tiene un usuario." }, { status: 409 });
    }
    if (msg.includes("kairo_users_email_key")) {
      return NextResponse.json({ error: "Ese correo ya lo usa otro usuario." }, { status: 409 });
    }
    console.error("[users POST]", err);
    return NextResponse.json({ error: "No se pudo crear el usuario." }, { status: 500 });
  }
}
