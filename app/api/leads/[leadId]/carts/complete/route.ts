import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { getRequiredStoreFromBody, getShopifyCredentials } from "@/lib/stores";
import { convertirBorradorEnPedido, getDraftOrder } from "@/lib/shopify";
import { getLead, markLeadWonByAdvisor } from "@/lib/leads";
import { actorActual, vendedoraEfectiva } from "@/lib/identidad";
import { etiquetasDelPedido, notaDelPedido, problemaParaGenerar } from "@/lib/leads-borrador";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST { store, draft_id, vendedora_id }
//
// Convierte el BORRADOR que dejo el cliente en Shopify en pedido contra
// entrega, con su direccion, productos y precio tal cual. Para cuando el
// cliente confirmo por WhatsApp y el pedido no se creo. Accion hacia afuera:
// crea un pedido REAL. El lead pasa a Ganado a nombre de la asesora.
export async function POST(req: NextRequest, ctx: { params: { leadId: string } }) {
  const body = (await req.json().catch(() => null)) as { store?: string; draft_id?: string | number; vendedora_id?: number } | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const leadId = Number(ctx.params.leadId);
  const draftId = String(body?.draft_id ?? "").trim();
  if (!Number.isFinite(leadId) || !/^\d+$/.test(draftId)) {
    return NextResponse.json({ error: "Lead o borrador inválido." }, { status: 400 });
  }
  // Una asesora sin supervision queda SIEMPRE a su nombre (lib/identidad.ts).
  const vendedoraId = vendedoraEfectiva(body?.vendedora_id) ?? NaN;
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quien eres (asesora) antes de generar el pedido." }, { status: 400 });
  }

  try {
    const lead = await getLead(store.id, leadId);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    // El borrador tiene que ser DE ESTE cliente: nadie puede completar el
    // borrador de otro mandando su id.
    const { data: guardado, error: dbErr } = await getDB()
      .from("shopify_draft_carts")
      .select("id,shopify_draft_order_name")
      .eq("store_id", store.id)
      .eq("lead_id", leadId)
      .eq("shopify_draft_order_id", draftId)
      .maybeSingle();
    if (dbErr) throw new Error(dbErr.message);
    if (!guardado) return NextResponse.json({ error: "Ese borrador no es de este cliente." }, { status: 404 });

    const { shop, token, missing } = getShopifyCredentials(store);
    if (!shop || !token) {
      return NextResponse.json({ error: `Shopify ${store.shortLabel} no configurado. Falta ${missing.join(" y ")}.` }, { status: 400 });
    }
    const creds = { shop, token };

    // Se lee en vivo: el borrador pudo completarse en Shopify desde la ultima
    // sincronizacion, y completarlo dos veces no se puede deshacer.
    const draft = await getDraftOrder(draftId, creds);
    const problema = problemaParaGenerar(lead, draft);
    if (problema) return NextResponse.json({ error: problema }, { status: 409 });

    const order = await convertirBorradorEnPedido(
      draftId,
      { note: notaDelPedido(draft.note, actorActual(), new Date()), tags: etiquetasDelPedido(draft.tags) },
      creds
    );

    await markLeadWonByAdvisor({
      storeId: store.id,
      leadId,
      vendedora: vendedoraId,
      shopifyOrderName: order.name,
      note: `pedido ${order.name} generado desde el borrador ${draft.name}`,
    });
    // Que el tablero no lo siga mostrando como carrito abierto hasta la
    // proxima sincronizacion.
    await getDB()
      .from("shopify_draft_carts")
      .update({ is_open: false, status: "completed", closed_at: new Date().toISOString() })
      .eq("id", (guardado as { id: number }).id);

    return NextResponse.json({ ok: true, order_name: order.name, total: order.total, draft_name: draft.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al generar el pedido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
