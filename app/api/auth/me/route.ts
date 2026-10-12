import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { HEADER_USUARIO, identidadDeHeader } from "@/lib/auth";
import { inicioDe, pantallasDe } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: quien soy y que puedo hacer. La identidad ya viene revalidada por el
// middleware (header interno); aca no se vuelve a leer la cookie.
export async function GET() {
  const yo = identidadDeHeader(headers().get(HEADER_USUARIO));
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: yo.id,
    nombre: yo.nombre,
    permisos: yo.permisos,
    tiendas: yo.tiendas,
    staff_id: yo.staffId,
    inicio: inicioDe(yo.permisos),
    pantallas: pantallasDe(yo.permisos).map((p) => ({ ruta: p.ruta, label: p.label })),
  });
}
