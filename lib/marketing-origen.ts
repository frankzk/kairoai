// De donde vienen los pedidos y el inventario de iComfly, para el Tablero de
// Marketing (03/11/2026).
//
// Los pedidos no traen UTM ni campaña. Lo que si dice el origen es el numero
// que iComfly le da a cada pedido (medido el 03/11/2026, Costa Rica):
//   "#1793738040361420"  (15+ digitos)  la pagina web / landing de iComfly
//   "SHOP-MVZQH6ZJ-K8QR"                 entro por Shopify
//   "MANUAL-…" / "EXCEL-…"               lo creo una asesora (WhatsApp, upsell, Kairo)
//   "82245"                              numero propio de iComfly (chat, bot, panel)
// Los upsells son los reemplazos de Kairo (order_upsell_replacements).
//
// El inventario es el de iComfly (consultar_inventario del conector). ShipHero,
// cuando se conecte, manda por SKU (lib/marketing-intelligence.ts).

import { getDB } from "@/lib/db";
import { llamarHerramientaIcomfly } from "@/lib/icomfly-mcp";
import type { ArticuloInventario } from "@/lib/marketing-tablero";

export type OrigenPedido = "web" | "manual" | "icomfly" | "shopify" | "otro";

export function origenPedido(numero: unknown): OrigenPedido {
  const n = String(numero ?? "").trim();
  if (/^#\d{15,}$/.test(n)) return "web";
  if (/^(MANUAL|EXCEL)-/i.test(n)) return "manual";
  if (/^SHOP-/i.test(n)) return "shopify";
  if (/^\d+$/.test(n)) return "icomfly";
  return "otro";
}

export interface OrigenesPedidos {
  total: number;
  porOrigen: Record<OrigenPedido, number>;
  /** Pedidos de reemplazo por upsell completados en el periodo. */
  upsells: number;
}

export function contarOrigenes(numeros: unknown[], upsells: number): OrigenesPedidos {
  const porOrigen: Record<OrigenPedido, number> = { web: 0, manual: 0, icomfly: 0, shopify: 0, otro: 0 };
  for (const n of numeros) porOrigen[origenPedido(n)]++;
  return { total: numeros.length, porOrigen, upsells };
}

/** Los pedidos de iComfly creados entre dos instantes (ISO), por origen. */
export async function origenesDelPeriodo(storeId: number, desdeIso: string, hastaIso: string): Promise<OrigenesPedidos> {
  const numeros: unknown[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await getDB()
      .from("icomfly_orders")
      .select("order_number")
      .eq("store_id", storeId)
      .gte("icomfly_created_at", desdeIso)
      .lt("icomfly_created_at", hastaIso)
      .order("icomfly_order_id", { ascending: true })
      .range(desde, desde + 999);
    if (error) throw new Error(`origenesDelPeriodo: ${error.message}`);
    const pagina = (data ?? []) as Array<{ order_number: unknown }>;
    numeros.push(...pagina.map((r) => r.order_number));
    if (pagina.length < 1000) break;
  }
  const { count, error } = await getDB()
    .from("order_upsell_replacements")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .not("completed_at", "is", null)
    .gte("completed_at", desdeIso)
    .lt("completed_at", hastaIso);
  if (error) throw new Error(`origenesDelPeriodo upsells: ${error.message}`);
  return contarOrigenes(numeros, count ?? 0);
}

/** Lo que devuelve consultar_inventario: { productos: [{ name, stock }] }. */
export function leerInventario(resultado: Record<string, unknown>): ArticuloInventario[] {
  const productos = Array.isArray(resultado.productos) ? resultado.productos : [];
  return productos
    .map((p) => {
      const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const stock = r.stock == null || r.stock === "" ? null : Number(r.stock);
      return { nombre: String(r.name ?? "").trim(), stock: stock != null && Number.isFinite(stock) ? stock : null };
    })
    .filter((a) => a.nombre);
}

const CACHE_MS = 15 * 60 * 1000;
let cache: { en: number; items: ArticuloInventario[] } | null = null;

export async function inventarioIcomfly(): Promise<{ items: ArticuloInventario[]; checkedAt: string }> {
  if (cache && Date.now() - cache.en < CACHE_MS) return { items: cache.items, checkedAt: new Date(cache.en).toISOString() };
  const resultado = await llamarHerramientaIcomfly("mireva-cr", "consultar_inventario", { limite: 1000 }, { timeoutMs: 10000 });
  cache = { en: Date.now(), items: leerInventario(resultado) };
  return { items: cache.items, checkedAt: new Date(cache.en).toISOString() };
}
