import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams, getShopifyCredentials } from "@/lib/stores";
import { findCustomerByPhone } from "@/lib/shopify";
import { getLead } from "@/lib/leads";

export const runtime = "nodejs";
export const maxDuration = 20;

// GET: busca al cliente del lead en Shopify (por telefono) para precargar el
// formulario de "Crear pedido" con nombre/correo/direccion que ya tenga.
export async function GET(req: NextRequest, ctx: { params: { leadId: string } }) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }
  try {
    const lead = await getLead(store.id, leadId);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });
    const { shop, token } = getShopifyCredentials(store);
    if (!shop || !token) return NextResponse.json({ found: false });
    const prefill = await findCustomerByPhone(lead.phone, { shop, token });
    return NextResponse.json(prefill);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al buscar el cliente";
    return NextResponse.json({ found: false, error: message }, { status: 200 });
  }
}
