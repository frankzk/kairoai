// Acceso a la tabla order_events (migracion 0028): la bitacora de gestion del
// pedido. Append-only: nada se edita ni se borra, para que sirva como respaldo
// de lo que se hizo.
//
// Los tipos y las etiquetas viven en lib/order-events.ts (modulo puro) porque
// el drawer los necesita en el cliente.

import { getDB } from "./db";
import type { OrderEvent, OrderEventCanal, OrderEventKind, OrderEventOutcome } from "./order-events";
import { configDeTienda, type ConfigConfirmacion, type EventoConfirmacion } from "./confirmacion";

const MAX_EVENTS = 100;

export async function listOrderEvents(opts: {
  storeId: number;
  orderName: string;
}): Promise<OrderEvent[]> {
  const { data, error } = await getDB()
    .from("order_events")
    .select("*")
    .eq("store_id", opts.storeId)
    .eq("order_name", opts.orderName)
    .order("created_at", { ascending: false })
    .limit(MAX_EVENTS);
  if (error) throw new Error(`listOrderEvents: ${error.message}`);
  return (data ?? []) as OrderEvent[];
}

export async function createOrderEvent(input: {
  storeId: number;
  orderName: string;
  guideNumber?: string;
  kind: OrderEventKind;
  outcome?: OrderEventOutcome;
  message?: string;
  staffId?: number | null;
  staffName?: string;
  canal?: OrderEventCanal;
  fechaPactada?: string | null;
  recordatorioAt?: string | null;
}): Promise<OrderEvent> {
  const { data, error } = await getDB()
    .from("order_events")
    .insert({
      store_id: input.storeId,
      order_name: input.orderName,
      guide_number: input.guideNumber ?? "",
      kind: input.kind,
      outcome: input.outcome ?? "",
      message: (input.message ?? "").trim().slice(0, 2000),
      staff_id: input.staffId ?? null,
      staff_name: (input.staffName ?? "").trim(),
      canal: input.canal ?? "",
      fecha_pactada: input.fechaPactada ?? null,
      recordatorio_at: input.recordatorioAt ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`createOrderEvent: ${error.message}`);
  return data as OrderEvent;
}

/**
 * Cuantos intentos de contacto lleva cada pedido, para pintarlo en la lista.
 * Una sola consulta para todos los pedidos visibles en vez de una por fila.
 */
export async function countContactAttempts(opts: {
  storeId: number;
  orderNames: string[];
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!opts.orderNames.length) return counts;

  const { data, error } = await getDB()
    .from("order_events")
    .select("order_name")
    .eq("store_id", opts.storeId)
    .eq("kind", "contacto")
    .in("order_name", opts.orderNames.slice(0, 1000));
  if (error) throw new Error(`countContactAttempts: ${error.message}`);

  for (const row of (data ?? []) as Array<{ order_name: string }>) {
    counts.set(row.order_name, (counts.get(row.order_name) ?? 0) + 1);
  }
  return counts;
}

/**
 * Contactos y decisiones de la tienda, por pedido, para la cola de
 * confirmacion (lib/confirmacion.ts). Se leen todos de una vez en paginas de
 * 1000 (PostgREST corta ahi) en lugar de una consulta por pedido.
 */
export async function listConfirmacionEvents(storeId: number): Promise<Map<string, EventoConfirmacion[]>> {
  const porPedido = new Map<string, EventoConfirmacion[]>();
  const PAGINA = 1000;
  for (let desde = 0; desde < 50_000; desde += PAGINA) {
    const { data, error } = await getDB()
      .from("order_events")
      .select("order_name,kind,outcome,created_at,fecha_pactada,recordatorio_at")
      .eq("store_id", storeId)
      .in("kind", ["contacto", "decision", "nota"])
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`listConfirmacionEvents: ${error.message}`);
    const filas = (data ?? []) as Array<EventoConfirmacion & { order_name: string }>;
    for (const f of filas) {
      const clave = f.order_name.trim().toUpperCase();
      const lista = porPedido.get(clave) ?? [];
      lista.push({ kind: f.kind, outcome: f.outcome, created_at: f.created_at, fecha_pactada: f.fecha_pactada, recordatorio_at: f.recordatorio_at });
      porPedido.set(clave, lista);
    }
    if (filas.length < PAGINA) break;
  }
  return porPedido;
}

/** Configuracion de la cola de confirmacion de la tienda (stores.metadata.confirmacion). */
export async function leerConfigConfirmacion(storeId: number, storeCode: string): Promise<ConfigConfirmacion> {
  const { data } = await getDB().from("stores").select("metadata").eq("id", storeId).maybeSingle();
  return configDeTienda(storeCode, (data as { metadata?: unknown } | null)?.metadata);
}
