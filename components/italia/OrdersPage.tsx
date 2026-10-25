"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { FINANCIAL_LABELS,FULFILLMENT_LABELS,ITALIA_STATUS,transitions,type ItaliaOrder,type ItaliaStatus } from "@/lib/italia-orders";
import ManageShopifyDialog from "./ManageShopifyDialog";

const field="rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-40";
const date=(value:string)=>new Date(value).toLocaleString("es-ES",{timeZone:"Europe/Rome"});
function money(value:number|null,currency:string){
  if(value===null)return "Importe no disponible";
  try{return new Intl.NumberFormat("it-IT",{style:"currency",currency}).format(value);}catch{return `${value.toLocaleString("it-IT")} ${currency}`;}
}
type Sync={updatedAt:string;complete:boolean;error:boolean}|null;
export default function ItalyOrders(){
  const [orders,setOrders]=useState<ItaliaOrder[]>([]),[count,setCount]=useState(0),[page,setPage]=useState(1);
  const [source,setSource]=useState("all"),[status,setStatus]=useState(""),[search,setSearch]=useState(""),[query,setQuery]=useState("");
  const [sync,setSync]=useState<Sync>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [managing,setManaging]=useState<ItaliaOrder|null>(null);
  const [change,setChange]=useState<{order:ItaliaOrder;status:ItaliaStatus;requestId:string}|null>(null),[saving,setSaving]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null);
  useEffect(()=>{if(change)dialog.current?.showModal();else dialog.current?.close();},[change]);
  const load=useCallback(async()=>{
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError("");
    try{
      const params=new URLSearchParams({page:String(page),source,status,search:query});
      const response=await fetch(`/api/italia/orders?${params}`,{cache:"no-store",signal:controller.signal});
      const data=await response.json();if(!response.ok)throw Error(data.error||"No se pudo cargar la lista");
      setOrders(data.orders);setCount(data.count);setSync(data.shopifySync);setLoaded(true);
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Error de conexión");}
    finally{if(!controller.signal.aborted)setBusy(false);}
  },[page,source,status,query]);
  useEffect(()=>{void load();return()=>request.current?.abort();},[load]);
  const pending=orders.some(o=>o.source==="woocommerce"&&o.version!==o.synced_version);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==="visible"&&!managing&&!change)void load();},pending?15000:60000);return()=>clearInterval(timer);},[load,pending,managing,change]);
  async function saveWoo(){
    if(!change||saving)return;setSaving(true);setError("");
    try{
      const response=await fetch(`/api/woo/orders/${change.order.source_id}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:change.status,version:change.order.version,requestId:change.requestId})});
      const data=await response.json();if(!response.ok)throw Error(data.error||"No se pudo guardar");setChange(null);await load();
    }catch(e){setError(e instanceof Error?e.message:"Error de conexión");}finally{setSaving(false);}
  }
  const stale=sync?.updatedAt && Date.now()-Date.parse(sync.updatedAt)>20*60*1000;
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
      <div><Link href="/admin/finance" className="text-sm text-muted-foreground hover:underline">Gestión de pedidos</Link><h1 className="mt-2 text-2xl font-semibold">Kenku Italia</h1><p className="mt-1 text-sm text-muted-foreground">Shopify y WooCommerce · Horario de Italia</p></div>
      <button className={field} onClick={()=>void load()} disabled={busy}>{busy?"Actualizando…":"Actualizar"}</button>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Origen del pedido">{[["all","Todos"],["shopify","Shopify"],["woocommerce","WooCommerce"]].map(([value,label])=><button key={value} aria-pressed={source===value} className={`${field} ${source===value?"border-primary bg-primary/10 text-primary":""}`} onClick={()=>{setSource(value);setPage(1);}}>{label}</button>)}</div>
      <p className={`text-xs ${sync?.error||stale?"text-amber-400":"text-muted-foreground"}`}>{sync?`Shopify: última lectura ${date(sync.updatedAt)}${sync.error?" · con error":stale?" · revisión atrasada":""}`:"Shopify: sin información de sincronización"}</p>
    </div>
    <form className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:flex sm:flex-wrap" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search.trim());}}>
      <label className="min-w-0 space-y-1 text-sm"><span className="block">Pedido, cliente o teléfono</span><input className={`${field} w-full sm:w-72`} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Buscar en todos los pedidos"/></label>
      <button className={field} type="submit">Buscar</button>
      <label className="col-span-2 space-y-1 text-sm"><span className="block">Estado operativo</span><select className={`${field} w-full sm:w-auto`} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todos los estados</option>{Object.entries(ITALIA_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <p className="col-span-2 pb-2 text-sm text-muted-foreground" aria-live="polite">{loaded?`${count.toLocaleString("es-ES")} ${count===1?"pedido":"pedidos"}`:"Cargando pedidos…"}</p>
    </form>
    {source!=="woocommerce"&&<p className="text-xs text-muted-foreground">La gestión de Shopify se guarda en Kairo. Los estados originales de pago y envío se actualizan desde Shopify cada cinco minutos.</p>}
    {error&&<p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}
    {loaded&&!busy&&orders.length===0&&<div className="rounded-lg border border-border p-10 text-center"><h2 className="font-medium">No hay pedidos en esta vista</h2><p className="mt-2 text-sm text-muted-foreground">{source==="woocommerce"?"Los pedidos nuevos de WooCommerce aparecerán aquí al terminar la compra.":"Prueba otro filtro o búsqueda."}</p></div>}
    <div className="space-y-3">{orders.map(o=>{
      const a=o.address,isShopify=o.source==="shopify",awaiting=o.version!==o.synced_version;
      return <article key={o.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{o.order_number}</h2><span className={`rounded border px-2 py-0.5 text-xs ${isShopify?"border-emerald-700/50 text-emerald-400":"border-violet-700/50 text-violet-300"}`}>{isShopify?"Shopify":"WooCommerce"}</span></div><p className="mt-1 text-xs text-muted-foreground">{date(o.created_at)}</p></div><div className="ml-auto shrink-0 text-right"><p className="text-lg font-semibold">{money(o.total,o.currency)}</p><p className="text-sm">{ITALIA_STATUS[o.status]}</p>{isShopify&&<p className="text-xs text-muted-foreground">{o.managed_at?"Estado operativo en Kairo":"Según Shopify"}</p>}</div></div>
        {isShopify&&<p className="mt-3 text-xs text-muted-foreground">Shopify: {FINANCIAL_LABELS[o.financial_status]||o.financial_status||"Pago sin informar"} · {FULFILLMENT_LABELS[o.fulfillment_status]||o.fulfillment_status}{o.shopify_cancelled?" · Pedido anulado":""}</p>}
        {!isShopify&&<p className="mt-3 text-xs text-muted-foreground">{o.financial_status==="paid"?"Pagado con Stripe · No cobrar al entregar":"Contra entrega · Cobrar al entregar"}</p>}
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><p className="font-medium">{o.customer_name}</p>{o.phone?<a className="underline" href={`tel:${o.phone.replace(/[^+\d]/g,"")}`}>{o.phone}</a>:<p className="text-muted-foreground">Sin teléfono</p>}{o.email&&<p className="break-all text-muted-foreground">{o.email}</p>}</div>
          <div><p>{a.address_1||"Dirección no disponible"}</p>{a.address_2&&<p>{a.address_2}</p>}<p>{a.postcode&&<strong>CAP {a.postcode} · </strong>}{a.city}{a.state?` (${a.state})`:""}</p><p className="text-muted-foreground">{[a.region,a.country].filter(Boolean).join(" · ")}</p></div>
          <ul className="space-y-1">{o.items.map((item,n)=><li key={n}>{item.quantity} × {item.name}<span className="block text-xs text-muted-foreground">SKU: {item.sku||"Sin SKU"} · {money(item.total,o.currency)}</span></li>)}</ul>
        </div>
        {o.note&&<details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Nota original del pedido</summary><p className="mt-2 whitespace-pre-wrap break-words">{o.note}</p></details>}
        {o.management_note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm"><strong>Nota interna: </strong>{o.management_note}</p>}
        {(o.tracking_number||o.original_tracking)&&<p className="mt-2 break-words text-sm"><strong>Guía{!o.tracking_number?" en Shopify":""}: </strong>{o.courier} {o.tracking_number||o.original_tracking}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className={`text-xs ${o.last_error?"text-amber-400":"text-muted-foreground"}`}>{isShopify?(o.managed_at?`Gestión guardada ${date(o.managed_at)}`:"Pedido original conservado en el respaldo"):(awaiting?(o.last_error?`${o.last_error}. Reintentaremos automáticamente.`:"Guardado en Kairo; pendiente de confirmar en la tienda."):"Sincronizado con WooCommerce")}</p>
          {isShopify?<button className={field} onClick={()=>setManaging(o)}>Gestionar</button>:<div className="flex flex-wrap gap-2">{transitions(o).map(next=><button key={next} className={field} disabled={awaiting||saving} onClick={()=>setChange({order:o,status:next,requestId:crypto.randomUUID()})}>{next==="cancelled"?"Anular":next==="confirmed"?"Confirmar":next==="dispatched"?"Marcar despachado":"Marcar entregado"}</button>)}</div>}
        </div>
      </article>;
    })}</div>
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm"><button className={field} disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page} de {Math.max(1,Math.ceil(count/50))}</span><button className={field} disabled={page*50>=count||busy} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    {managing&&<ManageShopifyDialog key={managing.id} order={managing} onClose={()=>setManaging(null)} onSaved={()=>{setManaging(null);void load();}}/>}
    <dialog ref={dialog} onCancel={e=>{if(saving)e.preventDefault();else setChange(null);}} aria-labelledby="woo-confirm" className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/60">{change&&<><h2 id="woo-confirm" className="text-lg font-semibold">{ITALIA_STATUS[change.status]} · {change.order.order_number}</h2><p className="mt-3 text-sm text-muted-foreground">Este cambio se guardará en Kairo y se enviará a WooCommerce.</p>{error&&<p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button autoFocus className={field} disabled={saving} onClick={()=>setChange(null)}>Volver</button><button className={`${field} bg-primary text-primary-foreground`} disabled={saving} onClick={()=>void saveWoo()}>{saving?"Guardando…":"Confirmar cambio"}</button></div></>}</dialog>
  </main>;
}

