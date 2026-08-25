import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Ultima llamada YA TERMINADA de una asesora.
 *
 * Existe para que el telefono web sepa cuando colgó sin preguntarle nada al
 * widget de Zadarma. La señal sale de `zadarma_calls`, que llena nuestro propio
 * webhook con los eventos NOTIFY_END / NOTIFY_OUT_END de la centralita.
 *
 * Por que asi y no leyendo el widget: dos intentos de sacarle el estado
 * terminaron rompiendo produccion (adivinar su markup rompio el boton de
 * colgar; envolver RTCPeerConnection dejo el telefono sin inicializar). Esta
 * via no lo toca: si el webhook se atrasa o no llega, el telefono simplemente
 * se queda visible como hoy, que es el comportamiento viejo y no una falla.
 */
export async function GET(req: NextRequest) {
  const vendedoraId = Number(req.nextUrl.searchParams.get("vendedora_id"));
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "vendedora_id requerido" }, { status: 400 });
  }

  try {
    const { data, error } = await getDB()
      .from("zadarma_calls")
      .select("id, ended_at, duration_seconds, status")
      .eq("vendedora", vendedoraId)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const row = data as { id: number; ended_at: string } | null;
    return NextResponse.json({
      last_call_id: row?.id ?? null,
      ended_at: row?.ended_at ?? null,
    });
  } catch (err) {
    // Nunca es fatal: sin esta respuesta el telefono solo pierde el
    // ocultarse solo, que es comodidad.
    const message = err instanceof Error ? err.message : "Error al leer la ultima llamada";
    return NextResponse.json({ last_call_id: null, ended_at: null, error: message }, { status: 200 });
  }
}
