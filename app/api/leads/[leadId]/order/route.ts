import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { getShopifyCredentials } from "@/lib/stores";
import { createLeadOrder, type LeadOrderInput, type ShopifyOrderAddress } from "@/lib/shopify";
import { getLead, markLeadWonByAdvisor } from "@/lib/leads";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OrderBody {
  store?: string;
  vendedora_id?: number;
  items?: Array<{ variant_id?: number; sku?: string; title?: string; price?: string | number; quantity?: number }>;
  shipping?: {
    name?: string;
    province?: string;
    canton?: string;
    address?: string;
    reference?: string;
  };
  discount?: { value?: number; type?: "percentage" | "fixed_amount" };
  payment_method?: string; // "cod" | "sinpe"
  note?: string;
}

// POST: la asesora crea el pedido COD en Shopify desde el drawer y el lead
// pasa a Ganado (atribuido a ella). Accion hacia afuera: crea un pedido REAL.
export async function POST(req: NextRequest, ctx: { params: { leadId: string } }) {
  const body = (await req.json().catch(() => null)) as OrderBody | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }
  const vendedoraId = Number(body?.vendedora_id);
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quien eres (asesora) antes de crear el pedido." }, { status: 400 });
  }
  const items = (body?.items ?? []).filter((it) => (it.quantity ?? 0) > 0 && (it.variant_id || it.title));
  if (!items.length) {
    return NextResponse.json({ error: "Agrega al menos un producto al pedido." }, { status: 400 });
  }

  try {
    const lead = await getLead(store.id, leadId);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });

    const { shop, token, missing } = getShopifyCredentials(store);
    if (!shop || !token) {
      return NextResponse.json(
        { error: `Shopify ${store.shortLabel} no configurado. Falta ${missing.join(" y ")}.` },
        { status: 400 }
      );
    }

    const nameParts = (body?.shipping?.name || lead.name || "").trim().split(/\s+/);
    const firstName = nameParts.slice(0, -1).join(" ") || nameParts[0] || "Cliente";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

    const shipping: ShopifyOrderAddress = {
      first_name: firstName,
      last_name: lastName,
      address1: [body?.shipping?.address, body?.shipping?.reference].filter(Boolean).join(" - ") || undefined,
      city: body?.shipping?.canton || undefined,
      province: body?.shipping?.province || undefined,
      country: "Costa Rica",
      phone: lead.phone,
    };

    const paymentLabel = body?.payment_method === "sinpe" ? "SINPE" : "Contraentrega";
    const noteLines = [
      `Cerrado por la asesora desde el tablero de Leads (Kairo).`,
      `Pago: ${paymentLabel}.`,
      body?.note ? `Nota: ${body.note}` : "",
    ].filter(Boolean);

    const input: LeadOrderInput = {
      line_items: items.map((it) => ({
        variant_id: it.variant_id,
        sku: it.sku,
        title: it.title || "Producto",
        price: String(it.price ?? "0"),
        quantity: Number(it.quantity) || 1,
      })),
      phone: lead.phone,
      shipping_address: shipping,
      note: noteLines.join(" "),
      tags: "cerrado_por_asesora, kairo_leads",
    };
    if (body?.discount?.value && body.discount.value > 0) {
      input.applied_discount = {
        description: "Descuento asesora",
        value_type: body.discount.type === "fixed_amount" ? "fixed_amount" : "percentage",
        value: String(body.discount.value),
      };
    }

    const order = await createLeadOrder(input, { shop, token });

    await markLeadWonByAdvisor({
      storeId: store.id,
      leadId,
      vendedora: vendedoraId,
      shopifyOrderName: order.name,
      note: `pedido ${order.name} creado por la asesora`,
    });

    return NextResponse.json({ ok: true, order_name: order.name, total: order.total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al crear el pedido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
