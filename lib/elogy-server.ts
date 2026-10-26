import {createHash} from "node:crypto";
import {getDB} from "./db";
import {identidadActual} from "./identidad";
import {wooAccess,wooStoreId} from "./woo-server";
import {ELOGY_RESOURCES,ElogyError,fetchElogyPage,elogyConfigured,type ElogyResource} from "./elogy";
import {normalizeElogyFact,type ElogyFact,type CostVersion,profitability,payoutPeriod} from "./elogy-model";
import {euroCents} from "./elogy-shared";
import {italiaDateRange} from "./italia-filters";
import {reconciliationData,type ElogyStatement,type StatementLine,type BankMovement,type BankAllocation} from "./elogy-reconciliation";

export function italiaFinanceAccess():boolean {return wooAccess()&&Boolean(identidadActual()?.permisos.includes("finanzas"));}
export const resources=Object.keys(ELOGY_RESOURCES) as ElogyResource[];
export async function syncElogy(pagesPerResource=1,selected:ElogyResource[]=resources,budgetMs=240000):Promise<Record<string,unknown>> {
 if(!elogyConfigured())throw new ElogyError("not_configured");
 const store=await wooStoreId(),db=getDB(),result:Record<string,unknown>={},deadline=Date.now()+budgetMs;
 for(const resource of selected){
  if(!resources.includes(resource))throw new ElogyError("invalid_resource");
  for(let page=0;page<Math.max(1,Math.min(pagesPerResource,10));page++){
   if(Date.now()>=deadline){result[resource]={deferred:true};break;}
   const claim=await db.rpc("italia_elogy_claim",{p_store:store,p_resource:resource});
   if(claim.error)throw new ElogyError("database_claim_failed");
   if(claim.data.busy){result[resource]={busy:true};break;}
   const lease=claim.data.lease;
   try {
    const data=await fetchElogyPage(resource,claim.data.offset);
    const hash=createHash("sha256").update(data.rows.map(r=>String(r.id)).join("|")).digest("hex");
    if(data.rows.length&&claim.data.last_hash===hash)throw new ElogyError("pagination_repeated");
    const rows=data.rows.map(r=>normalizeElogyFact(resource,r)).filter((r):r is ElogyFact=>r!==null);
    const finish=await db.rpc("italia_elogy_finish",{p_store:store,p_resource:resource,p_lease:lease,p_rows:rows,p_next:data.next,p_total:data.total,p_complete:data.complete,p_hash:hash,p_error:null});
    if(finish.error||finish.data!==true)throw new ElogyError("database_finish_failed");
    result[resource]={read:data.rows.length,accepted:rows.length,next:data.complete?0:data.next,total:data.total,complete:data.complete};
    if(data.complete)break;
   } catch(e) {
    const code=e instanceof ElogyError?e.code:"sync_failed";
    await db.rpc("italia_elogy_finish",{p_store:store,p_resource:resource,p_lease:lease,p_rows:[],p_next:claim.data.offset,p_total:null,p_complete:false,p_hash:null,p_error:code});
    result[resource]={error:code};break;
   }
  }
 }
 return result;
}

export async function elogyFacts(store:number,resource:ElogyResource):Promise<ElogyFact[]> {
 const out:ElogyFact[]=[];
 for(let offset=0;offset<50000;offset+=1000){
  const q=await getDB().from("italia_elogy_records").select("data").eq("store_id",store).eq("resource",resource).order("record_id").range(offset,offset+999);
  if(q.error)throw new ElogyError("database_read_failed");
  out.push(...(q.data||[]).map(r=>r.data as ElogyFact));if((q.data||[]).length<1000)return out;
 }
 throw new ElogyError("dataset_too_large");
}
async function versions(store:number):Promise<CostVersion[]> {
 const out:CostVersion[]=[];
 for(let offset=0;offset<20000;offset+=1000){const q=await getDB().from("product_cost_versions").select("sku,unit_cost,packaging_cost,currency,effective_from,created_at,provisional").eq("store_id",store).order("id").range(offset,offset+999);if(q.error)throw new ElogyError("database_read_failed");out.push(...(q.data||[]) as CostVersion[]);if((q.data||[]).length<1000)return out;}
 throw new ElogyError("dataset_too_large");
}
async function ledgerRows(store:number,table:"italia_elogy_statement_lines"|"italia_elogy_bank_movements"|"italia_elogy_bank_allocations"){
 const rows:Record<string,unknown>[]=[];
 for(let offset=0;offset<50000;offset+=1000){const q=await getDB().from(table).select("*").eq("store_id",store).order("id").range(offset,offset+999);if(q.error)throw new ElogyError("database_read_failed");rows.push(...(q.data||[]));if((q.data||[]).length<1000)return rows;}
 throw new ElogyError("dataset_too_large");
}
export function elogyPeriod(params:URLSearchParams){return italiaDateRange(params.get("period")||"month",params.get("from")||"",params.get("to")||"");}
export async function readElogyWorkspace(params:URLSearchParams,finance:boolean) {
 const store=await wooStoreId(),db=getDB(),range=elogyPeriod(params);
 const inRange=(date:string|null)=>!range||Boolean(date&&date>=range.from&&date<range.to);
 const [shipments,orders,sync,index]=await Promise.all([
  elogyFacts(store,"shipments"),elogyFacts(store,"orders"),
  db.from("italia_elogy_sync").select("resource,next_offset,total,last_ok_at,completed_at,last_error,cycles").eq("store_id",store),
  (async()=>{
   const rows:Array<{source:string;source_id:string;order_number:string}>=[];
   for(let start=0;start<50000;start+=1000){const q=await db.from("italia_orders").select("source,source_id,order_number").eq("store_id",store).order("source").order("source_id").range(start,start+999);if(q.error)return {data:null,error:q.error};rows.push(...(q.data||[]));if((q.data||[]).length<1000)return {data:rows,error:null};}
   return {data:null,error:{message:"dataset_too_large"}};
  })(),
 ]);
 if(sync.error||index.error)throw new ElogyError("database_read_failed");
 const refs=new Map<string,string[]>();
 for(const row of index.data||[]){const ref=row.order_number.trim().replace(/^#+/,"").toUpperCase();refs.set(ref,[...(refs.get(ref)||[]),`${row.source}:${row.source_id}`]);}
 const enriched=shipments.filter(s=>inRange(s.occurred_at)).sort((a,b)=>(b.occurred_at||"").localeCompare(a.occurred_at||"")||b.ref.localeCompare(a.ref)).map(s=>({...s,match:refs.get(s.ref)?.length===1?"matched":refs.has(s.ref)?"ambiguous":"unmatched"}));
 // The browser needs the operational columns, not the full provider mirror.
 const shipmentRows=enriched.map(({id,ref,guide,carrier,customer,state,state_label,state_at,occurred_at,gateway,currency,total_cents,match})=>({id,ref,guide,carrier,customer,state,state_label,state_at,occurred_at,gateway,currency,total_cents,match}));
 const base={configured:elogyConfigured(),sync:sync.data,shipments:shipmentRows,finance,sourceCount:shipments.length};
 if(!finance)return base;
 const [costs,collected,costVersions,currentCosts,expenseResult,payoutResult,lines,banks,allocations]=await Promise.all([
  elogyFacts(store,"costs"),elogyFacts(store,"collected"),versions(store),
  db.from("product_costs").select("id,sku,product_name,unit_cost,packaging_cost,currency,effective_from,updated_at,provisional").eq("store_id",store).eq("active",true).order("sku"),
  db.from("business_expenses").select("id,type,expense_date,description,amount,currency,platform,notes",{count:"exact"}).eq("store_id",store).order("expense_date",{ascending:false}).limit(1000),
  db.from("italia_elogy_payouts").select("*",{count:"exact"}).eq("store_id",store).order("statement_date",{ascending:false}).limit(1000),
  ledgerRows(store,"italia_elogy_statement_lines"),ledgerRows(store,"italia_elogy_bank_movements"),ledgerRows(store,"italia_elogy_bank_allocations"),
 ]);
 if(currentCosts.error||expenseResult.error||payoutResult.error)throw new ElogyError("database_read_failed");
 if((expenseResult.count||0)>(expenseResult.data||[]).length||(payoutResult.count||0)>(payoutResult.data||[]).length)throw new ElogyError("dataset_too_large");
 const expenses=(expenseResult.data||[]).filter(e=>inRange(new Date(`${e.expense_date}T12:00:00Z`).toISOString()));
 const bank=payoutPeriod(payoutResult.data||[],range);
 const reconciliation=reconciliationData((payoutResult.data||[]) as ElogyStatement[],lines as unknown as StatementLine[],banks as unknown as BankMovement[],allocations as unknown as BankAllocation[],collected,costs,shipments,range),payouts=reconciliation.statements;
 const profit=profitability(enriched,orders,costs,collected,costVersions);
 const cash=collected.filter(c=>inRange(c.occurred_at)).sort((a,b)=>(b.occurred_at||"").localeCompare(a.occurred_at||""));
 const expenseCents=expenses.reduce((n,e)=>n+(e.currency==="EUR"?euroCents(e.amount)||0:0),0);
 const incomplete=profit.filter(p=>p.contribution===null).length;
 const knownContribution=profit.reduce((n,p)=>n+(p.contribution||0),0);
 const estimated=profit.filter(p=>p.estimated).length;
 const complete=resources.every(r=>(sync.data||[]).some(s=>s.resource===r&&s.completed_at&&!s.last_error));
 // Dates of COD receipt and shipment intentionally belong to different report views.
 const cashRows=cash.map(({id,ref,guide,occurred_at,currency,total_cents})=>({id,ref,guide,occurred_at,currency,total_cents}));
 return {...base,profit,costs:currentCosts.data,expenses,payouts,collected:cashRows,reconciliation,summary:{
  deliveredSales:profit.filter(p=>p.state==="delivered").reduce((n,p)=>n+(p.sales||0),0),
  collected:cash.filter(c=>c.currency==="EUR").reduce((n,c)=>n+(c.total_cents||0),0),
  expectedBank:bank.expected,
  receivedBank:reconciliation.summary.bankReceived,
  expenses:expenseCents,knownContribution,incomplete,complete,estimated,
  netProfit:complete&&profit.length>0&&incomplete===0&&estimated===0?knownContribution-expenseCents:null,
 },skuCatalog:Array.from(new Map(orders.flatMap(o=>o.items).filter(i=>i.sku).map(i=>[i.sku,{sku:i.sku,name:i.name}])).values())};
}
