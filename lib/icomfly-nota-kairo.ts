// Copia cada gestion de la ficha del pedido de Kairo a la nota interna del
// pedido en iComfly (03/11/2026): asi las asesoras trabajan solo en Kairo y en
// iComfly queda el mismo historial, sin escribirlo dos veces.
//
// Se escribe con la herramienta agregar_nota_pedido del conector de iComfly
// (lib/icomfly-mcp.ts): ANEXA la nota con fecha y firma, sin tocar las
// anteriores ni lo que viaja a la transportadora. Si iComfly falla, la
// gestion igual queda en Kairo; el resultado se guarda en
// order_events.metadata.icomfly_nota y la ficha avisa.

import { getDB } from "@/lib/db";
import { MARCA_KAIRO } from "@/lib/icomfly-comentarios";
import { llamarHerramientaIcomfly } from "@/lib/icomfly-mcp";
import { ORDER_EVENT_CANALES, ORDER_EVENT_OUTCOME_LABEL, type OrderEvent } from "@/lib/order-events";
import type { FinanceStoreCode } from "@/lib/store-config";
import { filtrosPedidoIcomfly } from "@/lib/zadarma-calls";

const TIMEOUT_MS = 8000;
const MAX_TEXTO = 1000;

export type GestionParaIcomfly = Pick<OrderEvent, "kind" | "outcome" | "message" | "staff_name" | "canal" | "fecha_pactada">;

/** "Kairo · Jeanny Linares: No contestó · Llamada — se dejó audio". */
export function textoNotaParaIcomfly(e: GestionParaIcomfly): string {
  const que = e.kind === "nota" ? "Nota" : ORDER_EVENT_OUTCOME_LABEL[e.outcome] ?? e.outcome;
  const canal = e.kind === "contacto" && e.canal ? ORDER_EVENT_CANALES.find((c) => c.value === e.canal)?.label ?? e.canal : "";
  const fecha = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(e.fecha_pactada ?? ""));
  const detalle = [que, canal, fecha ? `para el ${fecha[3]}/${fecha[2]}` : ""].filter(Boolean).join(" · ");
  const mensaje = String(e.message ?? "").trim();
  const quien = String(e.staff_name ?? "").trim() || "sin asesora";
  const texto = `${MARCA_KAIRO} ${quien}: ${detalle}${mensaje ? ` — ${mensaje}` : ""}`;
  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO - 1)}…` : texto;
}

export type ResultadoCopia =
  | { estado: "copiado" }
  | { estado: "sin_pedido" }
  | { estado: "error"; error: string };

/** El id interno de iComfly de un pedido de Kairo, o null si no esta en iComfly. */
async function idIcomfly(storeId: number, orderName: string): Promise<string | null> {
  const filtros = filtrosPedidoIcomfly(orderName);
  if (!filtros) return null;
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select("icomfly_order_id")
    .eq("store_id", storeId)
    .or(filtros)
    .limit(1);
  if (error) throw new Error(`idIcomfly: ${error.message}`);
  const id = (data?.[0] as { icomfly_order_id?: string } | undefined)?.icomfly_order_id;
  return id && /^\d+$/.test(String(id)) ? String(id) : null;
}

/**
 * Copia la gestion a iComfly y anota el resultado en el evento. Nunca lanza:
 * la gestion ya quedo en Kairo y eso es lo que importa.
 */
export async function copiarGestionAIcomfly(
  store: { id: number; code: FinanceStoreCode },
  orderName: string,
  evento: GestionParaIcomfly & { id: number; metadata?: Record<string, unknown> | null },
  deps: { llamar?: typeof llamarHerramientaIcomfly; ahora?: () => Date } = {}
): Promise<ResultadoCopia> {
  let resultado: ResultadoCopia;
  try {
    const id = await idIcomfly(store.id, orderName);
    if (!id) {
      resultado = { estado: "sin_pedido" };
    } else {
      await (deps.llamar ?? llamarHerramientaIcomfly)(
        store.code,
        "agregar_nota_pedido",
        { order_id: Number(id), nota: textoNotaParaIcomfly(evento) },
        { timeoutMs: TIMEOUT_MS }
      );
      resultado = { estado: "copiado" };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[icomfly-nota] ${orderName}: ${error}`);
    resultado = { estado: "error", error: error.slice(0, 300) };
  }

  const at = (deps.ahora?.() ?? new Date()).toISOString();
  try {
    const { error } = await getDB()
      .from("order_events")
      .update({ metadata: { ...(evento.metadata ?? {}), icomfly_nota: { ...resultado, at } } })
      .eq("id", evento.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn(`[icomfly-nota] no se anoto el resultado del evento ${evento.id}: ${err instanceof Error ? err.message : err}`);
  }
  return resultado;
}
