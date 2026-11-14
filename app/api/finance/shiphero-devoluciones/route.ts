import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { probarDevolucionesShipHero } from "@/lib/shiphero-devoluciones";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

// Prueba de solo lectura (Configuración): ¿ShipHero de Boxful registra los
// paquetes que el courier devuelve? Ver lib/shiphero-devoluciones.ts. Toma
// pedidos que iComfly ya da por devueltos hace 3 a 30 días (tiempo para que
// lleguen a bodega), mitad Moovin y mitad WYN, y los busca en ShipHero.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  const ahora = Date.now();
  const dia = 86_400_000;
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select("shiphero:payload->>boxful_shiphero_order_number,guia:payload->>tracking_number,courier:payload->>carrier_name,devuelto:payload->>returned_at")
    .eq("store_id", store.id)
    .eq("payload->>tracking_status", "DEVOLUCION")
    .gte("payload->>returned_at", new Date(ahora - 30 * dia).toISOString())
    .lte("payload->>returned_at", new Date(ahora - 3 * dia).toISOString())
    .not("payload->>boxful_shiphero_order_number", "is", null)
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const filas = (data ?? []) as unknown as Array<{ shiphero: string; guia: string | null; courier: string | null; devuelto: string | null }>;
  const de = (re: RegExp) => filas.filter((f) => re.test(f.courier ?? "")).slice(0, 5);
  const muestra = [...de(/moovin/i), ...de(/mail ?americas|wyn/i)].map((f) => ({
    shiphero: f.shiphero,
    guia: f.guia ?? "",
    courier: f.courier ?? "",
    devueltoEnIcomfly: f.devuelto ?? "",
  }));
  try {
    const resultado = await probarDevolucionesShipHero(store.id, muestra, {
      desde: new Date(ahora - 30 * dia).toISOString(),
      hasta: new Date(ahora).toISOString(),
      deadline: ahora + 50_000,
    });
    console.log("shiphero-devoluciones", JSON.stringify(resultado).slice(0, 20_000));
    return NextResponse.json(resultado);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("shiphero-devoluciones error", message.slice(0, 300));
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 502 });
  }
}
