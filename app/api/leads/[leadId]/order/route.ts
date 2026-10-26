import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { getShopifyCredentials } from "@/lib/stores";
import { createLeadOrder, type LeadOrderInput, type ShopifyOrderAddress } from "@/lib/shopify";
import { getLead, markLeadWonByAdvisor, type LeadRecord } from "@/lib/leads";
import { vendedoraEfectiva } from "@/lib/identidad";
import { getStoreRegions, type FinanceStoreCode } from "@/lib/store-config";
import { llamarHerramientaIcomfly, verificarTiendaMcp } from "@/lib/icomfly-mcp";
import { getIcomflyExternalStoreId } from "@/lib/icomfly";
import {
  argumentosCrearPedido,
  creaEnIcomfly,
  elegirProducto,
  faltanParaIcomfly,
  palabraDeBusqueda,
  type ProductoIcomfly,
} from "@/lib/icomfly-pedido-lead";
import { nombrePedidoIcomfly } from "@/lib/icomfly-pedidos";
import { runIcomflySync } from "@/lib/icomfly-sync";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OrderBody {
  store?: string;
  vendedora_id?: number;
  /** "icomfly": el pedido se crea en iComfly (boton "Crear en iComfly"); si no, en Shopify. */
  destino?: "shopify" | "icomfly";
  items?: Array<{
    variant_id?: number;
    sku?: string;
    title?: string;
    product_title?: string;
    variant_title?: string;
    price?: string | number;
    quantity?: number;
  }>;
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
  // Una asesora sin permiso de supervision queda SIEMPRE a su nombre
  // (lib/identidad.ts): el navegador no puede registrar a nombre de otra.
  const vendedoraId = vendedoraEfectiva(body?.vendedora_id) ?? NaN;
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

    if (body?.destino === "icomfly") {
      // Interruptor de emergencia: CREAR_EN_ICOMFLY_APAGADO=1 lo apaga sin
      // compilar de nuevo (se lee en cada pedido). Se apago del 24 al 26/10/2026
      // porque iComfly dejaba ocultos los pedidos de crear_pedido (EXCEL-);
      // desde el 26/10 salen visibles ("Manual #…").
      // Apagado por tienda (ver TIENDAS_SIN_CREAR_EN_ICOMFLY): cubre una
      // pantalla abierta desde antes de ocultar el boton.
      if (process.env.CREAR_EN_ICOMFLY_APAGADO === "1" || !creaEnIcomfly(store.code)) {
        return NextResponse.json(
          { error: "Crear en iComfly está desactivado por ahora: usa «Crear pedido». Recarga la página (F5)." },
          { status: 403 }
        );
      }
      return await crearEnIcomfly({ body, items, lead, leadId, storeId: store.id, storeCode: store.code, vendedoraId });
    }

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
      // El pais de la TIENDA. Estaba fijo en "Costa Rica" y los pedidos de
      // Honduras creados desde el tablero salian con ese pais (44 hasta el
      // 12/10/2026).
      country: store.shortLabel,
      country_code: store.countryCode,
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

// El producto de iComfly con ese nombre, para vincular el pedido al catalogo.
// Best-effort: sin el, el pedido se crea igual con el nombre.
async function buscarProductoIcomfly(storeCode: FinanceStoreCode, titulo: string): Promise<ProductoIcomfly | null> {
  if (!titulo.trim()) return null;
  try {
    const r = await llamarHerramientaIcomfly(storeCode, "consultar_producto", { query: palabraDeBusqueda(titulo) });
    return elegirProducto((r.productos ?? []) as Array<{ id?: unknown; name?: unknown }>, titulo);
  } catch {
    return null;
  }
}

// El mismo pedido, creado en iComfly con el conector (lib/icomfly-mcp.ts):
// desde el 28/10/2026 Shopify esta suspendido. Accion hacia afuera: crea un
// pedido REAL en iComfly.
async function crearEnIcomfly(ctx: {
  body: OrderBody;
  items: NonNullable<OrderBody["items"]>;
  lead: LeadRecord;
  leadId: number;
  storeId: number;
  storeCode: FinanceStoreCode;
  vendedoraId: number;
}): Promise<NextResponse> {
  const { body, items, lead, leadId, storeId, storeCode, vendedoraId } = ctx;
  const envio = body.shipping ?? {};
  const falta = faltanParaIcomfly(envio);
  if (falta.length) {
    const regions = getStoreRegions(storeCode);
    const nombres = { address: "la dirección exacta", canton: regions.subLabel, province: regions.label };
    return NextResponse.json(
      { error: `iComfly pide ${falta.map((c) => nombres[c]).join(", ")}: complétalo para crear el pedido.` },
      { status: 400 }
    );
  }

  // La clave tiene que ser de ESTA tienda: con las claves cruzadas, el pedido
  // se crearia en la otra.
  const errorTienda = await verificarTiendaMcp(storeCode, getIcomflyExternalStoreId(storeCode));
  if (errorTienda) return NextResponse.json({ error: errorTienda }, { status: 409 });

  const productos = await Promise.all(
    items.map((it) => buscarProductoIcomfly(storeCode, String(it.product_title || it.title || "")))
  );
  const args = argumentosCrearPedido(
    {
      items: items.map((it) => ({
        title: String(it.title || "Producto"),
        product_title: it.product_title,
        variant_title: it.variant_title,
        price: Number(it.price) || 0,
        quantity: Number(it.quantity) || 1,
      })),
      envio,
      nombreLead: lead.name,
      telefono: lead.phone,
      pago: body.payment_method === "sinpe" ? "sinpe" : "cod",
      descuento:
        body.discount?.value && body.discount.value > 0
          ? { value: body.discount.value, type: body.discount.type === "fixed_amount" ? "fixed_amount" : "percentage" }
          : undefined,
      nota: body.note,
    },
    productos
  );
  const r = await llamarHerramientaIcomfly(storeCode, "crear_pedido", args);
  const pedido = (r.pedido ?? {}) as { id?: unknown; order_number?: unknown; total?: unknown };
  if (pedido.id == null) throw new Error("iComfly no devolvió el pedido creado: revisa en iComfly antes de reintentar.");
  const nombre = nombrePedidoIcomfly(pedido.order_number, pedido.id);

  // El pedido YA existe: si marcar el lead falla, se avisa pero no se
  // devuelve error (la asesora reintentaria y crearia otro pedido).
  let aviso: string | undefined;
  try {
    await markLeadWonByAdvisor({
      storeId,
      leadId,
      vendedora: vendedoraId,
      shopifyOrderName: nombre,
      note: `pedido ${nombre} creado por la asesora en iComfly`,
    });
  } catch (err) {
    aviso = `El pedido se creó, pero el lead no se pudo marcar como ganado: ${err instanceof Error ? err.message : err}`;
  }

  // Que el pedido llegue ya a Kairo: la pagina mas reciente de iComfly de esa
  // tienda (el cron lo trae igual cada 30 minutos). Hasta 8 s.
  await Promise.race([
    runIcomflySync({ store: storeCode, maxPages: 1 }).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);

  return NextResponse.json({
    ok: true,
    destino: "icomfly",
    order_name: nombre,
    icomfly_id: String(pedido.id),
    total: pedido.total ?? args.total,
    ...(aviso ? { aviso } : {}),
  });
}
