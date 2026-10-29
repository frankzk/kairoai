import { normalizarNombreProducto, totalPedidoLead, type ItemPedidoLead, type PedidoLead } from "@/lib/icomfly-pedido-lead";

export interface IcomflyCatalogProduct {
  id: unknown;
  store_id: unknown;
  name: string;
  variants?: unknown;
}
export interface ManualOrderLine {
  productId: number;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  price: number;
  quantity: number;
}
export interface ExpectedIcomflyOrder {
  items: Array<{ product_id: number; variant_id: string | null; quantity: number }>;
  total: number;
}

function variantsOf(raw: unknown): Array<Record<string, unknown>> {
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { throw new Error("El catálogo devolvió variantes inválidas."); }
  }
  if (raw && !Array.isArray(raw) && typeof raw === "object") raw = (raw as Record<string, unknown>).generatedVariants;
  return Array.isArray(raw) ? raw.filter(v => v && typeof v === "object") : [];
}

export function resolveManualOrderLine(item: ItemPedidoLead, product: IcomflyCatalogProduct, externalStoreId: number): ManualOrderLine {
  const productId = Number(product.id);
  if (!Number.isSafeInteger(productId) || productId <= 0 || Number(product.store_id) !== externalStoreId) {
    throw new Error("El producto no pertenece al catálogo de esta tienda.");
  }
  if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price) || item.price <= 0) {
    throw new Error("Cada producto requiere cantidad entera y precio mayor que cero.");
  }
  const variants = variantsOf(product.variants);
  let selected: Record<string, unknown> | undefined;
  const sku = item.sku?.trim();
  const title = item.variant_title?.trim();
  if (variants.length) {
    const skuMatches = sku ? variants.filter(v => [v.sku, v.shiphero_sku].some(s => s != null && String(s).trim() === sku)) : [];
    const titleMatches = title && title !== "Default Title" ? variants.filter(v => {
      const combination = v.combination && typeof v.combination === "object" ? Object.values(v.combination).join(" / ") : "";
      return [v.name, v.title, combination].some(n => n && normalizarNombreProducto(String(n)) === normalizarNombreProducto(title));
    }) : [];
    if (skuMatches.length === 1) selected = skuMatches[0];
    else if (titleMatches.length === 1) selected = titleMatches[0];
    else if (!sku && (!title || title === "Default Title") && variants.length === 1) selected = variants[0];
    if (!selected || !selected.id || (skuMatches.length === 1 && titleMatches.length === 1 && skuMatches[0] !== titleMatches[0])) {
      throw new Error('No se pudo identificar una variante única de "' + product.name + '". Revisa su SKU y talla/color en iComfly.');
    }
  }
  return {
    productId, productName: product.name,
    variantId: selected ? String(selected.id) : null,
    variantName: selected ? String(selected.name ?? selected.title ?? title ?? "") || null : null,
    price: item.price, quantity: item.quantity,
  };
}

export function buildManualOrder(pedido: PedidoLead, lines: ManualOrderLine[], externalStoreId: number, requestId: string): {
  body: Record<string, unknown>; expected: ExpectedIcomflyOrder;
} {
  if (lines.length < 2 || lines.length !== pedido.items.length) throw new Error("Faltan productos del catálogo para crear el pedido.");
  const subtotal = Math.round(lines.reduce((n, l) => n + l.price * l.quantity, 0) * 100) / 100;
  const total = totalPedidoLead(pedido.items, pedido.descuento);
  const discount = Math.round((subtotal - total) * 100) / 100;
  if (total < 0 || total > subtotal) throw new Error("El descuento del pedido no es válido.");
  const shipping = pedido.envio;
  const first = lines[0];
  return {
    body: {
      orderNumber: "MANUAL-KAIRO-" + requestId,
      manual_order: true, store_id: externalStoreId,
      customer: {
        fullName: shipping.name?.trim() || pedido.nombreLead?.trim() || "Cliente",
        phone: pedido.telefono, whatsapp: pedido.telefono,
        address: [shipping.address?.trim(), shipping.reference?.trim()].filter(Boolean).join(" - "),
        city: shipping.canton?.trim() || "", department: shipping.province?.trim() || "",
      },
      product: { id: first.productId, name: first.productName, price: first.price },
      isCartOrder: true,
      products: lines.map(l => ({
        id: l.productId, name: l.variantName ? l.productName + " (" + l.variantName + ")" : l.productName,
        price: l.price, quantity: l.quantity, variantId: l.variantId, variantName: l.variantName,
      })),
      quantity: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal, shippingCost: 0, total,
      ...(discount > 0 ? { discountAmount: discount, discountType: pedido.descuento?.type === "percentage" ? "percent" : "fixed", discountValue: pedido.descuento?.value } : {}),
      shippingOption: "Domicilio", paymentMethod: pedido.pago === "sinpe" ? "Transferencia" : "Contraentrega",
      payment_type: pedido.pago === "sinpe" ? "paid" : "cod",
      status: "Pendiente", send_to_shopify: false, send_confirmation: false,
      notes: "Cerrado por la asesora desde el tablero de Leads (Kairo)." + (pedido.nota?.trim() ? " " + pedido.nota.trim() : ""),
    },
    expected: {
      items: lines.map(l => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity })),
      total,
    },
  };
}

export function matchesExpectedIcomflyOrder(row: Record<string, unknown>, expected: ExpectedIcomflyOrder): boolean {
  if (!Number.isFinite(Number(row.total)) || Math.round(Number(row.total) * 100) !== Math.round(expected.total * 100)) return false;
  if (!Array.isArray(row.items) || row.items.length === 0) return false;
  const quantities = (items: Array<Record<string, unknown>>) => {
    const result = new Map<string, number>();
    for (const item of items) {
      const id = Number(item.product_id), quantity = Number(item.quantity);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
      const key = id + ":" + (item.variant_id == null ? "" : String(item.variant_id));
      result.set(key, (result.get(key) || 0) + quantity);
    }
    return result;
  };
  const actual = quantities(row.items as Array<Record<string, unknown>>), wanted = quantities(expected.items);
  return !!actual && !!wanted && actual.size === wanted.size && Array.from(wanted).every(([key, q]) => actual.get(key) === q);
}

