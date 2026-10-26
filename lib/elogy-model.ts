import {euroCents,normalizeOrderReference,object,text,type ElogyRecord,type LogisticsState} from "./elogy-shared";
import type {ElogyResource} from "./elogy";

export interface ElogyItem {sku:string;name:string;quantity:number}
export interface ElogyFact {
 id:string;ref:string;order_id:string;occurred_at:string|null;source_updated_at:string|null;
 currency:string;total_cents:number|null;gateway:string;state:LogisticsState;state_code:number|null;
 state_label:string;state_at:string|null;guide:string;carrier:string;customer:string;country:string;
 external_id:string;items:ElogyItem[];billing_type:string;fees:Record<string,number|null>;file_ref:string;
}
const iso=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const latest=(...values:unknown[])=>values.map(iso).filter((x):x is string=>Boolean(x)).sort().at(-1)||null;
// Verified against Elogy's public getTrackingName mapping, not inferred from order payment status.
export function elogyTracking(code:unknown):{state:LogisticsState;label:string} {
 const n=Number(code);
 if(code===null||code===undefined||code==="")return {state:"unknown",label:"Sin seguimiento"};
 const names:Record<number,string>={0:"Spedizione creata",6:"Ritirato",17:"Spedizione partita",17.4:"Arrivata in filiale",17.5:"In transito",18:"In consegna",18.5:"Consegna parziale",19:"Consegnato",19.1:"Riconsegnato al mittente",21:"Reso al mittente",30:"Giacenza aperta",31:"Giacenza chiusa",32:"Spedizione rifiutata",999:"Annullato"};
 let state:LogisticsState="unknown";
 if(n===19)state="delivered";else if(n===19.1)state="returned";else if(n===21)state="returning";
 else if(n===18)state="out_for_delivery";else if([6,17,17.4,17.5,20,40,50,60].includes(n))state="in_transit";
 else if([0,0.2,0.3,0.5,1,2,3,4,5,500].includes(n))state="created";
 else if(n===999||n>=10&&n<=16)state="cancelled";
 else if([0.6,0.7,7,8,9,16.5,17.6,17.7,17.8,18.1,18.4,18.5,20.5,22,23,24,25,26,27,28,29,30,31,32].includes(n))state="incident";
 return {state,label:names[n]||`Estado Elogy ${text(code)}`};
}

const FEE_FIELDS=["shipping","cash_on_delivery","additional_kg","custom_box","delivery_to_the_floor","appointment_delivery","disadvantaged_zones","highly_disadvantaged_zones","multipackage","pick_pack","management","pluriball","istat","additional_over_products","additional_over","fuel","stock","insurance","returns","redelivery","extra_cost","pick_pack_heavy","pick_pack_return_commission"];
export function normalizeElogyFact(resource:ElogyResource,row:ElogyRecord):ElogyFact|null {
 const ref=normalizeOrderReference(row.order_number),country=text(row.country||row.order_customer_country).toUpperCase();
 // The account is Ryusei's. Keep Italy only and reject references from other stores.
 if(country&&country!=="IT"||!ref.startsWith("KIT"))return null;
 if(resource==="costs"&&row.type!=="company")return null;
 if(resource==="collected"&&row.status!=="matched")return null;
 const tracking=elogyTracking(row.last_tracking_status??row.tracking_status);
 const customer=object(row.customer),gateway=text(row.gateway);
 const occurred=resource==="collected"?iso(row.value_date||row.delivery_date):resource==="orders"?iso(row.created_at):iso(row.shipping_date||row.completed_at||row.created_at);
 const items=(Array.isArray(row.products)?row.products:[]).map(object).map(p=>({sku:text(p.sku||p.product_sku).trim().toLowerCase(),name:text(p.product_name||p.name),quantity:Number.isSafeInteger(Number(p.quantity))&&Number(p.quantity)>0?Number(p.quantity):0}));
 return {
  id:text(row.id),ref,order_id:resource==="orders"||resource==="shipments"?text(row.id):text(row.order_id),occurred_at:occurred,
  source_updated_at:latest(row.updated_at,row.last_tracking_status_date,row.tracking_status_date,row.import_date,row.created_at),
  currency:text(row.currency).toUpperCase(),
  total_cents:euroCents(resource==="collected"?row.amount:resource==="costs"?row.total:row.total_price),gateway,
  state:tracking.state,state_code:row.last_tracking_status===null||row.last_tracking_status===undefined?(row.tracking_status===null||row.tracking_status===undefined?null:Number(row.tracking_status)):Number(row.last_tracking_status),
  state_label:text(row.last_tracking_status_desc||row.tracking_status_name)||tracking.label,
  state_at:iso(row.last_tracking_status_date||row.tracking_status_date),guide:text(row.shipping_number||row.ext_shipping_number||row.shipping_code||row.shipment_id),
  carrier:text(row.carrier_slug||row.carrier_name||row.carrier_code),customer:text(row.customer_fullname||row.order_customer_fullname)||[text(customer.first_name||row.first_name),text(customer.last_name||row.last_name)].filter(Boolean).join(" "),country,
  external_id:text(row.external_id),items,
  billing_type:resource==="costs"?text(row.type):"",fees:resource==="costs"?Object.fromEntries(FEE_FIELDS.map(key=>[key,euroCents(row[key])])):{},file_ref:text(object(row.file).name),
 };
}

export interface CostVersion {sku:string;unit_cost:number;packaging_cost:number;currency:string;effective_from:string;created_at:string}
export function productCost(items:ElogyItem[],day:string,versions:CostVersion[]):{cents:number|null;missing:string[]} {
 let cents=0;const missing:string[]=[];
 if(!items.length)return {cents:null,missing:["Productos sin detalle"]};
 for(const item of items){
  const candidates=versions.filter(c=>c.sku.toLowerCase()===item.sku.toLowerCase()&&c.currency==="EUR"&&c.effective_from<=day).sort((a,b)=>b.effective_from.localeCompare(a.effective_from)||b.created_at.localeCompare(a.created_at));
  const cost=candidates[0],unit=cost?euroCents(cost.unit_cost):null,pack=cost?euroCents(cost.packaging_cost):null;
  if(!cost||unit===null||pack===null||unit<0||pack<0||!Number.isSafeInteger(item.quantity)||item.quantity<=0)missing.push(item.sku||"Sin SKU");
  else cents+=(unit+pack)*item.quantity;
 }
 return {cents:missing.length?null:cents,missing:Array.from(new Set(missing))};
}

export interface ProfitRow {id:string;ref:string;date:string|null;state:LogisticsState;sales:number|null;collected:number|null;logistics:number|null;products:number|null;contribution:number|null;missing:string[];gateway:string}
/** Bank cash belongs to the receipt month, even if the statement is older. */
export function payoutPeriod<T extends {statement_date:string;expected_cents:number;received_at:string|null;received_cents:number|null}>(rows:T[],range:{from:string;to:string}|null){
 const contains=(day:string|null)=>Boolean(day&&(!range||`${day}T12:00:00.000Z`>=range.from&&`${day}T12:00:00.000Z`<range.to));
 return {rows:rows.filter(r=>contains(r.statement_date)||contains(r.received_at)),expected:rows.filter(r=>contains(r.statement_date)).reduce((n,r)=>n+Number(r.expected_cents),0),received:rows.filter(r=>contains(r.received_at)).reduce((n,r)=>n+Number(r.received_cents||0),0)};
}
export function profitability(shipments:ElogyFact[],orders:ElogyFact[],costs:ElogyFact[],collected:ElogyFact[],versions:CostVersion[]):ProfitRow[] {
 const grouped=<T extends {order_id:string}>(rows:T[])=>{const m=new Map<string,T[]>();for(const r of rows)m.set(r.order_id,[...(m.get(r.order_id)||[]),r]);return m;};
 const costById=grouped(costs),cashById=grouped(collected),orderById=new Map(orders.map(o=>[o.id,o]));
 return shipments.map(s=>{
  const missing:string[]=[],billing=costById.get(s.order_id)||[],cash=cashById.get(s.order_id)||[];
  const fees=billing.length===1&&billing[0].billing_type==="company"&&billing[0].country==="IT"?billing[0].total_cents:null;
  const original=orderById.get(s.order_id),items=original?.items||[],cogs=productCost(items,(original?.occurred_at||s.occurred_at||"").slice(0,10),versions);
  const sales=s.currency==="EUR"&&s.state==="delivered"?s.total_cents:s.currency==="EUR"&&["cancelled","returned"].includes(s.state)?0:null;
  if(s.currency!=="EUR")missing.push("Moneda no conciliada");
  if(s.state==="delivered"&&s.total_cents===null)missing.push("Importe de venta pendiente");
  if(fees===null)missing.push(billing.length>1?"Cargos múltiples por revisar":"Costo Elogy pendiente");
  if(s.state!=="delivered")missing.push("Entrega o devolución sin cierre de inventario");
  missing.push(...cogs.missing.map(sku=>`Costo SKU: ${sku}`));
  if(!["cashondelivery","cod","online","stripe"].includes(s.gateway))missing.push("Medio de pago sin clasificar");
  // Stripe gateway fees are separate from Elogy's fees. Missing is not zero.
  if(["online","stripe"].includes(s.gateway))missing.push("Comisión del pago online pendiente");
  const received=cash.length&&cash.every(c=>c.currency==="EUR"&&c.total_cents!==null)?cash.reduce((n,c)=>n+(c.total_cents||0),0):null;
  return {id:s.id,ref:s.ref,date:s.occurred_at,state:s.state,sales,collected:received,logistics:fees,products:cogs.cents,contribution:missing.length||sales===null||fees===null||cogs.cents===null?null:sales-fees-cogs.cents,missing,gateway:s.gateway};
 });
}
