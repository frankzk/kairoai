"use client";
import { useEffect, useRef, useState } from "react";
import { ITALIA_STATUS, transitions, type ItaliaOrder, type ItaliaStatus } from "@/lib/italia-orders";

import { useOrderDisplay } from "./OrderDisplayContext";

type Event = {id:number;version:number;actor:string;created_at:string;after_state:{status:ItaliaStatus;note:string;courier:string;tracking_number:string}};
const field="w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
export default function ManageShopifyDialog({order,onClose,onSaved}:{order:ItaliaOrder;onClose:()=>void;onSaved:()=>void}) {
  const {api,date}=useOrderDisplay();
  const managementOrder={...order,status:order.reconciliation?.baseStatus??order.status};
  const dialog=useRef<HTMLDialogElement>(null);
  const [form,setForm]=useState({status:managementOrder.status,note:order.management_note,courier:order.courier,tracking:order.tracking_number});
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const [events,setEvents]=useState<Event[]>([]),[historyError,setHistoryError]=useState(false),[historyLoaded,setHistoryLoaded]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{
    const abort=new AbortController();
    void fetch(`${api}/shopify/${order.source_id}`,{signal:abort.signal,cache:"no-store"}).then(async r=>{
      if(!r.ok)throw Error();const data=await r.json();setEvents(data.events);setHistoryLoaded(true);
    }).catch(()=>{if(!abort.signal.aborted)setHistoryError(true);});
    return()=>abort.abort();
  },[order.source_id,api]);
  function edit(values:Partial<typeof form>){setForm(f=>({...f,...values}));setRequestId(crypto.randomUUID());setError("");}
  async function save(e:React.FormEvent){
    e.preventDefault();if(saving)return;setSaving(true);setError("");
    try{
      const response=await fetch(`${api}/shopify/${order.source_id}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,version:order.version,sourceUpdatedAt:order.source_updated_at,requestId})});
      const data=await response.json();if(!response.ok)throw Error(data.error||"No se pudo guardar");onSaved();
    }catch(e){setError(e instanceof Error?e.message:"Error de conexión");setSaving(false);}
  }
  return <dialog ref={dialog} aria-labelledby="manage-title" onCancel={e=>{e.preventDefault();if(!saving)onClose();}} className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground backdrop:bg-black/60 sm:p-6">
    <h2 id="manage-title" className="text-lg font-semibold">Gestionar {order.order_number}</h2>
    <p className="mt-1 text-sm text-muted-foreground">Pedido de Shopify · {order.customer_name}</p>
    <p className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">Estos cambios se guardan en Kairo. No modifican Shopify, no cobran ni reembolsan y no envían avisos al cliente.</p>
    <form onSubmit={e=>void save(e)} className="mt-4 space-y-4">
      {order.reconciliation&&<p className="text-xs text-muted-foreground">Seguimiento Elogy: {order.reconciliation.label||"Sin cruce"}. Este formulario edita la gestión interna conservada en Kairo; no modifica el seguimiento de Elogy.</p>}
      <label className="block space-y-1 text-sm"><span>Estado operativo en Kairo</span><select autoFocus className={field} value={form.status} disabled={saving} onChange={e=>edit({status:e.target.value as ItaliaStatus})}>{[managementOrder.status,...transitions(managementOrder)].map(s=><option key={s} value={s}>{ITALIA_STATUS[s]}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm"><span>Courier</span><input className={field} value={form.courier} maxLength={100} disabled={saving} onChange={e=>edit({courier:e.target.value})}/></label>
        <label className="block space-y-1 text-sm"><span>Número de guía</span><input className={field} value={form.tracking} maxLength={150} disabled={saving} onChange={e=>edit({tracking:e.target.value})}/></label>
      </div>
      {order.original_tracking&&<p className="text-xs text-muted-foreground">Guía original en Shopify: {order.original_tracking}</p>}
      <label className="block space-y-1 text-sm"><span>Nota interna</span><textarea className={`${field} min-h-24`} value={form.note} maxLength={3000} disabled={saving} onChange={e=>edit({note:e.target.value})}/></label>
      {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={saving} className="rounded-md border border-border px-4 py-2 text-sm" onClick={onClose}>Volver</button><button disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{saving?"Guardando…":"Guardar gestión"}</button></div>
    </form>
    <details className="mt-5 border-t border-border pt-4 text-sm"><summary className="cursor-pointer">Historial de gestión en Kairo</summary>
      {historyError?<p className="mt-3 text-red-400">No se pudo cargar el historial.</p>:!historyLoaded?<p className="mt-3">Cargando…</p>:events.length===0?<p className="mt-3 text-muted-foreground">Aún no hay cambios registrados en Kairo.</p>:<ol className="mt-3 space-y-3">{events.map(e=><li key={e.id} className="border-l-2 border-border pl-3"><p className="font-medium">{ITALIA_STATUS[e.after_state.status]} · {e.actor}</p><p className="text-xs text-muted-foreground">{date(e.created_at)}</p>{e.after_state.note&&<p className="mt-1 whitespace-pre-wrap break-words">{e.after_state.note}</p>}{(e.after_state.courier||e.after_state.tracking_number)&&<p className="break-words text-muted-foreground">{e.after_state.courier} · {e.after_state.tracking_number}</p>}</li>)}</ol>}
    </details>
  </dialog>;
}
