import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { getLead, markLeadWonByAdvisor, type LeadRecord } from "@/lib/leads";
import { vendedoraEfectiva } from "@/lib/identidad";
import { getStoreRegions, type FinanceStoreCode } from "@/lib/store-config";
import { llamarHerramientaIcomfly, verificarTiendaMcp } from "@/lib/icomfly-mcp";
import { getIcomflyExternalStoreId, getIcomflyCatalogProduct, createManualIcomflyOrder } from "@/lib/icomfly";
import { buildManualOrder, resolveManualOrderLine } from "@/lib/icomfly-manual-order";
import {
  argumentosCrearPedido,
  creaEnIcomfly,
  elegirProducto,
  faltanParaIcomfly,
  palabraDeBusqueda,
  type ProductoIcomfly,
  type PedidoLead,
} from "@/lib/icomfly-pedido-lead";
import { nombrePedidoIcomfly } from "@/lib/icomfly-pedidos";
import { runIcomflySync } from "@/lib/icomfly-sync";
import { verifyCreatedIcomflyOrder } from "@/lib/icomfly-confirmation";
import { ensureManualOrderDiscount } from "@/lib/icomfly-discount";
import { findReceipt, reserveReceipt, saveReceiptId, confirmReceipt, type Receipt } from "@/lib/icomfly-receipts";

export const runtime = "nodejs";
export const maxDuration = 120;

interface OrderBody {
  request_id?: string;
  store?: string;
  vendedora_id?: number;
  /** Solo iComfly; Shopify se rechaza también para pantallas antiguas. */
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

// Creates only in iComfly. Win/success require independent read verification.
export async function POST(req: NextRequest, ctx: { params: { leadId: string } }) {
  const body = (await req.json().catch(() => null)) as OrderBody | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  if(body?.destino !== "icomfly") return NextResponse.json({error:"La creación en Shopify está desactivada. Recarga y usa Crear en iComfly."},{status:403});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id||""))return NextResponse.json({error:"Recarga la página para crear el pedido."},{status:400});
  const leadId = Number(ctx.params.leadId);
  if (!Number.isFinite(leadId)) {
    return NextResponse.json({ error: "leadId invalido" }, { status: 400 });
  }
  try {
    const lead = await getLead(store.id, leadId);
    if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });
    const existing=await findReceipt(store.id,leadId,body.request_id!);
    if(existing)return await verificarRecibo(existing,store.code);
  // Una asesora sin permiso de supervision queda SIEMPRE a su nombre
  // (lib/identidad.ts): el navegador no puede registrar a nombre de otra.
  const vendedoraId = vendedoraEfectiva(body?.vendedora_id) ?? NaN;
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quien eres (asesora) antes de crear el pedido." }, { status: 400 });
  }

    const items=(body.items??[]).filter(it=>(it.quantity??0)>0&&(it.variant_id||it.title));
    if(!items.length)return NextResponse.json({error:"Agrega al menos un producto al pedido."},{status:400});

    if (body?.destino === "icomfly") {
      // Interruptor de emergencia: CREAR_EN_ICOMFLY_APAGADO=1 lo apaga sin
      // compilar de nuevo (se lee en cada pedido). Se apago del 24 al 26/10/2026
      // porque iComfly dejaba ocultos los pedidos de crear_pedido (EXCEL-);
      // desde el 26/10 salen visibles ("Manual #…").
      // Apagado por tienda (ver TIENDAS_SIN_CREAR_EN_ICOMFLY): cubre una
      // pantalla abierta desde antes de ocultar el boton.
      if (process.env.CREAR_EN_ICOMFLY_APAGADO === "1" || !creaEnIcomfly(store.code)) {
        return NextResponse.json(
          { error: "Crear en iComfly está desactivado por ahora: contacta a supervisión. Recarga la página (F5)." },
          { status: 403 }
        );
      }
      return await crearEnIcomfly({ body, items, lead, leadId, storeId: store.id, storeCode: store.code, vendedoraId });
    }
    return NextResponse.json({error:"Destino de creación no disponible."},{status:403});
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
  const pedidoLead: PedidoLead = {
      items: items.map((it) => ({
        title: String(it.title || "Producto"),
        product_title: it.product_title,
        variant_title: it.variant_title,
        sku: it.sku,
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
    };
  let manual: ReturnType<typeof buildManualOrder> | undefined;
  if (items.length > 1) {
    try {
      const externalStoreId = getIcomflyExternalStoreId(storeCode)!;
      const lines = await Promise.all(pedidoLead.items.map(async (item, i) => {
        const found = productos[i];
        if (!found) throw new Error(`No se encontró "${item.product_title || item.title}" en el catálogo de iComfly. No se creó el pedido.`);
        return resolveManualOrderLine(item, await getIcomflyCatalogProduct(storeCode, found.id), externalStoreId);
      }));
      manual = buildManualOrder(pedidoLead, lines, externalStoreId, body.request_id!);
    } catch (error) {
      return NextResponse.json({error: error instanceof Error ? error.message : "No se pudieron vincular los productos de iComfly."}, {status:422});
    }
  }
  const args = manual ? manual.body : argumentosCrearPedido(pedidoLead, productos);
  const receipt: Receipt={request_id:body.request_id!,store_id:storeId,lead_id:leadId,advisor_id:vendedoraId,icomfly_id:null,confirmed_at:null,...(manual?{expected_order:manual.expected}:{})};
  if(!await reserveReceipt(receipt)){
    const existing=await findReceipt(storeId,leadId,body.request_id!);
    if(!existing)throw new Error("No se pudo recuperar el intento. Revisa iComfly antes de repetir.");
    return verificarRecibo(existing,storeCode);
  }
  try{
    const pedido = manual ? await createManualIcomflyOrder(storeCode,args) :
      (await llamarHerramientaIcomfly(storeCode,"crear_pedido",args)).pedido as {id?:unknown};
    if(!pedido)return pendiente(receipt);
    if(!/^\d+$/.test(String(pedido.id??"")))return pendiente(receipt);
    await saveReceiptId(receipt,String(pedido.id));
  }catch{
    // A timeout can occur AFTER creation: preserve the receipt and never resend.
    return pendiente(receipt);
  }
  return verificarRecibo(receipt,storeCode);
}

function pendiente(receipt: Receipt){
 return NextResponse.json({ok:false,pending:true,request_id:receipt.request_id,icomfly_id:receipt.icomfly_id,
  message:receipt.icomfly_id ? "iComfly devolvió una referencia. Falta verificar el pedido en su listado; no vuelvas a crearlo." : "La solicitud quedó sin confirmación. Revisa iComfly con supervisión antes de crear otro pedido."},{status:202});
}
async function verificarRecibo(receipt:Receipt,storeCode:FinanceStoreCode):Promise<NextResponse>{
 if(!receipt.icomfly_id)return pendiente(receipt);
 const nombre=nombrePedidoIcomfly(null,receipt.icomfly_id);
 let verified;
 try{
  if(!receipt.confirmed_at && receipt.expected_order?.discount_adjustment)await ensureManualOrderDiscount(storeCode,receipt.icomfly_id,receipt.expected_order);
  verified=await verifyCreatedIcomflyOrder(storeCode,receipt.icomfly_id,receipt.expected_order);
 }catch{
  if(!receipt.confirmed_at)return pendiente(receipt);
 }
 if(!verified&&!receipt.confirmed_at)return pendiente(receipt);
 // El correlativo visible pertenece a la tienda; el ID interno sigue siendo
 // la clave estable de la gestión. Nunca inferirlo del acuse de creación.
 const identificacion={
  order_name:nombre,
  order_display_name:verified?.storeWebSeq?`#${verified.storeWebSeq}`:nombre,
  store_web_seq:verified?.storeWebSeq??null,
  icomfly_id:receipt.icomfly_id,
 };
 if(receipt.confirmed_at)return NextResponse.json({ok:true,verified:true,destino:"icomfly",...identificacion});
 if(!verified)return pendiente(receipt);
 let aviso:string|undefined;
 try{
  await markLeadWonByAdvisor({storeId:receipt.store_id,leadId:receipt.lead_id,vendedora:receipt.advisor_id,shopifyOrderName:nombre,note:`pedido ${nombre} verificado en iComfly`});
  await confirmReceipt(receipt);
 }catch{aviso="El pedido se verificó en iComfly, pero falta actualizar su gestión en Kairo.";}
 await Promise.race([runIcomflySync({store:storeCode,maxPages:1}).catch(()=>undefined),new Promise(resolve=>setTimeout(resolve,2000))]);
 return NextResponse.json({ok:true,verified:true,destino:"icomfly",...identificacion,order_number:verified.orderNumber,total:verified.total,...(aviso?{aviso}:{})});
}
