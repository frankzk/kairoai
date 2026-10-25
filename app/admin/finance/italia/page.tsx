"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WOO_STATUS, WOO_TRANSITIONS, type WooStatus } from "@/lib/woo-config";
import type { WooPayload } from "@/lib/woo-payload";
type Order = { id: number; woo_id: number; order_number: string; payload: WooPayload; status: WooStatus; version: number; synced_version: number; last_error: string | null };
const money = (v: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(v);
const field = "rounded-md border border-border bg-background px-3 py-2 text-sm";
export default function ItalyOrders() {
  const [orders,setOrders] = useState<Order[]>([]), [count,setCount] = useState(0), [page,setPage] = useState(1);
  const [status,setStatus] = useState(""), [search,setSearch] = useState(""), [query,setQuery] = useState("");
  const [error,setError] = useState(""), [busy,setBusy] = useState(false), [loaded,setLoaded] = useState(false);
  const [change,setChange] = useState<{order:Order;status:WooStatus;requestId:string}|null>(null);
  const [saving,setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(change) dialog.current?.showModal();else dialog.current?.close();},[change]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({page:String(page),status,search:query});
      const res = await fetch(`/api/woo/orders?${params}`,{cache:"no-store",signal});
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "No se pudo cargar la lista");
      setOrders(data.orders); setCount(data.count); setLoaded(true);
    } catch(e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error de conexión"); }
    finally { if (!signal?.aborted) setBusy(false); }
  },[page,status,query]);
  useEffect(()=>{const controller=new AbortController(); void load(controller.signal); return ()=>controller.abort();},[load]);
  // Pending acknowledgements recover through the durable server queue.
  useEffect(()=>{
    if (!orders.some(o=>o.version!==o.synced_version)) return;
    const timer=setInterval(()=>{void load();},15000); return ()=>clearInterval(timer);
  },[orders,load]);
  async function save() {
    if (!change || saving) return; setSaving(true); setError("");
    try {
      const res=await fetch(`/api/woo/orders/${change.order.id}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:change.status,version:change.order.version,requestId:change.requestId})});
      const data=await res.json(); if(!res.ok) throw new Error(data.error || "No se pudo guardar");
      setChange(null); await load();
    } catch(e) { setError(e instanceof Error?e.message:"Error de conexión"); }
    finally {setSaving(false);}
  }
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
      <div><Link href="/admin/finance" className="text-sm text-muted-foreground hover:underline">Gestión de pedidos</Link><h1 className="mt-2 text-2xl font-semibold">Kenku Italia</h1><p className="mt-1 text-sm text-muted-foreground">Pedidos contra entrega · EUR · Horario de Italia</p></div>
      <button className={field} onClick={()=>void load()} disabled={busy}>{busy?"Actualizando…":"Actualizar"}</button>
    </header>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setPage(1);setQuery(search);}}>
      <label className="space-y-1 text-sm"><span className="block">Número de pedido</span><input className={field} value={search} onChange={e=>setSearch(e.target.value)} placeholder="KIT…" /></label>
      <button className={field} type="submit">Buscar</button>
      <label className="space-y-1 text-sm"><span className="block">Estado</span><select className={field} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todos</option>{Object.entries(WOO_STATUS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">{loaded?`${count} pedidos`:"Cargando pedidos…"}</p>
    </form>
    {error&&<p role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}
    {loaded&&!busy&&orders.length===0&&<div className="rounded-lg border border-border px-6 py-12 text-center"><h2 className="font-medium">No hay pedidos en esta vista</h2><p className="mt-2 text-sm text-muted-foreground">Los pedidos de la tienda aparecerán aquí cuando el cliente termine su compra.</p></div>}
    <div className="space-y-3">{orders.map(o=>{
      const p=o.payload,a=p.address,pending=o.version!==o.synced_version;
      return <article key={o.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{o.order_number}</h2><p className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString("es-ES",{timeZone:"Europe/Rome"})} · WooCommerce</p></div><div className="text-right"><p className="text-lg font-semibold">{money(p.total)}</p><p className="text-sm">{WOO_STATUS[o.status]}</p></div></div>
        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><p className="font-medium">{p.customer_name}</p><a className="underline" href={`tel:${p.phone}`}>{p.phone}</a>{p.email&&<p className="break-all text-muted-foreground">{p.email}</p>}</div>
          <div><p>{a.address_1}</p>{a.address_2&&<p>{a.address_2}</p>}<p><strong>CAP {a.postcode}</strong> · {a.city} ({a.state})</p><p className="text-muted-foreground">{a.region}{a.province?` · ${a.province}`:""}</p></div>
          <ul className="space-y-1">{p.items.map((i,n)=><li key={n}>{i.quantity} × {i.name}<span className="block text-xs text-muted-foreground">SKU: {i.sku||"Sin SKU"} · {money(i.total)}</span></li>)}</ul>
        </div>
        {p.note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm"><strong>Nota: </strong>{p.note}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className={`text-xs ${o.last_error?"text-amber-500":"text-muted-foreground"}`} aria-live="polite">{pending?(o.last_error?`${o.last_error}. Reintentaremos automáticamente.`:"Guardado en Kairo; pendiente de confirmar en la tienda."):"Sincronizado con la tienda"}</p>
          <div className="flex flex-wrap gap-2">{WOO_TRANSITIONS[o.status].map(next=><button key={next} disabled={pending||saving} className={`${field} disabled:opacity-40`} onClick={()=>setChange({order:o,status:next,requestId:crypto.randomUUID()})}>{next==="cancelled"?"Anular":next==="confirmed"?"Confirmar":next==="dispatched"?"Marcar despachado":"Marcar entregado"}</button>)}</div>
        </div>
      </article>;
    })}</div>
    <div className="flex items-center justify-end gap-3 text-sm"><button className={field} disabled={page===1||busy} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button className={field} disabled={page*50>=count||busy} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    <dialog ref={dialog} onCancel={e=>{if(saving)e.preventDefault();else setChange(null);}} aria-labelledby="woo-confirm" className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/60">{change&&<><h2 id="woo-confirm" className="text-lg font-semibold">{WOO_STATUS[change.status]} · {change.order.order_number}</h2><p className="mt-3 text-sm text-muted-foreground">Este cambio se guardará en Kairo y se enviará a la tienda.</p>{error&&<p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button autoFocus className={field} disabled={saving} onClick={()=>setChange(null)}>Volver</button><button className={`${field} bg-primary text-primary-foreground`} disabled={saving} onClick={()=>void save()}>{saving?"Guardando…":"Confirmar cambio"}</button></div></>}</dialog>
  </main>;
}
