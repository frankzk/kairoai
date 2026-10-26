"use client";
import {useState} from "react";
import {control} from "./order-ui";
import {field,romeToday,type Cost,type Payout} from "./finance-ui";

export default function FinanceForm({action,cost,payout,disabled,skus,onSaved,onCancel}:{action:"cost"|"expense"|"payout"|"receipt";cost?:Cost|null;payout?:Payout|null;disabled:boolean;skus:Array<{sku:string;name:string}>;onSaved:()=>void;onCancel?:()=>void}){
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[requestId,setRequestId]=useState(()=>crypto.randomUUID());
 const input=(name:string,label:string,type="text",value?:string|number)=><label className="block space-y-1 text-xs"><span>{label}</span><input className={field} name={name} type={type} required defaultValue={value} step={type==="number"?"0.01":undefined} min={type==="number"?0:undefined} maxLength={type==="text"?300:undefined}/></label>;
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(saving||disabled)return;const form=event.currentTarget,values=Object.fromEntries(new FormData(form));setSaving(true);setError("");
  try{const body={...values,action,requestId,...(action==="cost"?{expected_updated_at:cost?.updated_at||null,provisional:values.provisional==="on"}:{}),...(action==="receipt"?{id:payout?.id,version:payout?.version}:{})};
   const r=await fetch("/api/italia/finance",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||"No se pudo guardar");form.reset();setRequestId(crypto.randomUUID());onSaved();
  }catch(e){setError(e instanceof Error?e.message:"Error de conexión");}finally{setSaving(false);}
 }
 return <form onSubmit={e=>void save(e)} onChange={()=>setRequestId(crypto.randomUUID())} className="space-y-4 rounded-lg border border-border bg-card p-4">
  <h3 className="text-sm font-semibold">{action==="cost"?(cost?`Editar costo: ${cost.sku}`:"Registrar costo por SKU"):action==="expense"?"Registrar gasto":action==="payout"?"Registrar liquidación de Elogy":`Registrar recepción bancaria: ${payout?.reference}`}</h3>
  <fieldset disabled={disabled||saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   {action==="cost"&&<><label className="space-y-1 text-xs"><span>SKU</span><input className={field} name="sku" list="italia-skus" required maxLength={100} readOnly={Boolean(cost)} defaultValue={cost?.sku}/><datalist id="italia-skus">{skus.map(s=><option key={s.sku} value={s.sku}>{s.name}</option>)}</datalist></label>{input("name","Nombre del producto","text",cost?.product_name||"")}{input("unit_cost","Costo por unidad (EUR)","number",cost?.unit_cost)}{input("packaging_cost","Empaque propio por unidad (EUR)","number",cost?.packaging_cost??0)}{input("effective_from","Vigente desde","date",cost?.effective_from||romeToday())}</>}
   {action==="expense"&&<><label className="space-y-1 text-xs"><span>Tipo</span><select className={field} name="type"><option value="ads">Publicidad</option><option value="payroll">Personal</option><option value="misc">Otros</option></select></label>{input("description","Descripción")}{input("amount","Importe (EUR)","number")}{input("date","Fecha","date",romeToday())}<label className="space-y-1 text-xs"><span>Plataforma (opcional)</span><input className={field} name="platform" maxLength={100}/></label></>}
   {action==="payout"&&<>{input("reference","Referencia del extracto / liquidación")}{input("date","Fecha del extracto","date",romeToday())}{input("expected","Neto indicado por Elogy (EUR)","number")}</>}
   {action==="receipt"&&<>{input("received","Importe efectivamente recibido (EUR)","number",payout?.received_cents==null?undefined:payout.received_cents/100)}{input("date","Fecha de abono en banco","date",payout?.received_at||romeToday())}</>}
   {action!=="cost"&&<label className="space-y-1 text-xs sm:col-span-2"><span>Nota o referencia del comprobante (opcional)</span><input className={field} name="note" maxLength={3000} defaultValue={payout?.note}/></label>}
  </fieldset>
  {action==="cost"&&<><label className="flex items-center gap-2 text-xs"><input type="checkbox" name="provisional" defaultChecked={cost?.provisional||false} disabled={disabled||saving}/>Costo provisional para estimar rentabilidad</label><p className="text-[11px] text-muted-foreground">Se aplicará por SKU y fecha, a todas las unidades enviadas, incluidos los regalos. El empaque propio se suma al costo del producto; los cargos de Elogy se leen por separado.</p></>}
  {action==="payout"&&<p className="max-w-prose text-[11px] text-muted-foreground">Introduce el neto del extracto de Elogy. Un cobro del courier no es una recepción bancaria. Este registro no realiza transferencias.</p>}
  {action==="receipt"&&<p className="text-[11px] text-muted-foreground">Registra solo abonos comprobados en EUR. Se conserva el historial de cambios. No se cobra ni transfiere dinero desde este formulario.</p>}
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  <div className="flex gap-2"><button disabled={disabled||saving} className={`${control} bg-primary text-primary-foreground hover:bg-primary/90`}>{saving?"Guardando…":"Guardar"}</button>{onCancel&&<button type="button" disabled={saving} className={control} onClick={onCancel}>Cancelar edición</button>}</div>
 </form>;
}
