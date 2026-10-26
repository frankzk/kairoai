import { getDB } from "./db";
import { identidadActual } from "./identidad";

export function argentinaAccess(): boolean {
  const yo = identidadActual();
  return Boolean(yo && (yo.id === 0 || yo.tiendas.includes("kenku-ar")) && yo.permisos.some(p => p === "pedidos" || p === "finanzas"));
}

export async function argentinaStoreId(): Promise<number> {
  const { data, error } = await getDB().from("stores").select("id").eq("code", "kenku-ar").eq("active", true).single();
  if (error || !data) throw Error("Tienda no disponible");
  return data.id;
}
