import { getDB } from "./db";
import { identidadActual } from "./identidad";
import { WC_STATUS, type WooStatus } from "./woo-config";

export function wooAccess(): boolean {
  const yo = identidadActual();
  return Boolean(yo && (yo.id === 0 || yo.tiendas.includes("kenku-it")) && yo.permisos.some(p => p === "pedidos" || p === "finanzas"));
}
export function wooEnv() {
  return {
    secret: process.env.WOO_KENKU_IT_WEBHOOK_SECRET || "",
    url: process.env.WOO_KENKU_IT_URL || "",
    key: process.env.WOO_KENKU_IT_CONSUMER_KEY || "",
    password: process.env.WOO_KENKU_IT_CONSUMER_SECRET || "",
    origins: (process.env.WOO_KENKU_IT_ORIGINS || "").split(",").map(x => x.trim().replace(/\/$/, "")).filter(Boolean),
  };
}
export async function wooStoreId(): Promise<number> {
  const { data, error } = await getDB().from("stores").select("id").eq("code", "kenku-it").eq("active", true).single();
  if (error || !data) throw new Error("Tienda no disponible");
  return data.id;
}
// A row is a durable outbox. Claims serialize all state updates for one order;
// version fencing in cod-core rejects late requests after a timeout.
export async function syncWooStatuses(limit = 10): Promise<{ synced: number; failed: number }> {
  const env = wooEnv();
  if (!env.url || !env.key || !env.password) throw new Error("Conexión WooCommerce incompleta");
  const base = new URL(env.url); if (base.protocol !== "https:" || base.username || base.password) throw new Error("URL WooCommerce inválida");
  const db = getDB(); let synced = 0, failed = 0;
  for (let i = 0; i < limit; i++) {
    const { data, error } = await db.rpc("woo_claim_status");
    if (error) throw new Error("No se pudo leer la cola");
    const row = data?.[0]; if (!row) break;
    let failure: string | null = null;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // The Woo REST path already bypasses preview Basic Auth in Caddy and
      // requires its own read/write WooCommerce credentials.
      headers.Authorization = "Basic " + Buffer.from(`${env.key}:${env.password}`).toString("base64");
      const response = await fetch(new URL(`/wp-json/wc/v3/orders/${row.woo_id}`, base), {
        method: "PUT", headers, redirect: "error", signal: AbortSignal.timeout(12000), cache: "no-store",
        body: JSON.stringify({ status: WC_STATUS[row.status as WooStatus], meta_data: [{ key: "_cod_core_crm_revision", value: row.version }] }),
      });
      if (!response.ok) failure = `WooCommerce HTTP ${response.status}`;
      else {
        const result = await response.json();
        if (result.id !== row.woo_id || result.status !== WC_STATUS[row.status as WooStatus]) failure = "Respuesta de WooCommerce inesperada";
      }
    } catch { failure = "No se pudo confirmar la respuesta de WooCommerce"; }
    const done = await db.rpc("woo_finish_status", { p_id: row.id, p_lease: row.lease_token, p_error: failure });
    if (done.error) throw new Error("No se pudo guardar el resultado de sincronización");
    if (failure) failed++; else synced++;
  }
  return { synced, failed };
}
