import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { identidadActual, vendedoraEfectiva } from "@/lib/identidad";
import { canManageOrderUpsell, MENSAJE_UPSELL_SIN_PERMISO } from "@/lib/order-upsell-access";
import { getDB } from "@/lib/db";
import { createManualIcomflyOrder, getIcomflyCatalogProduct, getIcomflyExternalStoreId, getIcomflyOrder, normalizeIcomflyOrder } from "@/lib/icomfly";
import { llamarHerramientaIcomfly, tiendaDeLaConexion } from "@/lib/icomfly-mcp";
import { buildIcomflyOrderRow } from "@/lib/dispatch";
import { nombrePedidoIcomfly } from "@/lib/icomfly-pedidos";
import { assertReplaceable, buildUpsellReplacement, hasLogistics, matchesReplacement, originalLines, runUpsellReplacement, sourceFingerprint, type UpsellSelection } from "@/lib/order-upsell";
import { catalogSubtotalForUpsell, catalogTotalsForUpsell, selectedUpsellLine, upsellProductOptions } from "@/lib/order-upsell-catalog";
import { archiveCancelledOrderUpsell, findOrderUpsell, lockOrderUpsell, patchOrderUpsell, reserveOrderUpsell, resolveUpsellOriginal, unlockOrderUpsell, type StoredUpsell } from "@/lib/order-upsell-db";
import { isValidCanal } from "@/lib/order-events";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const errorMessage = (e: unknown) => e instanceof Error ? e.message : "No se pudo procesar el upsell.";
const publicReceipt = (r: StoredUpsell, cancelled = false) => ({ id: r.id, completed: Boolean(r.completed_at), replacement_id: r.replacement_id, cancelled,
  replacement_name: r.replacement_name, original_name: r.original_name, total: r.expected.total, selection: r.selection,
  message: r.completed_at ? "Pedido con upsell confirmado." : cancelled ? "El pedido adicional se canceló en iComfly. Puedes archivar este intento e iniciar otro upsell." : "Hay un upsell en curso. Continúa esta operación para verificar ambos pedidos." });
const originalPreview = (original: Record<string, unknown>, name: string) => ({ id: String(original.id), name, total: Number(original.total),
  fingerprint: sourceFingerprint(original), items: originalLines(original).map(l => ({ name: l.variantName ? `${l.productName} · ${l.variantName}` : l.productName, quantity: l.quantity, price: l.price })) });
function canWrite() { const yo = identidadActual(); return !yo || canManageOrderUpsell(yo.permisos); }

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  if (!canWrite()) return NextResponse.json({ error: MENSAJE_UPSELL_SIN_PERMISO }, { status: 403 });
  try {
    if (req.nextUrl.searchParams.has("q")) {
      const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
      if (q.length < 3 || q.length > 100) return NextResponse.json({ products: [] });
      const result = await llamarHerramientaIcomfly(store.code, "consultar_producto", { query: q });
      const ids = Array.from(new Set((Array.isArray(result.productos) ? result.productos : []).map(p => Number((p as { id?: unknown }).id)).filter(id => Number.isSafeInteger(id) && id > 0))).slice(0, 12);
      const products = await Promise.all(ids.map(id => getIcomflyCatalogProduct(store.code, id)));
      return NextResponse.json({ products: products.flatMap(p => upsellProductOptions(p as typeof p & Record<string, unknown>)) });
    }
    const name = (req.nextUrl.searchParams.get("order") ?? "").trim();
    const receipt = await findOrderUpsell(store.id, name);
    if (receipt) {
      const replacement = receipt.replacement_id && !receipt.completed_at && req.nextUrl.searchParams.get("receipt_only") !== "1" ? await getIcomflyOrder(store.code, receipt.replacement_id) : null;
      return NextResponse.json({ receipt: publicReceipt(receipt, replacement?.status === "Cancelado") });
    }
    const original = await resolveUpsellOriginal(store.id, store.code, name);
    assertReplaceable(original);
    return NextResponse.json({ original: originalPreview(original, name) });
  } catch (e) { return NextResponse.json({ error: errorMessage(e) }, { status: 422 }); }
}

export async function POST(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  if (!canWrite()) return NextResponse.json({ error: MENSAJE_UPSELL_SIN_PERMISO }, { status: 403 });
  if (process.env.CREAR_EN_ICOMFLY_APAGADO === "1") return NextResponse.json({ error: "La creación en iComfly está desactivada temporalmente." }, { status: 503 });
  let receipt: StoredUpsell | null = null, token: string | null = null;
  try {
    const body = await req.json();
    const name = typeof body.order_name === "string" ? body.order_name.trim() : "";
    if (!name || name.length > 150) return NextResponse.json({ error: "Pedido requerido." }, { status: 400 });
    receipt = await findOrderUpsell(store.id, name);
    if (body.action === "restart_cancelled" && !receipt) return NextResponse.json({ error: "El intento ya se archivó. Actualiza el formulario." }, { status: 409 });
    if (!receipt) {
      const advisorId = vendedoraEfectiva(body.staff_id);
      if (!advisorId || !Number.isSafeInteger(advisorId)) return NextResponse.json({ error: "Selecciona la asesora que cerró el upsell." }, { status: 400 });
      const staff = await getDB().from("payroll_staff").select("id,name,active").eq("id", advisorId).maybeSingle();
      if (staff.error || !staff.data || staff.data.active === false) return NextResponse.json({ error: "La asesora no está activa." }, { status: 400 });
      if (!isValidCanal(body.canal) || !body.canal) return NextResponse.json({ error: "Canal de confirmación inválido." }, { status: 400 });
      const original = await resolveUpsellOriginal(store.id, store.code, name);
      if (body.fingerprint !== sourceFingerprint(original)) return NextResponse.json({ error: "El pedido cambió. Recarga el upsell y revisa el nuevo total." }, { status: 409 });
      const selection: UpsellSelection = { product_id: Number(body.product_id), variant_id: body.variant_id == null ? null : String(body.variant_id), quantity: Number(body.quantity), price: Number(body.price) };
      const product = await getIcomflyCatalogProduct(store.code, selection.product_id);
      const line = selectedUpsellLine(product as typeof product & Record<string, unknown>, selection);
      const lines = [...originalLines(original), line];
      const catalogs = await Promise.all(lines.map(l => l.productId === selection.product_id ? product : getIcomflyCatalogProduct(store.code, l.productId)));
      const catalogSubtotal = catalogSubtotalForUpsell(lines, catalogs as Array<typeof product & Record<string, unknown>>);
      const id = randomUUID();
      const built = buildUpsellReplacement(original, line, id, staff.data.name, catalogSubtotal);
      receipt = await reserveOrderUpsell({ id, store_id: store.id, original_id: String(original.id), original_name: name,
        advisor_id: advisorId, advisor_name: staff.data.name, canal: body.canal, source_fingerprint: sourceFingerprint(original),
        payload: built.body, expected: built.expected, selection, creation_started_at: null, replacement_id: null,
        replacement_name: null, cancel_started_at: null, completed_at: null });
    }
    if (receipt.completed_at) return NextResponse.json({ ok: true, receipt: publicReceipt(receipt) });
    token = await lockOrderUpsell(receipt);
    if (!token) return NextResponse.json({ pending: true, receipt: publicReceipt(receipt), message: "La operación se está procesando. Vuelve a verificar en unos momentos." }, { status: 202 });
    // Refresh after acquiring the lock; a competing request may have finished a stage.
    receipt = (await findOrderUpsell(store.id, name))!;
    const connection = await tiendaDeLaConexion(store.code);
    if (connection.id !== getIcomflyExternalStoreId(store.code)) throw new Error("No se pudo verificar que el conector corresponda a esta tienda.");
    const r = receipt, lock = token;
    if (body.action === "restart_cancelled") {
      if (!r.replacement_id || r.cancel_started_at || r.completed_at) throw new Error("Este intento requiere revisión antes de iniciar otro upsell.");
      const [original, replacement] = await Promise.all([getIcomflyOrder(store.code, r.original_id), getIcomflyOrder(store.code, r.replacement_id)]);
      assertReplaceable(original);
      if (replacement.status !== "Cancelado" || hasLogistics(replacement) || !matchesReplacement(replacement, r, false)) throw new Error("El pedido adicional no está cancelado o cambió. No se inició otro intento.");
      const preview = originalPreview(original, name);
      await archiveCancelledOrderUpsell(r, lock);
      return NextResponse.json({ reset: true, original: preview, message: "Intento cancelado archivado. Selecciona el upsell para iniciar otro." });
    }
    const result = await runUpsellReplacement(r, {
      read: id => getIcomflyOrder(store.code, id),
      findCreated: async reference => {
        const found = await llamarHerramientaIcomfly(store.code, "detalle_pedido", { identificador: reference });
        const order = found.pedido as { id?: unknown; order_number?: unknown } | undefined;
        if (!order || String(order.order_number) !== reference || !/^[1-9]\d*$/.test(String(order.id))) return null;
        return getIcomflyOrder(store.code, String(order.id));
      },
      create: payload => createManualIcomflyOrder(store.code, payload),
      patch: changes => patchOrderUpsell(r, lock, changes),
      setTotal: async (id, total) => { await llamarHerramientaIcomfly(store.code, "actualizar_pedido", { order_id: Number(id), total }); },
      setCod: async id => { await llamarHerramientaIcomfly(store.code, "definir_tipo_recaudo", { order_id: Number(id), tipo_recaudo: "contra_entrega" }); },
      catalogTotals: async replacement => {
        const lines = originalLines(replacement);
        const products = await Promise.all(lines.map(line => getIcomflyCatalogProduct(store.code, line.productId)));
        return catalogTotalsForUpsell(lines, products as Array<typeof products[number] & Record<string, unknown>>)
          .map(subtotal => Math.round((subtotal + Number(r.payload.shippingCost ?? 0)) * 100) / 100);
      },
      changeStatus: async (id, status, reason) => { await llamarHerramientaIcomfly(store.code, "cambiar_estado_pedido", { order_id: Number(id), nuevo_estado: status, motivo: reason }); },
      finish: async (original, replacement) => {
        // Persist both exact orders so the original also disappears from the pending queue.
        const orders = [original, replacement];
        for (const [table, rows] of [
          ["icomfly_order_payloads", orders.map(o => ({ store_id: store.id, icomfly_order_id: String(o.id), payload: o, synced_at: new Date().toISOString() }))],
          ["icomfly_orders", orders.map(o => ({ ...buildIcomflyOrderRow(normalizeIcomflyOrder(o, store.id), { staff: [{ id: r.advisor_id, name: r.advisor_name }], boxfulDispatched: new Set(), now: new Date() }), synced_at: new Date().toISOString() }))],
        ] as const) {
          const { error } = await getDB().from(table).upsert(rows, { onConflict: "store_id,icomfly_order_id" });
          if (error) throw new Error("Los pedidos cambiaron en iComfly; falta actualizar Kairo. Continúa esta operación.");
        }
        const replacementName = nombrePedidoIcomfly(replacement.order_number, replacement.id, replacement.store_web_seq);
        const { error } = await getDB().rpc("finish_order_upsell", { p_id: r.id, p_store_id: store.id, p_lock_token: lock, p_replacement_name: replacementName });
        if (error) throw new Error("Falta guardar la bitácora. Continúa esta operación sin crear otro pedido.");
        r.completed_at = new Date().toISOString(); r.replacement_name = replacementName;
      },
    });
    let warning: string | undefined;
    if (result.complete) {
      try { await refreshFinanceDatasetCache(store); }
      catch { warning = "El pedido está confirmado; la tabla se actualizará con la próxima sincronización."; }
    }
    return NextResponse.json({ ok: result.complete, pending: !result.complete, receipt: publicReceipt(r), message: result.message, warning }, { status: result.complete ? 200 : 202 });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e), ...(receipt ? { pending: !receipt.completed_at, receipt: publicReceipt(receipt) } : {}) }, { status: receipt ? 409 : 422 });
  } finally {
    if (receipt && token) await unlockOrderUpsell(receipt, token);
  }
}
