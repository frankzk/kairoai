import { getDB } from "./db";
import { identidadActual } from "./identidad";

export function mexicoAccess(): boolean {
  const who = identidadActual();
  return Boolean(who && (who.id === 0 || who.tiendas.includes("kenku-mx")) && who.permisos.some(p => p === "pedidos" || p === "finanzas"));
}
export async function mexicoStoreId(): Promise<number> {
  const {data, error} = await getDB().from("stores").select("id").eq("code", "kenku-mx").eq("active", true).single();
  if (error || !data) throw Error("Tienda no disponible");
  return data.id;
}
