import { FINANCIAL_LABELS, FULFILLMENT_LABELS, ITALIA_STATUS, transitions, type ItaliaOrder, type ItaliaStatus } from "@/lib/italia-orders";
import { control } from "./order-ui";

import { useOrderDisplay } from "./OrderDisplayContext";

export default function OrderDetails({order:o,disabled,onManage,onChange}:{order:ItaliaOrder;disabled:boolean;onManage:()=>void;onChange:(status:ItaliaStatus)=>void}) {
  const {date,money,postcodeLabel}=useOrderDisplay();
  const a=o.address,isShopify=o.source==="shopify",awaiting=o.version!==o.synced_version;
  return <div className="w-[calc(100vw-5rem)] space-y-4 bg-muted/20 px-4 py-4 text-xs sm:w-auto">
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <section className="min-w-0 space-y-1"><h3 className="mb-2 font-semibold">Cliente y entrega</h3><p>{o.customer_name}</p>{o.phone&&<p><a className="underline" href={`tel:${o.phone.replace(/[^+\d]/g,"")}`}>{o.phone}</a></p>}{o.email&&<p className="break-all text-muted-foreground">{o.email}</p>}<p className="pt-1">{a.address_1||"Dirección no disponible"}</p>{a.address_2&&<p>{a.address_2}</p>}<p>{a.postcode&&<strong>{postcodeLabel} {a.postcode} · </strong>}{a.city}{a.state?` (${a.state})`:""}</p><p className="text-muted-foreground">{[a.region,a.country].filter(Boolean).join(" · ")}</p></section>
      <section className="min-w-0"><h3 className="mb-2 font-semibold">Productos</h3><ul className="space-y-2">{o.items.map((item,i)=><li key={i} className="break-words">{item.quantity} × {item.name}<span className="mt-0.5 block text-[11px] text-muted-foreground">SKU: {item.sku||"Sin SKU"} · {money(item.total,o.currency)}</span></li>)}</ul></section>
      <section className="min-w-0 space-y-2"><h3 className="font-semibold">Pago y seguimiento</h3><p>{isShopify?`Shopify: ${FINANCIAL_LABELS[o.financial_status]||o.financial_status||"Pago sin informar"} · ${FULFILLMENT_LABELS[o.fulfillment_status]||o.fulfillment_status}`:o.financial_status==="paid"?"Pagado con Stripe · No cobrar al entregar":"Contra entrega · Cobrar al entregar"}</p>{o.shopify_cancelled&&<p className="text-red-300">Pedido anulado en Shopify</p>}<p className="break-words">Courier: {o.courier||"Sin informar"}<br/>Guía: {o.tracking_number||o.original_tracking||"Sin guía"}</p>{o.tracking_number&&o.original_tracking&&o.tracking_number!==o.original_tracking&&<p className="break-words text-muted-foreground">Guía original en Shopify: {o.original_tracking}</p>}<p className="text-muted-foreground">Creado: {date(o.created_at)}</p></section>
    </div>
    {o.note&&<div><h3 className="font-semibold">Nota original del pedido</h3><p className="mt-1 whitespace-pre-wrap break-words">{o.note}</p></div>}
    {o.management_note&&<div><h3 className="font-semibold">Nota interna</h3><p className="mt-1 whitespace-pre-wrap break-words">{o.management_note}</p></div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p className={`max-w-prose ${o.last_error?"text-amber-300":"text-muted-foreground"}`}>{isShopify?(o.managed_at?`Gestión guardada en Kairo: ${date(o.managed_at)}`:"Estado original de Shopify; aún sin gestión en Kairo"):(awaiting?(o.last_error?`${o.last_error}. Reintentaremos automáticamente.`:"Guardado en Kairo; pendiente de confirmar en la tienda."):"Sincronizado con WooCommerce")}</p>
      {isShopify?<button className={control} disabled={disabled} onClick={onManage}>Gestionar en Kairo</button>:<div className="flex flex-wrap gap-2">{transitions(o).map(next=><button key={next} className={control} disabled={disabled||awaiting} onClick={()=>onChange(next)}>{next==="cancelled"?"Anular":next==="confirmed"?"Confirmar":`Marcar ${ITALIA_STATUS[next].toLowerCase()}`}</button>)}</div>}
    </div>
  </div>;
}
