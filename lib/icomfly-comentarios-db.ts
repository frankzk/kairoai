// Lee los comentarios y etiquetas de iComfly de un pedido de Kairo
// (lib/icomfly-comentarios.ts explica el formato).
//
// Se lee el pedido EN VIVO de iComfly al abrir la ficha (4 s como mucho) y, si
// iComfly no responde, lo ultimo que trajo la sincronizacion (cada 30 min).

import { getDB } from "@/lib/db";
import { getIcomflyOrderDetalle } from "@/lib/icomfly";
import { esNotaDeKairo, leerComentariosIcomfly, leerEtiquetasIcomfly, type NotasIcomfly } from "@/lib/icomfly-comentarios";
import type { FinanceStoreCode } from "@/lib/store-config";
import { filtrosPedidoIcomfly } from "@/lib/zadarma-calls";

// Lo que Kairo copio a iComfly ya esta en la bitacora como gestion: no se repite.
function notasDe(pedido: { internal_note?: unknown; labels?: unknown }, origen: NotasIcomfly["origen"]): NotasIcomfly {
  return {
    comentarios: leerComentariosIcomfly(pedido.internal_note).filter((c) => !esNotaDeKairo(c.texto)),
    etiquetas: leerEtiquetasIcomfly(pedido.labels),
    origen,
  };
}

/**
 * Comentarios y etiquetas de iComfly de un pedido de Kairo, o null si el
 * pedido no esta en iComfly.
 */
export async function notasIcomflyDelPedido(
  store: { id: number; code: FinanceStoreCode },
  orderName: string,
  leerEnVivo: typeof getIcomflyOrderDetalle = getIcomflyOrderDetalle
): Promise<NotasIcomfly | null> {
  const filtros = filtrosPedidoIcomfly(orderName);
  if (!filtros) return null;
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select("icomfly_order_id, internal_note:payload->>internal_note, labels:payload->labels")
    .eq("store_id", store.id)
    .or(filtros)
    .limit(1);
  if (error) throw new Error(`notasIcomflyDelPedido: ${error.message}`);
  const fila = data?.[0] as { icomfly_order_id: string; internal_note: unknown; labels: unknown } | undefined;
  if (!fila) return null;

  try {
    const vivo = await leerEnVivo(store.code, String(fila.icomfly_order_id));
    // Si el detalle no trae la nota, no se puede afirmar que no haya: queda lo sincronizado.
    if ("internal_note" in vivo || "labels" in vivo) return notasDe(vivo, "vivo");
  } catch (err) {
    console.warn(`[icomfly-comentarios] ${orderName} sin lectura en vivo: ${err instanceof Error ? err.message : err}`);
  }
  return notasDe(fila, "sincronizado");
}

