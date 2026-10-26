"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { ITALIA_STATUS, type ItaliaOrder, type ItaliaStatus } from "@/lib/italia-orders";
import { ITALIA_PERIODS, ITALIA_STATES, type ItaliaCounts, type ItaliaPeriod } from "@/lib/italia-filters";
import { FINANCE_STORES } from "@/lib/store-config";
import { leerYo } from "@/lib/sesion-cliente";
import { useSelectedStore } from "@/lib/use-selected-store";
import ManageShopifyDialog from "./ManageShopifyDialog";
import OrdersTable from "./OrdersTable";
import ItaliaNav from "./ItaliaNav";
import { control, countLabel, statusTone } from "./order-ui";

import { KENKU_MANAGEMENT_STORES, kenkuManagementStore, type KenkuManagementCode } from "@/lib/kenku-management";
import { OrderDisplayContext, useOrderDisplay } from "./OrderDisplayContext";

type Sync = {updatedAt:string;complete:boolean;error:boolean}|null;
type Result = {key:string;orders:ItaliaOrder[];count:number;shopifySync:Sync};
type Counts = {scope:string;values:ItaliaCounts};

export default function KenkuOrders({storeCode="kenku-it"}:{storeCode?:KenkuManagementCode}) {
  return <OrderDisplayContext.Provider value={kenkuManagementStore(storeCode)}><OrdersWorkspace key={storeCode}/></OrderDisplayContext.Provider>;
}

function OrdersWorkspace() {
  const config=useOrderDisplay(),{date}=config;
  const number=(n:number)=>n.toLocaleString(config.locale);
  const [result,setResult]=useState<Result|null>(null),[counts,setCounts]=useState<Counts|null>(null),[page,setPage]=useState(1);
  const [source,setSource]=useState("all"),[status,setStatus]=useState(""),[search,setSearch]=useState(""),[query,setQuery]=useState("");
  const [period,setPeriod]=useState<ItaliaPeriod>("all"),[from,setFrom]=useState(""),[to,setTo]=useState("");
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState<string|null>(null);
  const [managing,setManaging]=useState<ItaliaOrder|null>(null);
  const [change,setChange]=useState<{order:ItaliaOrder;status:ItaliaStatus;requestId:string}|null>(null),[saving,setSaving]=useState(false);
  const [stores,setStores]=useState<Array<{code:string;label:string}>>([]);
  const [,selectStore]=useSelectedStore();
  const dialog=useRef<HTMLDialogElement>(null),request=useRef<AbortController|null>(null),countScope=useRef("");
  const scope=JSON.stringify([source,query,period,period==="range"?from:"",period==="range"?to:""]);
  const viewKey=JSON.stringify([scope,status,page]);
  const rangeReady=period!=="range"||Boolean(from&&to&&from<=to);
  const orders=result?.key===viewKey?result.orders:[];
  const loaded=result?.key===viewKey;
  const visibleCounts=counts?.scope===scope?counts.values:null;
  const total=visibleCounts?Object.values(visibleCounts).reduce((a,b)=>a+b,0):null;
  const sync=result?.shopifySync;
  useEffect(()=>{const yo=leerYo();setStores(yo?[...FINANCE_STORES,...KENKU_MANAGEMENT_STORES].filter(s=>yo.id===0||yo.tiendas.includes(s.code)):[]);},[]);
  useEffect(()=>{if(change)dialog.current?.showModal();else dialog.current?.close();},[change]);

  const load=useCallback(async(forceCounts=false)=>{
    request.current?.abort();
    if(!rangeReady){setBusy(false);return;}
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError("");
    try {
      const params=new URLSearchParams({page:String(page),source,status,search:query,period});
      if(period==="range"){params.set("from",from);params.set("to",to);}
      if(forceCounts||countScope.current!==scope)params.set("summary","1");
      const response=await fetch(`${config.api}/orders?${params}`,{cache:"no-store",signal:controller.signal});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"No se pudo cargar la lista");
      if(controller.signal.aborted)return;
      if(data.counts){setCounts({scope,values:data.counts});countScope.current=scope;}
      const lastPage=Math.max(1,Math.ceil(data.count/50));
      if(page>lastPage){setPage(lastPage);return;}
      setResult({key:viewKey,orders:data.orders,count:data.count,shopifySync:data.shopifySync});
    } catch(e) {
      if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Error de conexión");
    } finally {if(!controller.signal.aborted)setBusy(false);}
  },[page,source,status,query,period,from,to,rangeReady,scope,viewKey,config.api]);
  useEffect(()=>{void load();return()=>request.current?.abort();},[load]);
  const pending=orders.some(o=>o.source==="woocommerce"&&o.version!==o.synced_version);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==="visible"&&!managing&&!change)void load(true);},pending?15000:60000);return()=>clearInterval(timer);},[load,pending,managing,change]);

  function filterStatus(value:string){setStatus(value);setPage(1);setExpanded(null);}
  async function saveWoo() {
    if(!change||saving)return;
    setSaving(true);setError("");
    try {
      const response=await fetch(`/api/woo/orders/${change.order.source_id}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:change.status,version:change.order.version,requestId:change.requestId})});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"No se pudo guardar");
      setChange(null);await load(true);
    } catch(e) {setError(e instanceof Error?e.message:"Error de conexión");} finally {setSaving(false);}
  }
  const stale=sync?.updatedAt&&Date.now()-Date.parse(sync.updatedAt)>20*60*1000;
  const stats:[string,number|null,string][]=[
    ["Pedidos generados",total,"text-foreground"],
    ["Por confirmar",visibleCounts?.pending??null,"text-amber-300"],
    ["Confirmados",visibleCounts?.confirmed??null,"text-foreground"],
    ["Enviados",visibleCounts?visibleCounts.dispatched+visibleCounts.partial:null,"text-cyan-300"],
    ["Entregados",visibleCounts?.delivered??null,"text-emerald-300"],
    ["Anulados",visibleCounts?.cancelled??null,"text-red-300"],
  ];
  return <div className="min-h-screen bg-background">
    <header className="border-b border-border/50 bg-card/70">
      <div className="container mx-auto flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3"><Link href="/" className={`${control} shrink-0 border-transparent`}><ArrowLeft size={14}/><span>Dashboard</span></Link><div className="min-w-0"><h1 className="text-sm font-bold sm:text-lg">Gestión de pedidos</h1><p className="mt-0.5 text-xs text-muted-foreground">{config.label} · Shopify{config.woo?" y WooCommerce":""} · {config.currency}</p></div></div>
        <div className="flex items-center gap-2"><select aria-label="Tienda" value={config.code} className={`${control} h-9 min-w-0 flex-1 font-semibold sm:min-w-[190px]`} onChange={e=>{const kenku=KENKU_MANAGEMENT_STORES.find(s=>s.code===e.target.value);if(kenku){window.location.assign(kenku.path);return;}const store=FINANCE_STORES.find(s=>s.code===e.target.value);if(store){selectStore(store.code);window.location.assign("/admin/finance");}}}>{stores.map(s=><option value={s.code} key={s.code}>{s.label}</option>)}</select><button className={`${control} h-9`} onClick={()=>void load(true)} disabled={busy||!rangeReady}><RefreshCw size={14} className={busy?"motion-safe:animate-spin":""}/>{busy?"Actualizando…":"Actualizar"}</button></div>
      </div>
    </header>
    <main className="container mx-auto space-y-5 px-4 py-5 sm:py-6">
      <section aria-label="Resumen de pedidos" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1" role="group" aria-label="Periodo de creación">{ITALIA_PERIODS.map(([value,label])=><button key={value} aria-pressed={period===value} className={`${control} py-1 ${period===value?"border-primary/60 bg-primary/15 text-primary":"text-muted-foreground"}`} onClick={()=>{setPeriod(value);setPage(1);setExpanded(null);}}>{label}</button>)}</div><p className="text-[11px] text-muted-foreground">Por fecha de creación · Horario de {config.region}</p></div>
        {period==="range"&&<div className="flex flex-wrap items-center gap-3 text-xs"><label className="flex items-center gap-2">Desde<input type="date" className={control} value={from} max={to||undefined} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label><label className="flex items-center gap-2">Hasta<input type="date" className={control} value={to} min={from||undefined} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label>{!rangeReady&&<p role="status" className="text-muted-foreground">Elige ambas fechas para consultar.</p>}</div>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{stats.map(([label,value,tone])=><div key={label} className="rounded-lg border border-border bg-card px-3 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className={`text-lg font-semibold tabular-nums ${tone}`}>{value===null?"—":number(value)}</p></div><p className="mt-1 text-[10px] text-muted-foreground">{period==="all"?"Pedidos disponibles en Kairo":"Periodo seleccionado"}</p></div>)}</div>
      </section>
      {config.woo&&<ItaliaNav/>}
      <p className={`text-[11px] ${sync?.error||stale?"text-amber-300":"text-muted-foreground"}`}>{sync?`Shopify: última lectura ${date(sync.updatedAt)}${sync.error?" · con error":stale?" · revisión atrasada":""}`:"Shopify: sin información de sincronización"}</p>
      {!config.woo&&<p className="text-xs text-muted-foreground">Estados según Shopify y gestión en Kairo. Las entregas y liquidaciones de {config.code==="kenku-ar"?"DropLatam y Fixy":"DropLatam"} aún no están conciliadas.</p>}
      <section className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4" aria-label={`Gestión de pedidos de ${config.region}`} aria-busy={busy}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <form className="flex min-w-0 flex-1 basis-full gap-2 sm:min-w-[320px] sm:basis-auto" onSubmit={e=>{e.preventDefault();setPage(1);setExpanded(null);setQuery(search.trim());}}><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 text-muted-foreground" size={14}/><input aria-label="Pedido, cliente o teléfono" className={`${control} h-8 w-full justify-start pl-8 text-xs`} value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido, cliente o teléfono"/></div><button className={control} type="submit">Buscar</button></form>
          {config.woo&&<div className="flex" role="group" aria-label="Origen del pedido">{[["all","Todos"],["shopify","Shopify"],["woocommerce","WooCommerce"]].map(([value,label])=><button key={value} aria-pressed={source===value} className={`${control} rounded-none first:rounded-l-md last:rounded-r-md ${source===value?"border-primary/60 bg-primary/10 text-primary":"text-muted-foreground"}`} onClick={()=>{setSource(value);setPage(1);setExpanded(null);}}>{label}</button>)}</div>}
        </div>
        <div className="mb-3 overflow-x-auto" role="group" aria-label="Estado operativo"><div className="flex min-w-max gap-1">
          <button aria-pressed={status===""} onClick={()=>filterStatus("")} className={`min-w-[84px] border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${status===""?"border-foreground/40 bg-muted/30":"border-border hover:bg-muted/30"}`}><span className="block text-[10px] text-muted-foreground">Todos</span><span className="block text-sm font-semibold tabular-nums">{total===null?"—":number(total)}</span></button>
          {ITALIA_STATES.map(key=><button key={key} aria-pressed={status===key} onClick={()=>filterStatus(key)} className={`min-w-[105px] flex-1 border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${status===key?"border-primary bg-seleccion":"border-border hover:bg-muted/30"}`}><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className={statusTone[key].split(" ").at(-1)} aria-hidden="true">●</span>{countLabel[key]}</span><span className="block text-sm font-semibold tabular-nums">{visibleCounts?number(visibleCounts[key]):"—"}</span></button>)}
        </div></div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]"><p className="text-muted-foreground">{status?`Estado: ${ITALIA_STATUS[status as ItaliaStatus]}`:"Todos los estados operativos"}</p><div className="flex items-center gap-2"><p aria-live="polite">{loaded?`${number(result.count)} pedidos`:!rangeReady?"Rango pendiente":busy?"Cargando pedidos…":"Sin datos"}</p><button className={`${control} p-1`} aria-label="Página anterior" disabled={page===1||busy||!loaded} onClick={()=>{setPage(p=>p-1);setExpanded(null);}}><ChevronLeft size={14}/></button><span className="tabular-nums">{loaded?`${page} / ${Math.max(1,Math.ceil(result.count/50))}`:"—"}</span><button className={`${control} p-1`} aria-label="Página siguiente" disabled={!loaded||page*50>=result.count||busy} onClick={()=>{setPage(p=>p+1);setExpanded(null);}}><ChevronRight size={14}/></button></div></div>
        {error&&<p role="alert" className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{error} <button className="ml-2 underline" onClick={()=>void load(true)}>Reintentar</button></p>}
        <OrdersTable orders={orders} loading={busy} disabled={busy||saving||Boolean(error)} expanded={expanded} onExpand={id=>setExpanded(v=>v===id?null:id)} onManage={setManaging} onChange={(order,next)=>setChange({order,status:next,requestId:crypto.randomUUID()})}/>
        {loaded&&!busy&&orders.length===0&&<div className="py-12 text-center"><h3 className="text-sm font-medium">No hay pedidos en esta vista</h3><p className="mt-2 text-xs text-muted-foreground">{source==="woocommerce"?"Los pedidos nuevos de WooCommerce aparecerán aquí al terminar la compra.":"Prueba otro periodo, estado o búsqueda."}</p></div>}
        <p className="mt-3 max-w-prose text-[11px] leading-relaxed text-muted-foreground">La gestión de Shopify se guarda en Kairo. Sus estados originales de pago y envío se conservan y se actualizan cada cinco minutos.</p>
      </section>
    </main>
    {managing&&<ManageShopifyDialog key={managing.id} order={managing} onClose={()=>setManaging(null)} onSaved={()=>{setManaging(null);void load(true);}}/>}
    <dialog ref={dialog} onCancel={e=>{if(saving)e.preventDefault();else setChange(null);}} aria-labelledby="woo-confirm" className="w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-background p-6 text-foreground backdrop:bg-black/60">{change&&<><h2 id="woo-confirm" className="text-lg font-semibold">{ITALIA_STATUS[change.status]} · {change.order.order_number}</h2><p className="mt-3 text-sm text-muted-foreground">Este cambio se guardará en Kairo y se enviará a WooCommerce.</p>{error&&<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button autoFocus className={control} disabled={saving} onClick={()=>setChange(null)}>Volver</button><button className={`${control} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={saving} onClick={()=>void saveWoo()}>{saving?"Guardando…":"Confirmar cambio"}</button></div></>}</dialog>
  </div>;
}
