import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FINANCIAL_LABELS, FULFILLMENT_LABELS, ITALIA_STATUS, type ItaliaOrder, type ItaliaStatus } from "@/lib/italia-orders";
import OrderDetails from "./OrderDetails";
import { control, statusTone } from "./order-ui";

import { useOrderDisplay } from "./OrderDisplayContext";

export default function OrdersTable({orders,loading,disabled,expanded,onExpand,onManage,onChange}:{orders:ItaliaOrder[];loading:boolean;disabled:boolean;expanded:string|null;onExpand:(id:string)=>void;onManage:(order:ItaliaOrder)=>void;onChange:(order:ItaliaOrder,status:ItaliaStatus)=>void}) {
  const {date,money,shortDate,region,label}=useOrderDisplay();
  return <div className="max-h-[70vh] overflow-auto" role="region" aria-label={`Tabla de pedidos de ${region}`} tabIndex={0}>
    <table className="w-full min-w-[1150px] text-left text-xs">
      <caption className="sr-only">Pedidos de {label}. Abre el número de pedido para ver dirección, productos completos y acciones.</caption>
      <thead className="sticky top-0 z-[1] border-y border-border bg-background text-[11px] text-muted-foreground"><tr>{["Orden","Origen","Guía / courier","Cliente","Estado operativo","Pago / envío original","Fecha","Items","Importe","Gestión"].map(h=><th scope="col" key={h} className="px-2.5 py-2.5 font-semibold">{h}</th>)}</tr></thead>
      <tbody>
        {loading&&orders.length===0?Array.from({length:8},(_,i)=><tr key={i} aria-hidden="true" className="border-b border-border/60">{Array.from({length:10},(_,j)=><td key={j} className="px-2.5 py-4"><div className="h-4 w-full rounded bg-muted motion-safe:animate-pulse"/></td>)}</tr>):orders.map(o=>{
          const open=expanded===o.id,isShopify=o.source==="shopify",awaiting=!isShopify&&o.version!==o.synced_version;
          return <Fragment key={o.id}><tr className={`border-b border-border/60 align-top transition-colors hover:bg-muted/30 ${open?"bg-seleccion":""}`}>
            <td className="px-2.5 py-3"><button className="inline-flex items-center gap-1 font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={open} aria-controls={`detail-${o.id}`} onClick={()=>onExpand(o.id)}>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<span className="whitespace-nowrap">{o.order_number}</span></button></td>
            <td className="px-2.5 py-3"><span className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${isShopify?"bg-emerald-500/10 text-emerald-300":"bg-violet-500/10 text-violet-300"}`}>{isShopify?"Shopify":"WooCommerce"}</span></td>
            <td className="max-w-[140px] px-2.5 py-3"><span className="block truncate" title={o.tracking_number||o.original_tracking}>{o.tracking_number||o.original_tracking||"Sin guía"}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{o.courier||"Sin courier"}</span></td>
            <td className="max-w-[160px] px-2.5 py-3"><p className="truncate font-medium" title={o.customer_name}>{o.customer_name}</p>{o.phone?<a className="mt-1 block whitespace-nowrap text-[10px] text-muted-foreground hover:underline" href={`tel:${o.phone.replace(/[^+\d]/g,"")}`}>{o.phone}</a>:<p className="mt-1 text-[10px] text-muted-foreground">Sin teléfono</p>}</td>
            <td className="px-2.5 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${statusTone[o.status]}`}>{ITALIA_STATUS[o.status]}</span><p className={`mt-1 max-w-[145px] text-[10px] ${o.last_error||["review","ambiguous","unknown"].includes(o.reconciliation?.state||"")?"text-amber-300":"text-muted-foreground"}`}>{o.reconciliation?.applied?`Elogy · ${o.reconciliation.label}`:o.reconciliation?.state==="review"?"Revisar diferencia con Elogy":o.reconciliation?.state==="ambiguous"?"Cruce ambiguo con Elogy":o.reconciliation?.state==="unknown"?"Elogy sin estado verificado":isShopify?(o.managed_at?"Gestionado en Kairo":"Según Shopify"):awaiting?(o.last_error?"Error de sincronización":"Sincronización pendiente"):"Sincronizado"}</p></td>
            <td className="max-w-[160px] px-2.5 py-3"><span className={o.financial_status==="paid"?"text-emerald-300":"text-muted-foreground"}>{isShopify?(FINANCIAL_LABELS[o.financial_status]||o.financial_status||"Sin informar"):o.financial_status==="paid"?"Pagado con Stripe":"Contra entrega"}</span><p className="mt-1 text-[10px] text-muted-foreground">{isShopify?(FULFILLMENT_LABELS[o.fulfillment_status]||o.fulfillment_status):o.financial_status==="paid"?"No cobrar al entregar":"Cobrar al entregar"}</p></td>
            <td className="whitespace-nowrap px-2.5 py-3"><time dateTime={o.created_at} title={date(o.created_at)}>{shortDate(o.created_at)}</time></td>
            <td className="max-w-[190px] px-2.5 py-3"><p className="truncate" title={o.items.map(i=>`${i.quantity}× ${i.name}`).join("; ")}>{o.items.map(i=>`${i.quantity}× ${i.name}`).join("; ")||"Sin productos"}</p><p className="mt-1 text-[10px] text-muted-foreground">{o.items.reduce((n,i)=>n+i.quantity,0)} unidades</p></td>
            <td className="whitespace-nowrap px-2.5 py-3 text-right font-semibold tabular-nums">{money(o.total,o.currency)}</td>
            <td className="px-2.5 py-2.5"><button className={control} disabled={disabled} onClick={()=>isShopify?onManage(o):onExpand(o.id)} aria-label={`Gestionar ${o.order_number}`}>Gestionar</button></td>
          </tr>{open&&<tr id={`detail-${o.id}`} className="border-b border-border"><td colSpan={10}><OrderDetails order={o} disabled={disabled} onManage={()=>onManage(o)} onChange={status=>onChange(o,status)}/></td></tr>}</Fragment>;
        })}
      </tbody>
    </table>
  </div>;
}
