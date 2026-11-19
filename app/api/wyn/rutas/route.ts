import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { cargarExcelWyn, leerRutasWyn } from "@/lib/wyn-rutas-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rutas y días de entrega de WYN (lib/wyn-rutas.ts).
//   GET: las rutas y quién cargó el Excel (lo leen los pedidos, Novedades y
//        Crear pedido para calcular la próxima entrega).
//   POST (multipart, campo "archivo"): carga un Excel nuevo de WYN y reemplaza
//        las rutas. Solo "config" (regla por método en lib/permisos.ts).

export async function GET() {
  try {
    return NextResponse.json(await leerRutasWyn(), { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudieron leer las rutas." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const yo = identidadActual();
  if (yo && !yo.permisos.includes("config")) {
    return NextResponse.json({ error: "Solo un administrador puede cargar las rutas de WYN." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!archivo || typeof archivo === "string") {
    return NextResponse.json({ error: "Adjunta el Excel de WYN (.xlsx)." }, { status: 400 });
  }
  if (archivo.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "El archivo pesa más de 5 MB." }, { status: 400 });
  }
  try {
    const rutas = await cargarExcelWyn(await archivo.arrayBuffer(), archivo.name || "wyn.xlsx", yo ? `${yo.id}:${yo.nombre}` : "sistema");
    return NextResponse.json({ ok: true, cargadas: rutas, ...(await leerRutasWyn()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo leer el Excel." }, { status: 400 });
  }
}
