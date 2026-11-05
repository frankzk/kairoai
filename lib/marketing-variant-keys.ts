// Clave por variante (talla/color) de los productos de un pedido (05/11/2026,
// módulo 5 "Inventario para decidir").
//
// El dataset de Finanzas da a los productos de iComfly un solo SKU aprendido
// por nombre (skusPorProducto en lib/icomfly-pedidos.ts): todos los Fat Burn
// caen en el mismo SKU. El título sí trae la variante ("Fat‑Burn Shorts … -
// Color: Negro · Talla: Talla única" o "… - Negro / Talla única"), así que
// aquí se busca en el catálogo el producto y su variante por nombre y se usa
// el SKU de esa variante. Si no se encuentra, la clave de siempre
// (orderItemKey). Solo para el insight de productos: el resumen global no
// cambia (movería los números de A2/M2).
//
// Puro: se prueba en tests/marketing-variant-keys.test.ts.
import { normalProductName } from "./marketing-product-families";
import type { NativeProduct } from "./marketing-product-groups-server";
import { orderItemKey } from "./marketing-real-orders";

export interface VariantIndex {
  /** `normalProductName(title)|normalVariant(variant)` → `sku:<sku lower>`. */
  byTitle: Map<string, string>;
  /** Normalized product titles, longest first (prefix search). */
  titles: string[];
}

/** "Color: Negro · Talla: Talla única" and "Negro / Talla única" → "negro talla unica". */
export function normalVariant(variant: string): string {
  return normalProductName(
    variant.replace(/\b(?:color|talla|size|tamano|tamaño)\s*:/gi, " "),
  );
}

export function buildVariantIndex(catalog: NativeProduct[]): VariantIndex {
  const byTitle = new Map<string, string>();
  const ambiguous = new Set<string>();
  const titles = new Set<string>();
  for (const product of catalog) {
    const title = normalProductName(String(product.title ?? ""));
    if (!title) continue;
    for (const raw of Array.isArray(product.variants) ? product.variants : []) {
      const variant = (raw ?? {}) as { sku?: unknown; title?: unknown };
      const sku = String(variant.sku ?? "").trim();
      const name = String(variant.title ?? "").trim();
      if (!sku || !name || /^default title$/i.test(name)) continue;
      const key = `${title}|${normalVariant(name)}`;
      const value = `sku:${sku.toLowerCase()}`;
      if (byTitle.has(key) && byTitle.get(key) !== value) ambiguous.add(key);
      byTitle.set(key, value);
      titles.add(title);
    }
  }
  // Two SKUs for the same title + variant cannot be told apart.
  ambiguous.forEach((key) => byTitle.delete(key));
  return {
    byTitle,
    titles: Array.from(titles).sort((a, b) => b.length - a.length),
  };
}

/**
 * Catalog variant key of an order item: the title is `product - variant`
 * (the product name may itself contain " - "). When the remainder holds
 * several variant texts, the last one wins (it is iComfly's variant field).
 */
export function variantItemKey(
  item: { sku?: string | null; title?: string | null },
  index: VariantIndex | null,
): string {
  const title = String(item.title ?? "").trim();
  if (index && title) {
    const parts = title.split(/\s+[-–—]\s+/);
    for (let cut = parts.length - 1; cut >= 1; cut--) {
      const product = normalProductName(parts.slice(0, cut).join(" - "));
      if (!index.titles.includes(product)) continue;
      const variants = parts.slice(cut);
      for (let i = variants.length - 1; i >= 0; i--) {
        const key = index.byTitle.get(
          `${product}|${normalVariant(variants[i])}`,
        );
        if (key) return key;
      }
    }
  }
  return orderItemKey(item);
}
