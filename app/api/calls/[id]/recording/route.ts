import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { identidadActual } from "@/lib/identidad";
import { FINANCE_STORES } from "@/lib/store-config";
import { urlFirmadaGrabacion } from "@/lib/grabaciones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Quien ve llamadas en algun historial: Leads, Gestion de pedidos y Novedades.
// El middleware ya exige uno de estos (lib/permisos.ts); se repite aca porque
// la ruta entrega audio de clientes.
const PUEDEN_ESCUCHAR = ["leads", "leads_equipo", "pedidos", "finanzas", "novedades"];

function sinCache(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/**
 * Escuchar la grabacion de una llamada. Redirige (302) a una URL firmada de
 * 10 minutos del mp3 guardado en el bucket privado `call-recordings`; el
 * <audio> del historial sigue la redireccion solo. La ruta del archivo nunca
 * sale de aca, y el enlace del proveedor tampoco: si la grabacion todavia no
 * se copio a nuestro bucket, responde 409 "Grabación procesándose".
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const yo = identidadActual();
  if (!yo) return sinCache(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  if (!yo.permisos.some((p) => PUEDEN_ESCUCHAR.includes(p))) {
    return sinCache(NextResponse.json({ error: "No tienes acceso a esta sección." }, { status: 403 }));
  }

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return sinCache(NextResponse.json({ error: "Llamada inválida" }, { status: 400 }));
  }

  try {
    const { data, error } = await getDB()
      .from("zadarma_calls")
      .select("id,store_id,is_recorded,recording_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const fila = data as { id: number; store_id: number | null; is_recorded: boolean | null; recording_path: string | null } | null;
    if (!fila) return sinCache(NextResponse.json({ error: "Llamada no encontrada" }, { status: 404 }));

    // La tienda de la llamada tiene que ser una de las suyas. Una llamada sin
    // tienda (Zadarma a un numero desconocido) solo la escucha quien tiene
    // todas las tiendas.
    const tienda = FINANCE_STORES.find((s) => s.id === fila.store_id)?.code ?? null;
    const permitida = tienda
      ? yo.tiendas.includes(tienda)
      : FINANCE_STORES.every((s) => yo.tiendas.includes(s.code));
    if (!permitida) {
      return sinCache(NextResponse.json({ error: "No tienes acceso a esa tienda." }, { status: 403 }));
    }

    if (!fila.recording_path) {
      return sinCache(
        fila.is_recorded
          ? NextResponse.json({ error: "Grabación procesándose" }, { status: 409 })
          : NextResponse.json({ error: "Esta llamada no tiene grabación" }, { status: 404 })
      );
    }

    const url = await urlFirmadaGrabacion(fila.recording_path);
    return sinCache(NextResponse.redirect(url, 302));
  } catch (err) {
    // Sin detalles: el mensaje de Storage puede traer la ruta del archivo.
    console.error(`[grabaciones] no se pudo abrir la grabacion ${id}: ${err instanceof Error ? err.message : err}`);
    return sinCache(NextResponse.json({ error: "No se pudo abrir la grabación" }, { status: 500 }));
  }
}
