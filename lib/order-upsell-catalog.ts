import type { IcomflyCatalogProduct, ManualOrderLine } from "./icomfly-manual-order";
import type { UpsellSelection } from "./order-upsell";

export interface UpsellProductOption { product_id: number; variant_id: string | null; name: string; price: number }
export function upsellProductOptions(product: IcomflyCatalogProduct & Record<string, unknown>): UpsellProductOption[] {
  let variants = product.variants;
  if (typeof variants === "string") variants = JSON.parse(variants);
  if (variants && !Array.isArray(variants) && typeof variants === "object") variants = (variants as Record<string, unknown>).generatedVariants;
  const rows = Array.isArray(variants) ? variants as Array<Record<string, unknown>> : [];
  if (!rows.length) return [{ product_id: Number(product.id), variant_id: null, name: product.name, price: Number(product.price) || 0 }];
  return rows.filter(v => v.id != null).map(v => ({
    product_id: Number(product.id), variant_id: String(v.id),
    name: `${product.name} · ${v.name || v.title || Object.values((v.combination ?? {}) as object).join(" / ") || v.id}`,
    price: Number(v.price ?? product.price) || 0,
  }));
}
export function selectedUpsellLine(product: IcomflyCatalogProduct & Record<string, unknown>, input: UpsellSelection): ManualOrderLine {
  if (Number(product.id) !== input.product_id || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100 || !Number.isFinite(input.price) || input.price <= 0 || Math.round(input.price * 100) / 100 !== input.price) {
    throw new Error("El upsell requiere un producto, cantidad entera y precio mayor que cero con hasta dos decimales.");
  }
  const option = upsellProductOptions(product).find(o => o.variant_id === input.variant_id);
  if (!option) throw new Error("Selecciona una variante válida del producto.");
  return { productId: input.product_id, productName: product.name, variantId: input.variant_id,
    variantName: input.variant_id ? option.name.slice(product.name.length + 3) : null, price: input.price, quantity: input.quantity };
}

export function catalogSubtotalForUpsell(lines: ManualOrderLine[], products: Array<IcomflyCatalogProduct & Record<string, unknown>>): number {
  if (lines.length !== products.length) throw new Error("Falta verificar el catálogo del pedido.");
  return lines.reduce((sum, line, i) => {
    const product = products[i];
    const option = Number(product.id) === line.productId ? upsellProductOptions(product).find(p => p.variant_id === line.variantId) : null;
    if (!option || !Number.isFinite(option.price) || option.price < 0) throw new Error("No se pudo verificar el precio de catálogo de un producto del pedido.");
    return sum + Math.round(option.price * 100) * line.quantity;
  }, 0) / 100;
}

/** Native order creation can apply an exact quantity offer to a catalog line. */
export function catalogTotalsForUpsell(lines: ManualOrderLine[], products: Array<IcomflyCatalogProduct & Record<string, unknown>>): number[] {
  const gross = catalogSubtotalForUpsell(lines, products);
  const offered = lines.reduce((sum, line, i) => {
    const product = products[i];
    const unit = upsellProductOptions(product).find(p => p.variant_id === line.variantId)!.price;
    const base = Math.round(unit * 100) * line.quantity;
    let offers = product.quantity_offers;
    if (typeof offers === "string") offers = JSON.parse(offers);
    const prices = Array.isArray(offers) ? offers.flatMap(offer => {
      const o = offer as Record<string, unknown>;
      const price = Number(o.fixed_price);
      // Only the exact quantity and an explicit fixed total are authoritative.
      return Number(o.quantity) === line.quantity && o.fixed_price != null && o.fixed_price !== "" && Number.isFinite(price) && price >= 0 && Math.round(price * 100) <= base
        ? [Math.round(price * 100)] : [];
    }) : [];
    return sum + Math.min(base, ...prices);
  }, 0) / 100;
  return Array.from(new Set([gross, offered]));
}
