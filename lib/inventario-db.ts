// Lectura del inventario de ShipHero guardado por la sincronizacion (cron cada
// 15 min o "Actualizar ahora"): la foto mas reciente del alcance conectado.

import { getDB } from "@/lib/db";
import type { ItemInventario } from "@/lib/inventario";
import { readInventorySnapshots } from "@/lib/marketing-inventory-db";
import { readConnectionRow, shipheroScopeKey } from "@/lib/shiphero-connection";

export interface InventarioRespuesta {
  estado: "ok" | "sin_conexion" | "pendiente";
  mensaje: string;
  actualizado: string | null;
  items: ItemInventario[];
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

export async function leerInventario(storeId: number): Promise<InventarioRespuesta> {
  const row = await readConnectionRow(storeId).catch(() => null);
  if (!row || row.state === "disconnected" || !row.refresh_token_enc) {
    return { estado: "sin_conexion", mensaje: "ShipHero no está conectado para esta tienda.", actualizado: null, items: [] };
  }
  if (row.state === "needs_scope") {
    return { estado: "pendiente", mensaje: "ShipHero está conectado, pero falta elegir qué inventario leer (Marketing › Fuentes).", actualizado: null, items: [] };
  }
  const { latest } = await readInventorySnapshots(storeId, { source: "shiphero", scopeKey: shipheroScopeKey(row), items: false });
  if (!latest) return { estado: "pendiente", mensaje: "Todavía no hay inventario guardado de ShipHero.", actualizado: null, items: [] };

  const items: ItemInventario[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await getDB()
      .from("marketing_inventory_items")
      .select("sku,name,available,on_hand,allocated,backorder,incoming")
      .eq("snapshot_id", latest.id)
      .order("sku_key")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`leerInventario: ${error.message}`);
    const filas = (data ?? []) as Array<{ sku: string; name: string | null; available: number | string; on_hand: number | string | null; allocated: number | string | null; backorder: number | string | null; incoming: number | string | null }>;
    for (const f of filas) {
      const disponible = Number(f.available) || 0;
      items.push({
        sku: f.sku,
        nombre: (f.name ?? "").trim() || f.sku,
        disponible,
        enBodega: num(f.on_hand) ?? disponible,
        reservado: num(f.allocated) ?? 0,
        pendientes: latest.backorderColumn ? num(f.backorder) : null,
        enCamino: latest.incomingColumn ? num(f.incoming) : null,
      });
    }
    if (filas.length < 1000) break;
  }
  const fallaLaUltima = Boolean(row.last_error && row.last_sync_at && (!row.last_sync_ok_at || row.last_sync_at > row.last_sync_ok_at));
  return {
    estado: "ok",
    mensaje:
      row.state === "reconnect"
        ? "ShipHero pide volver a conectar: el inventario puede estar desactualizado."
        : fallaLaUltima
          ? "La última lectura de ShipHero falló; se muestra la anterior."
          : "",
    // La foto del día se reemplaza en cada lectura: la hora buena es la de la última lectura exitosa.
    actualizado: row.last_sync_ok_at ?? latest.uploadedAt,
    items,
  };
}
