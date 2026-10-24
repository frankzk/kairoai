import { NextResponse } from "next/server";
import { FINANCE_STORES } from "@/lib/store-config";
import { credencialMcp, errorDeTiendaMcp, tiendaDeLaConexion } from "@/lib/icomfly-mcp";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: a que tienda de iComfly apunta la clave de "Crear en iComfly" de cada
// tienda de Kairo (ICOMFLY_<CR|HN>_MCP_URL / _TOKEN). Solo pregunta: no crea
// nada. Para revisar las claves despues de cargarlas en Vercel.
export async function GET() {
  const tiendas = await Promise.all(
    FINANCE_STORES.map(async (store) => {
      const cred = credencialMcp(store.code);
      if (cred.faltan.length) return { tienda: store.label, configurada: false, faltan: cred.faltan };
      const esperada = getIcomflyExternalStoreId(store.code);
      try {
        const conexion = await tiendaDeLaConexion(store.code);
        const error = errorDeTiendaMcp(store.code, conexion, esperada);
        return { tienda: store.label, configurada: true, conectada_a: conexion, esperada, correcta: !error, ...(error ? { error } : {}) };
      } catch (err) {
        return { tienda: store.label, configurada: true, correcta: false, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  return NextResponse.json({ ok: tiendas.every((t) => t.correcta), tiendas });
}
