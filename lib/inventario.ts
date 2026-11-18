// Inventario de ShipHero (bodega de Boxful) para el equipo: Leads, Gestion,
// Novedades... (Mejoras Kairo N.º 1, 18/11/2026). Antes el stock solo se veia
// en ShipHero y el equipo le preguntaba a la lider de tienda si habia.
//
// Puro: se prueba en tests/inventario.test.ts.

export interface ItemInventario {
  sku: string;
  nombre: string;
  disponible: number;
  enBodega: number;
  reservado: number;
  /** Pedidos esperando stock (backorder); null = sin dato. */
  pendientes: number | null;
  /** Unidades en camino (ordenes de compra abiertas); null = sin dato. */
  enCamino: number | null;
}

export type EstadoStock = "agotado" | "pocas" | "con_stock";
export type FiltroInventario = "todos" | EstadoStock;

/** Unidades desde las que un producto se marca "Pocas unidades". */
export const POCAS_UNIDADES = 10;

export function estadoStock(disponible: number): EstadoStock {
  if (disponible <= 0) return "agotado";
  if (disponible <= POCAS_UNIDADES) return "pocas";
  return "con_stock";
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Filtra por texto (nombre o SKU, sin acentos) y estado; ordena por nombre. */
export function filtrarInventario(items: ItemInventario[], texto: string, filtro: FiltroInventario): ItemInventario[] {
  const q = sinAcentos(texto.trim());
  return items
    .filter((i) => (filtro === "todos" ? true : estadoStock(i.disponible) === filtro))
    .filter((i) => !q || sinAcentos(`${i.nombre} ${i.sku}`).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.sku.localeCompare(b.sku));
}

export function contarInventario(items: ItemInventario[]): Record<FiltroInventario, number> {
  const out: Record<FiltroInventario, number> = { todos: items.length, agotado: 0, pocas: 0, con_stock: 0 };
  for (const i of items) out[estadoStock(i.disponible)] += 1;
  return out;
}
