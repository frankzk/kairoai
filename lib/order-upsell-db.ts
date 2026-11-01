import { randomUUID } from "node:crypto";
import { getDB } from "./db";
import { getIcomflyOrder } from "./icomfly";
import { nombrePedidoIcomfly } from "./icomfly-pedidos";
import type { FinanceStoreCode } from "./store-config";
import type { UpsellReceipt, UpsellSelection } from "./order-upsell";

export interface StoredUpsell extends UpsellReceipt { selection: UpsellSelection; replacement_name: string | null }
export async function findOrderUpsell(storeId: number, name: string): Promise<StoredUpsell | null> {
  const { data, error } = await getDB().from("order_upsell_replacements").select("*").eq("store_id", storeId).eq("original_name", name).maybeSingle();
  if (error) throw new Error("No se pudo consultar el upsell pendiente.");
  return data;
}
export async function reserveOrderUpsell(receipt: StoredUpsell): Promise<StoredUpsell> {
  const { error } = await getDB().from("order_upsell_replacements").insert(receipt);
  if (error?.code === "23505") {
    const existing = await findOrderUpsell(receipt.store_id, receipt.original_name);
    if (existing) return existing;
  }
  if (error) throw new Error("No se pudo guardar el intento. No se envió el pedido.");
  return receipt;
}
export async function lockOrderUpsell(r: UpsellReceipt): Promise<string | null> {
  const token = randomUUID(), now = new Date();
  const { data, error } = await getDB().from("order_upsell_replacements")
    .update({ lock_token: token, locked_until: new Date(now.getTime() + 10 * 60_000).toISOString() })
    .eq("store_id", r.store_id).eq("id", r.id)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`).select("id").maybeSingle();
  if (error) throw new Error("No se pudo reservar la operación.");
  return data ? token : null;
}
export async function patchOrderUpsell(r: UpsellReceipt, token: string, changes: Partial<UpsellReceipt>): Promise<void> {
  const { data, error } = await getDB().from("order_upsell_replacements").update(changes)
    .eq("store_id", r.store_id).eq("id", r.id).eq("lock_token", token).select("id").maybeSingle();
  if (error || !data) throw new Error("No se pudo guardar el avance del upsell.");
}
export async function unlockOrderUpsell(r: UpsellReceipt, token: string) {
  await getDB().from("order_upsell_replacements").update({ lock_token: null, locked_until: null })
    .eq("store_id", r.store_id).eq("id", r.id).eq("lock_token", token);
}
export async function resolveUpsellOriginal(storeId: number, store: FinanceStoreCode, name: string) {
  if (!name || name.length > 150) throw new Error("Pedido inválido.");
  const db = getDB();
  const web = /^IC-W([1-9]\d*)$/.exec(name);
  const internal = /^IC-([1-9]\d*)$/.exec(name);
  let queries;
  if (web) queries = [db.from("icomfly_order_payloads").select("icomfly_order_id").eq("store_id", storeId).eq("payload->>store_web_seq", web[1]).limit(2)];
  else if (internal) queries = [
    db.from("icomfly_order_payloads").select("icomfly_order_id").eq("store_id", storeId).eq("icomfly_order_id", internal[1]).limit(2),
    db.from("icomfly_order_payloads").select("icomfly_order_id").eq("store_id", storeId).eq("payload->>order_number", internal[1]).limit(2),
    db.from("icomfly_order_payloads").select("icomfly_order_id").eq("store_id", storeId).eq("payload->>order_number", `#${internal[1]}`).limit(2),
  ];
  else queries = [db.from("icomfly_order_payloads").select("icomfly_order_id").eq("store_id", storeId).eq("payload->>shopify_display_number", name).limit(2)];
  const results = await Promise.all(queries);
  if (results.some(r => r.error)) throw new Error("No se pudo identificar el pedido original.");
  const ids = Array.from(new Set(results.flatMap(r => (r.data ?? []).map(x => x.icomfly_order_id as string))));
  if (ids.length !== 1) throw new Error("No se encontró un único pedido en iComfly. Actualiza la gestión antes de continuar.");
  const order = await getIcomflyOrder(store, ids[0]);
  const canonical = String(order.shopify_display_number || "").trim() || nombrePedidoIcomfly(order.order_number, order.id, order.store_web_seq);
  if (canonical !== name) throw new Error("La referencia de iComfly no coincide con este pedido.");
  return order;
}
