// La ultima nota de iComfly de los pedidos de UNA pagina de Gestion (como
// mucho 50), de la ultima sincronizacion (icomfly_order_payloads). Una sola
// consulta; si falla, la lista sale igual sin notas.

import { getDB } from "@/lib/db";
import { ultimoComentarioIcomfly, type ComentarioIcomfly } from "@/lib/icomfly-comentarios";

export async function ultimasNotasIcomfly(storeId: number, ids: string[]): Promise<Map<string, ComentarioIcomfly>> {
  const out = new Map<string, ComentarioIcomfly>();
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (!unicos.length) return out;
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select("icomfly_order_id,internal_note:payload->>internal_note")
    .eq("store_id", storeId)
    .in("icomfly_order_id", unicos);
  if (error) {
    console.warn(`[gestion] no se pudieron leer las notas de iComfly: ${error.message}`);
    return out;
  }
  for (const fila of (data ?? []) as Array<{ icomfly_order_id: string | number; internal_note: string | null }>) {
    const c = ultimoComentarioIcomfly(fila.internal_note);
    if (c) out.set(String(fila.icomfly_order_id), c);
  }
  return out;
}
