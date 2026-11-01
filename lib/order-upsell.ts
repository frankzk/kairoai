import { createHash } from "node:crypto";
import { buildManualOrder, matchesExpectedIcomflyOrder, type ExpectedIcomflyOrder, type ManualOrderLine } from "./icomfly-manual-order";

export type RemoteOrder = Record<string, unknown>;
export interface UpsellSelection { product_id: number; variant_id: string | null; quantity: number; price: number }
export interface UpsellReceipt {
  id: string; store_id: number; original_id: string; original_name: string;
  advisor_id: number; advisor_name: string; canal: string;
  source_fingerprint: string; payload: RemoteOrder; expected: ExpectedIcomflyOrder;
  creation_started_at: string | null; replacement_id: string | null;
  cancel_started_at: string | null; completed_at: string | null;
}
export const cents = (v: unknown): number => v == null || v === "" || !Number.isFinite(Number(v)) ? NaN : Math.round(Number(v) * 100);
export const orderItems = (o: RemoteOrder): RemoteOrder[] => Array.isArray(o.items) ? o.items as RemoteOrder[] : [];

/** Any evidence of a logistics handoff blocks replacement, even before a guide arrives. */
export function hasLogistics(o: RemoteOrder): boolean {
  const keys = ["tracking_number", "tracking_status", "carrier_name", "shipped_at", "effective_shipped_at",
    "drop_order_id", "dropi_order_id", "hoko_order_id", "boxya_order_id", "dropea_order_id", "envios99_order_id",
    "venndelo_order_id", "melonn_order_number", "skydropx_shipment_id", "mastershop_order_id", "boxful_shiphero_order_number",
    "drop_synced_at", "dropi_synced_at", "boxful_synced_at", "forza_synced_at", "melonn_synced_at"];
  const attr = (o.atribucion ?? {}) as RemoteOrder;
  return keys.some(k => Boolean(o[k])) || Boolean(attr.genero_guia || attr.envio);
}
export function assertReplaceable(o: RemoteOrder): void {
  if (!["Pendiente", "Confirmada"].includes(String(o.status)) || hasLogistics(o)) {
    throw new Error("Solo se puede añadir upsell a un pedido pendiente o confirmado que aún no pasó a logística.");
  }
}
export function sourceFingerprint(o: RemoteOrder): string {
  const customer = (o.customer ?? {}) as RemoteOrder;
  return createHash("sha256").update(JSON.stringify({
    id: o.id, store: o.store_id, total: cents(o.total), payment: o.payment_method,
    collection: o.collection_type, collectionValue: cents(o.collection_value),
    name: o.shipping_name, phone: o.shipping_phone, address: o.shipping_address,
    city: o.shipping_city, department: o.shipping_department, province: o.shipping_province,
    district: o.shipping_district, zip: o.shipping_zip, lat: o.shipping_lat, lng: o.shipping_lng,
    customer: { id: customer.id, phone: customer.phone, fullName: customer.fullName, full_name: customer.full_name, email: customer.email },
    notes: o.notes, shipping: o.order_shipping_cost,
    items: orderItems(o).map(i => [i.product_id, i.variant_id ?? null, i.quantity, cents(i.product_price), i.product_name, i.variant_name]),
  })).digest("hex");
}
export function originalLines(o: RemoteOrder): ManualOrderLine[] {
  const items = orderItems(o);
  if (!items.length) throw new Error("El pedido original no tiene líneas de catálogo verificables.");
  return items.map(i => {
    const productId = Number(i.product_id), quantity = Number(i.quantity), price = Number(i.product_price);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
      throw new Error("Hay un producto original sin ID, cantidad o precio válido. Revisa el pedido en iComfly.");
    }
    return { productId, productName: String(i.product_name ?? i.name ?? "Producto"),
      variantId: i.variant_id == null ? null : String(i.variant_id), variantName: i.variant_name == null ? null : String(i.variant_name), quantity, price };
  });
}
export function buildUpsellReplacement(o: RemoteOrder, line: ManualOrderLine, requestId: string, advisor: string, catalogSubtotal?: number) {
  assertReplaceable(o);
  // A paid order requires an additional collection arrangement. Do not silently charge it twice.
  if (o.is_no_collection === true || o.collection_type === "sin_recaudo" || !/contra\s*entrega|contraentrega|cod/i.test(String(o.payment_method))) {
    throw new Error("Este flujo requiere un pedido contra entrega. El pago anticipado necesita revisar el cobro del upsell.");
  }
  const lines = [...originalLines(o), line];
  const customer = (o.customer ?? {}) as RemoteOrder;
  const phone = String(o.shipping_phone || customer.phone || "").trim();
  const name = String(o.shipping_name || customer.fullName || customer.full_name || "").trim();
  const address = String(o.shipping_address || "").trim();
  const city = String(o.shipping_city || "").trim();
  const department = String(o.shipping_department || o.shipping_province || "").trim();
  if (!phone || !name || !address || !city || !department) throw new Error("Completa los datos de envío del pedido original antes de añadir el upsell.");
  if (!Number.isFinite(cents(o.total)) || cents(o.total) < 0) throw new Error("El total original no es válido.");
  const result = buildManualOrder({
    items: lines.map(l => ({ title: l.productName, price: l.price, quantity: l.quantity })),
    envio: { name, address, canton: city, province: department }, nombreLead: name, telefono: phone, pago: "cod",
  }, lines, Number(o.store_id), requestId);
  const total = (cents(o.total) + cents(line.price) * line.quantity) / 100;
  const subtotal = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  result.body.total = total;
  result.body.notes = [String(o.notes || ""), `Upsell cerrado por ${advisor} en Gestión de Kairo. Reemplaza el pedido ${o.order_number} (ID ${o.id}).`,
    `Importe original: ${Number(o.total)}. Upsell: ${line.quantity} x ${line.productName} a ${line.price} por unidad. Nuevo total acordado: ${total}.`].filter(Boolean).join("\n");
  result.body.shippingCost = Number(o.order_shipping_cost) || 0;
  for (const key of ["shipping_district", "shipping_province", "shipping_zip", "shipping_lat", "shipping_lng"]) {
    if (o[key] != null) result.body[key] = o[key];
  }
  result.expected.total = total;
  if (catalogSubtotal != null) {
    if (!Number.isFinite(catalogSubtotal) || catalogSubtotal < 0) throw new Error("El subtotal de catálogo no es válido.");
    result.expected.catalog_subtotal = Math.round((catalogSubtotal + Number(result.body.shippingCost)) * 100) / 100;
  }
  return { ...result, gross: Math.round(subtotal * 100) / 100 };
}
export function matchesReplacement(o: RemoteOrder, receipt: UpsellReceipt, checkTotal = true): boolean {
  const p = receipt.payload;
  return Number(o.store_id) === Number(p.store_id) && String(o.order_number) === String(p.orderNumber) &&
    matchesExpectedIcomflyOrder(o, { ...receipt.expected, total: checkTotal ? receipt.expected.total : Number(o.total) }) &&
    ["shipping_name", "shipping_phone", "shipping_address", "shipping_city", "shipping_department", "shipping_district", "shipping_province", "shipping_zip"].every(k => String(o[k] ?? "") === String(p[k] ?? ""));
}

export interface UpsellDependencies {
  read: (id: string) => Promise<RemoteOrder>;
  findCreated: (reference: string) => Promise<RemoteOrder | null>;
  create: (payload: RemoteOrder) => Promise<RemoteOrder>;
  patch: (changes: Partial<UpsellReceipt>) => Promise<void>;
  setTotal: (id: string, total: number) => Promise<void>;
  setCod: (id: string) => Promise<void>;
  /** Recover the catalog check missing from attempts saved before price reconciliation. */
  catalogTotals?: (replacement: RemoteOrder) => Promise<number[]>;
  changeStatus: (id: string, status: string, reason: string) => Promise<void>;
  finish: (original: RemoteOrder, replacement: RemoteOrder) => Promise<void>;
}

/** Durable saga. A creation with an unknown outcome is reconciled, never submitted twice. */
export async function runUpsellReplacement(r: UpsellReceipt, d: UpsellDependencies): Promise<{ complete: boolean; message?: string; replacement?: RemoteOrder }> {
  if (r.completed_at) return { complete: true };
  const save = async (changes: Partial<UpsellReceipt>) => { await d.patch(changes); Object.assign(r, changes); };
  let original = await d.read(r.original_id);
  const checkOriginal = () => {
    if (sourceFingerprint(original) !== r.source_fingerprint) throw new Error("El pedido original cambió. Revisa ambos pedidos antes de continuar.");
    if (!(original.status === "Cancelado" && r.cancel_started_at)) assertReplaceable(original);
    if (hasLogistics(original)) throw new Error("El pedido original pasó a logística. Revisa ambos pedidos.");
  };
  checkOriginal();
  if (!r.replacement_id) {
    if (r.creation_started_at) {
      const found = await d.findCreated(String(r.payload.orderNumber));
      if (!found) return { complete: false, message: "La creación aún no tiene confirmación. Vuelve a verificar; no se enviará otro pedido." };
      if (!matchesReplacement(found, r, false)) throw new Error("El pedido encontrado no coincide con este upsell. Requiere revisión.");
      await save({ replacement_id: String(found.id) });
    } else {
      await save({ creation_started_at: new Date().toISOString() });
      try {
        const created = await d.create(r.payload);
        if (!/^[1-9]\d*$/.test(String(created.id ?? ""))) return { complete: false, message: "iComfly no devolvió una referencia. Continúa verificando esta operación." };
        await save({ replacement_id: String(created.id) });
      } catch {
        return { complete: false, message: "La solicitud quedó sin respuesta confirmada. Continúa verificando esta operación; el original sigue sin anularse." };
      }
    }
  }
  let replacement = await d.read(r.replacement_id!);
  if (!matchesReplacement(replacement, r, false)) throw new Error("Los productos o el envío del nuevo pedido no coinciden. El original no se anula.");
  if (hasLogistics(replacement) || !["Pendiente", "Confirmada"].includes(String(replacement.status))) throw new Error("El nuevo pedido cambió o pasó a logística. Revisa ambos pedidos.");
  if (replacement.status === "Confirmada" && !r.cancel_started_at) throw new Error("El nuevo pedido se confirmó fuera de este flujo. Revisa ambos pedidos antes de anular el original.");
  const target = cents(r.expected.total);
  if (cents(replacement.total) !== target) {
    const gross = (r.payload.products as Array<{ price: number; quantity: number }>).reduce((n, l) => n + cents(l.price) * l.quantity, 0) + cents(r.payload.shippingCost ?? 0);
    const allowedTotals = [gross];
    if (r.expected.catalog_subtotal != null && Number.isFinite(cents(r.expected.catalog_subtotal))) allowedTotals.push(cents(r.expected.catalog_subtotal));
    if (!allowedTotals.includes(cents(replacement.total)) && d.catalogTotals && replacement.status === "Pendiente") {
      const totals = await d.catalogTotals(replacement);
      const matched = totals.find(total => Number.isFinite(cents(total)) && total >= 0 && cents(total) === cents(replacement.total));
      if (matched != null) {
        await save({ expected: { ...r.expected, catalog_subtotal: matched } });
        allowedTotals.push(cents(matched));
      }
    }
    if (replacement.status !== "Pendiente" || !allowedTotals.includes(cents(replacement.total))) throw new Error("El total del nuevo pedido cambió. Revisa el importe sin volver a crearlo.");
    await d.setTotal(r.replacement_id!, r.expected.total);
  }
  if (replacement.collection_type !== "con_recaudo" || cents(replacement.collection_value) !== target || cents(replacement.total) !== target) {
    await d.setCod(r.replacement_id!);
  }
  replacement = await d.read(r.replacement_id!);
  if (!matchesReplacement(replacement, r) || replacement.collection_type !== "con_recaudo" || cents(replacement.collection_value) !== target || hasLogistics(replacement)) {
    throw new Error("iComfly aún no confirma los productos, el importe o el cobro acordados. Continúa la operación para verificar.");
  }
  // A fresh read immediately before cancellation catches edits made during creation.
  original = await d.read(r.original_id);
  checkOriginal();
  if (original.status !== "Cancelado") {
    await save({ cancel_started_at: new Date().toISOString() });
    await d.changeStatus(r.original_id, "Cancelado", `Reemplazado por pedido con upsell ${replacement.order_number} (ID ${replacement.id}). Evitar doble despacho y cobro.`);
  }
  original = await d.read(r.original_id);
  if (original.status !== "Cancelado" || hasLogistics(original)) throw new Error("Falta verificar la anulación del original. Continúa esta operación.");
  if (replacement.status !== "Confirmada") {
    await d.changeStatus(r.replacement_id!, "Confirmada", `Upsell confirmado por ${r.advisor_name}. Reemplaza ${r.original_name}.`);
  }
  replacement = await d.read(r.replacement_id!);
  if (replacement.status !== "Confirmada" || !matchesReplacement(replacement, r) || hasLogistics(replacement) || replacement.collection_type !== "con_recaudo" || cents(replacement.collection_value) !== target) {
    throw new Error("El original está anulado; falta verificar el nuevo pedido confirmado. Continúa esta operación.");
  }
  await d.finish(original, replacement);
  return { complete: true, replacement };
}
