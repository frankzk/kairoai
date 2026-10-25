import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_WOO_BODY = 256 * 1024;
export class WooInputError extends Error {}
const fail = (field: string): never => { throw new WooInputError(`Campo inválido: ${field}`); };
const obj = (v: unknown, field: string): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(field);
function str(v: unknown, field: string, max: number, optional = false): string {
  if (optional && (v === undefined || v === null || v === "")) return "";
  if (typeof v !== "string" || !v.trim() || v.length > max) return fail(field);
  return v.trim();
}
function number(v: unknown, field: string, integer = false): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e9 || (integer && !Number.isSafeInteger(v))) return fail(field);
  return v;
}
export function validWooSignature(body: Buffer, signature: string | null, secret: string): boolean {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature || "")) return false;
  const supplied = Buffer.from(signature!.slice(7), "hex");
  return timingSafeEqual(createHmac("sha256", secret).update(body).digest(), supplied);
}
export async function readWooBody(req: Request): Promise<Buffer> {
  if (Number(req.headers.get("content-length")) > MAX_WOO_BODY) throw new WooInputError("Cuerpo demasiado grande");
  const reader = req.body?.getReader();
  if (!reader) throw new WooInputError("Cuerpo vacío");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > MAX_WOO_BODY) { await reader.cancel(); throw new WooInputError("Cuerpo demasiado grande"); }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export function normalizeWooPayload(input: unknown, origins: string[]) {
  const p = obj(input, "payload"), o = obj(p.order, "order"), c = obj(p.customer, "customer"), a = obj(p.address, "address");
  if (p.event !== "order.created") fail("event");
  const site = str(p.site, "site", 255);
  // Exact origins only; never use a URL supplied by the webhook to make requests.
  if (!origins.includes(site.replace(/\/$/, ""))) fail("site");
  if (o.currency !== "EUR" || a.country !== "IT" || o.payment_method !== "cod" || o.status !== "cod-pending") fail("país, moneda, pago o estado");
  const id = number(o.id, "order.id", true); if (id < 1) fail("order.id");
  const postcode = str(a.postcode, "CAP", 5); if (!/^\d{5}$/.test(postcode)) fail("CAP");
  let phone = str(c.phone, "phone", 30).replace(/[\s().-]/g, "");
  if (phone.startsWith("0039")) phone = "+39" + phone.slice(4);
  if (/^393\d{8,9}$/.test(phone)) phone = "+" + phone;
  if (!/^\+393\d{8,9}$/.test(phone)) fail("phone");
  const created = str(o.created_at, "created_at", 50);
  if (!/^\d{4}-\d\d-\d\dT/.test(created) || !Number.isFinite(Date.parse(created))) fail("created_at");
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 100) fail("items");
  const items = (p.items as unknown[]).map((v) => {
    const i = obj(v, "item"), quantity = number(i.quantity, "quantity", true);
    if (!quantity || quantity > 1000) fail("quantity");
    return { product_id: number(i.product_id, "product_id", true), variation_id: number(i.variation_id ?? 0, "variation_id", true),
      sku: str(i.sku, "sku", 150, true), name: str(i.name, "name", 500), quantity, total: number(i.total, "item.total") };
  });
  const territory = a.territory ? obj(a.territory, "territory") : {};
  const total = number(o.total, "total"); if (!total) fail("total");
  return {
    woo_id: id, order_number: str(o.number, "number", 80), created_at: new Date(created).toISOString(),
    customer_name: [str(c.first_name, "first_name", 150), str(c.last_name, "last_name", 150, true)].filter(Boolean).join(" "),
    phone, email: str(c.email, "email", 254, true), currency: "EUR", total,
    shipping: number(o.shipping, "shipping"), discount: number(o.discount, "discount"), items,
    address: { country: "IT", state: str(a.state, "state", 10), city: str(a.city, "city", 150),
      address_1: str(a.address_1, "address_1", 500), address_2: str(a.address_2, "address_2", 500, true), postcode,
      region: str(territory.region, "region", 150, true), province: str(territory.province, "province", 150, true),
      territory_code: str(territory.code, "territory_code", 20, true) },
    note: str(o.note, "note", 5000, true), source: "woocommerce", source_channel: str(o.created_via, "created_via", 100, true),
    marketing_consent: c.subscribed === true, site,
  };
}
export type WooPayload = ReturnType<typeof normalizeWooPayload>;
