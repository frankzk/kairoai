import { describe, expect, it, vi } from "vitest";
import { assertReplaceable, buildUpsellReplacement, hasLogistics, matchesReplacement, runUpsellReplacement, sourceFingerprint, type RemoteOrder, type UpsellDependencies, type UpsellReceipt } from "../lib/order-upsell";
import { selectedUpsellLine } from "../lib/order-upsell-catalog";

function source(): RemoteOrder {
  return { id: 10, store_id: 71, status: "Pendiente", order_number: "WEB123", total: 16915,
    payment_method: "Cash on Delivery (COD)", collection_type: "con_recaudo", collection_value: 16915,
    shipping_name: "Cliente de prueba", shipping_phone: "50600000000", shipping_address: "Dirección de prueba", shipping_city: "San José", shipping_department: "San José",
    shipping_district: "Carmen", notes: "Referencia de entrega", customer: { id: 3, phone: "50600000000" },
    items: [{ product_id: 100, product_name: "Producto original", variant_id: "red", variant_name: "Rojo", quantity: 1, product_price: 19900 }] };
}
const extra = { productId: 200, productName: "Upsell", variantId: null, variantName: null, price: 5000, quantity: 2 };
function fixture() {
  const original = source();
  const built = buildUpsellReplacement(original, extra, "a8e6f043-4e50-402c-89b3-b78e33a64532", "Asesora");
  const r: UpsellReceipt = { id: "request", store_id: 1, original_id: "10", original_name: "IC-W23", advisor_id: 2, advisor_name: "Asesora", canal: "llamada",
    source_fingerprint: sourceFingerprint(original), payload: built.body, expected: built.expected, creation_started_at: null, replacement_id: null, cancel_started_at: null, completed_at: null };
  const replacement: RemoteOrder = { ...built.body, id: 20, order_number: built.body.orderNumber, total: built.expected.total,
    collection_type: "con_recaudo", collection_value: built.expected.total,
    items: [original.items as RemoteOrder[]].flat().concat([{ product_id: 200, product_name: "Upsell", variant_id: null, quantity: 2, product_price: 5000 }]) };
  const log: string[] = [];
  const deps: UpsellDependencies = {
    read: vi.fn(async id => structuredClone(id === "10" ? original : replacement)),
    findCreated: vi.fn(async () => structuredClone(replacement)),
    create: vi.fn(async () => { log.push("create"); return { id: 20 }; }),
    patch: vi.fn(async changes => { log.push("save:" + Object.keys(changes)[0]); }),
    setTotal: vi.fn(async (_id, total) => { replacement.total = total; }),
    setCod: vi.fn(async () => { replacement.collection_type = "con_recaudo"; replacement.collection_value = replacement.total; }),
    changeStatus: vi.fn(async (id, status) => { log.push(status); (id === "10" ? original : replacement).status = status; }),
    finish: vi.fn(async () => { log.push("finish"); r.completed_at = "now"; }),
  };
  return { original, replacement, r, deps, log };
}

describe("preparar un upsell", () => {
  it("conserva variantes, cantidades, descuento original, dirección y notas", () => {
    const built = buildUpsellReplacement(source(), extra, "request", "Asesora");
    expect(built.expected.total).toBe(26915);
    expect(built.body.products).toEqual([
      { id: 100, name: "Producto original (Rojo)", price: 19900, quantity: 1, variantId: "red", variantName: "Rojo" },
      { id: 200, name: "Upsell", price: 5000, quantity: 2, variantId: null, variantName: null },
    ]);
    expect(built.body).toMatchObject({ shipping_district: "Carmen", status: "Pendiente", send_confirmation: false, send_to_shopify: false });
    expect(built.body.notes).toContain("Referencia de entrega");
  });
  it.each(["tracking_number", "shipped_at", "boxful_synced_at", "dropi_order_id", "boxful_shiphero_order_number", "tracking_status"])("bloquea un pedido con %s", key => {
    expect(() => assertReplaceable({ ...source(), [key]: "logística" })).toThrow();
  });
  it("bloquea solicitud de guía, cancelados y pagos anticipados", () => {
    expect(hasLogistics({ atribucion: { genero_guia: { at: "hoy" } } })).toBe(true);
    expect(() => assertReplaceable({ ...source(), status: "Cancelado" })).toThrow();
    expect(() => buildUpsellReplacement({ ...source(), payment_method: "Sinpe" }, extra, "request", "Asesora")).toThrow(/pago anticipado/);
  });
  it("valida la variante exacta y el precio del upsell", () => {
    const p = { id: 200, store_id: 71, name: "Upsell", variants: [{ id: "xl", name: "XL", price: 5000 }] };
    expect(() => selectedUpsellLine(p, { product_id: 200, variant_id: null, price: 5000, quantity: 1 })).toThrow(/variante/);
    expect(() => selectedUpsellLine(p, { product_id: 200, variant_id: "xl", price: -1, quantity: 1 })).toThrow();
    expect(selectedUpsellLine(p, { product_id: 200, variant_id: "xl", price: 4500, quantity: 2 })).toMatchObject({ variantId: "xl", price: 4500, quantity: 2 });
  });
  it("ignora metadatos cambiantes del cliente pero detecta cambios en la dirección", () => {
    const o = source();
    expect(sourceFingerprint({ ...o, customer: { ...(o.customer as object), updated_at: "later" } })).toBe(sourceFingerprint(o));
    expect(sourceFingerprint({ ...o, shipping_address: "Otra dirección" })).not.toBe(sourceFingerprint(o));
  });
});

describe("reemplazar y confirmar sin duplicar", () => {
  it("guarda antes de crear, verifica, anula y confirma en ese orden", async () => {
    const f = fixture();
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(true);
    expect(f.log).toEqual(["save:creation_started_at", "create", "save:replacement_id", "save:cancel_started_at", "Cancelado", "Confirmada", "finish"]);
  });
  it("no repite creación después de un timeout aunque el pedido sí exista", async () => {
    const f = fixture(); f.deps.create = vi.fn(async () => { throw new Error("timeout"); });
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(false);
    expect(f.original.status).toBe("Pendiente");
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(true);
    expect(f.deps.create).toHaveBeenCalledTimes(1);
    expect(f.deps.findCreated).toHaveBeenCalledWith(f.r.payload.orderNumber);
  });
  it("no reenvía si no puede encontrar el pedido tras perder la respuesta", async () => {
    const f = fixture(); f.r.creation_started_at = "now"; f.deps.findCreated = vi.fn(async () => null);
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(false);
    expect(f.deps.create).not.toHaveBeenCalled(); expect(f.deps.changeStatus).not.toHaveBeenCalled();
  });
  it("un producto, variante o dirección diferente impide anular el original", async () => {
    for (const change of [{ items: [{ product_id: 999, quantity: 1 }] }, { shipping_address: "Otra" }, { store_id: 72 }]) {
      const f = fixture(); Object.assign(f.replacement, change);
      await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow(/no coinciden/);
      expect(f.deps.changeStatus).not.toHaveBeenCalled();
    }
  });
  it("reconcilia el descuento y el recaudo antes de anular", async () => {
    const f = fixture(); f.replacement.total = 29900; f.replacement.collection_value = 29900;
    await runUpsellReplacement(f.r, f.deps);
    expect(f.deps.setTotal).toHaveBeenCalledWith("20", 26915);
    expect(f.deps.setCod).toHaveBeenCalledWith("20");
    expect(f.original.status).toBe("Cancelado");
  });
  it("no sobrescribe un importe ajeno", async () => {
    const f = fixture(); f.replacement.total = 12345;
    await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow(/total/);
    expect(f.deps.setTotal).not.toHaveBeenCalled(); expect(f.deps.changeStatus).not.toHaveBeenCalled();
  });
  it("relee el original antes de anular por si cambió durante la creación", async () => {
    const f = fixture(); f.deps.create = vi.fn(async () => { f.original.shipping_address = "Otra"; return { id: 20 }; });
    await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow(/original cambió/);
    expect(f.deps.changeStatus).not.toHaveBeenCalled();
  });
  it("reanuda tras anular el original y perder la confirmación", async () => {
    const f = fixture(); const change = f.deps.changeStatus;
    f.deps.changeStatus = vi.fn(async (id, status, reason) => { if (status === "Confirmada") throw new Error("timeout"); await change(id, status, reason); });
    await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow("timeout");
    expect(f.original.status).toBe("Cancelado");
    f.deps.changeStatus = change;
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(true);
    expect(f.deps.create).toHaveBeenCalledTimes(1);
  });
  it("reanuda si la anulación se aplicó y su respuesta se perdió", async () => {
    const f = fixture(); const change = f.deps.changeStatus;
    f.deps.changeStatus = vi.fn(async (id, status, reason) => { await change(id, status, reason); if (status === "Cancelado") throw new Error("timeout"); });
    await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow("timeout");
    f.deps.changeStatus = change;
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(true);
    expect(f.log.filter(x => x === "Cancelado")).toHaveLength(1);
  });
  it("no declara éxito si la confirmación no se reflejó", async () => {
    const f = fixture(); f.deps.changeStatus = vi.fn(async (id, status) => { if (id === "10") f.original.status = status; });
    await expect(runUpsellReplacement(f.r, f.deps)).rejects.toThrow(/falta verificar/);
    expect(f.deps.finish).not.toHaveBeenCalled();
  });
  it("un recibo completo no vuelve a tocar iComfly", async () => {
    const f = fixture(); f.r.completed_at = "now";
    expect((await runUpsellReplacement(f.r, f.deps)).complete).toBe(true);
    expect(f.deps.read).not.toHaveBeenCalled();
  });
  it("detecta un cambio de variante aunque el total sea correcto", () => {
    const f = fixture(); (f.replacement.items as RemoteOrder[])[0].variant_id = "blue";
    expect(matchesReplacement(f.replacement, f.r)).toBe(false);
  });
});
