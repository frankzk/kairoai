import type {ElogyFact} from "./elogy-model";

export interface ElogyStatement {
 id:number;reference:string;statement_date:string;expected_cents:number;version:number;
 received_cents:number|null;received_at:string|null;note:string;
 statement_proof:string;adjustment_cents:number;adjustment_reason:string;
 details_confirmed:boolean;closed_at:string|null;closed_by:string;
}
export interface StatementLine {
 id:number;payout_id:number;resource:"collected"|"costs";source_id:string;
 order_id:string;order_ref:string;amount_cents:number;currency:string;
}
export interface BankMovement {
 id:number;account:string;reference:string;value_date:string;currency:"EUR"|"USD"|"GBP";
 amount_cents:number;eur_cents:number|null;proof_reference:string;note:string;version:number;voided:boolean;
}
export interface BankAllocation {id:number;payout_id:number;bank_id:number;amount_cents:number}
export interface ReconCandidate {id:string;resource:"collected"|"costs";ref:string;order_id:string;date:string|null;amount:number|null;currency:string;guide:string;assigned_to:number|null;eligible:boolean}
export interface CashIssue {id:string;ref:string;guide:string;date:string|null;state:string;expected:number|null;collected:number|null;difference:number|null;issue:string}
export interface StatementCheck {
 id:number;gross:number;fees:number;detailNet:number;detailDifference:number;bank:number;bankDifference:number;
 sourceChanges:number;lines:number;status:"closed"|"changed"|"missing_detail"|"detail_difference"|"awaiting_bank"|"bank_difference"|"ready";
}
export interface ReconciliationData {
 statements:ElogyStatement[];checks:StatementCheck[];lines:StatementLine[];
 banks:Array<BankMovement&{allocated:number;remaining:number|null;in_period:boolean}>;allocations:BankAllocation[];
 cashIssues:CashIssue[];
 summary:{statements:number;closed:number;ready:number;pending:number;bankReceived:number;bankApplied:number;bankUnassigned:number;pendingFx:number;unassignedCod:number;cashIssues:number};
}
const money=(n:unknown):number|null=>n!==null&&n!==undefined&&Number.isSafeInteger(Number(n))?Number(n):null;
const sum=<T,>(rows:T[],value:(r:T)=>number)=>rows.reduce((n,r)=>n+value(r),0);
export function reconciliationData(statements:ElogyStatement[],lines:StatementLine[],banks:BankMovement[],allocations:BankAllocation[],collected:ElogyFact[],costs:ElogyFact[],shipments:ElogyFact[],range:{from:string;to:string}|null):ReconciliationData {
 const inDay=(day:string)=>!range||`${day}T12:00:00.000Z`>=range.from&&`${day}T12:00:00.000Z`<range.to;
 const inTime=(value:string|null)=>!range||Boolean(value&&value>=range.from&&value<range.to);
 const source=new Map([...collected.map(c=>[`collected:${c.id}`,c] as const),...costs.map(c=>[`costs:${c.id}`,c] as const)]);
 const assigned=new Map(lines.map(l=>[`${l.resource}:${l.source_id}`,l.payout_id]));
 const bankMap=new Map(banks.map(b=>[b.id,b]));
 const checks:StatementCheck[]=statements.map(p=>{
  const detail=lines.filter(l=>l.payout_id===p.id),gross=sum(detail.filter(l=>l.resource==="collected"),l=>Number(l.amount_cents)),fees=sum(detail.filter(l=>l.resource==="costs"),l=>Number(l.amount_cents));
  const linked=allocations.filter(a=>a.payout_id===p.id),bank=sum(linked,a=>bankMap.get(a.bank_id)?.voided?0:Number(a.amount_cents));
  const sourceChanges=detail.filter(l=>{const s=source.get(`${l.resource}:${l.source_id}`);return !s||s.total_cents!==Number(l.amount_cents)||s.order_id!==l.order_id||(l.resource==="collected"?s.currency!=="EUR":s.country!=="IT"||s.billing_type!=="company"||Boolean(s.currency&&s.currency!=="EUR"));}).length;
  const detailNet=gross-fees+Number(p.adjustment_cents),detailDifference=detailNet-Number(p.expected_cents),bankDifference=bank-Number(p.expected_cents);
  let status:StatementCheck["status"];
  if(sourceChanges)status="changed";
  else if(p.closed_at)status="closed";
  else if(!p.details_confirmed||!p.statement_proof.trim()||!detail.length)status="missing_detail";
  else if(detailDifference!==0)status="detail_difference";
  else if(!linked.length&&Number(p.expected_cents)>0||bank<Number(p.expected_cents))status="awaiting_bank";
  else if(bankDifference!==0)status="bank_difference";
  else status="ready";
  return {id:p.id,gross,fees,detailNet,detailDifference,bank,bankDifference,sourceChanges,lines:detail.length,status};
 });
 const scoped=statements.filter(p=>inDay(p.statement_date)||allocations.some(a=>a.payout_id===p.id&&bankMap.has(a.bank_id)&&inDay(bankMap.get(a.bank_id)!.value_date)));
 const scopedIds=new Set(scoped.map(p=>p.id));
 const displayedBanks=banks.map(b=>{const allocated=sum(allocations.filter(a=>a.bank_id===b.id),a=>Number(a.amount_cents)),eur=money(b.eur_cents);return {...b,amount_cents:Number(b.amount_cents),eur_cents:eur,allocated,remaining:b.voided?0:eur===null?null:eur-allocated,in_period:inDay(b.value_date)};});
 const candidates:ReconCandidate[]=[...collected.map(s=>({s,resource:"collected" as const})),...costs.map(s=>({s,resource:"costs" as const}))].map(({s,resource})=>({id:s.id,resource,ref:s.ref,order_id:s.order_id,date:s.occurred_at,amount:s.total_cents,currency:resource==="costs"&&s.country==="IT"&&!s.currency?"EUR":s.currency,guide:s.guide,assigned_to:assigned.get(`${resource}:${s.id}`)??null,eligible:s.total_cents!==null&&(resource==="collected"?s.currency==="EUR"&&s.total_cents>=0:s.country==="IT"&&s.billing_type==="company"&&(!s.currency||s.currency==="EUR"))}));
 const cashIssues=cashReview(shipments,collected).filter(i=>inTime(i.date));
 const scopedBanks=displayedBanks.filter(b=>inDay(b.value_date));
 const scopedChecks=checks.filter(c=>scopedIds.has(c.id));
 return {statements:scoped,checks:scopedChecks,lines:lines.filter(l=>scopedIds.has(l.payout_id)),banks:displayedBanks,allocations,cashIssues,summary:{
  statements:scoped.length,closed:scopedChecks.filter(c=>c.status==="closed").length,ready:scopedChecks.filter(c=>c.status==="ready").length,pending:scopedChecks.filter(c=>!["closed","ready"].includes(c.status)).length,
  bankReceived:sum(scopedBanks.filter(b=>!b.voided&&b.eur_cents!==null),b=>b.eur_cents||0),
  bankApplied:sum(allocations.filter(a=>{const b=bankMap.get(a.bank_id);return Boolean(b&&!b.voided&&inDay(b.value_date));}),a=>Number(a.amount_cents)),
  bankUnassigned:sum(scopedBanks.filter(b=>!b.voided&&b.remaining!==null),b=>b.remaining||0),pendingFx:scopedBanks.filter(b=>!b.voided&&b.eur_cents===null).length,
  unassignedCod:sum(candidates.filter(c=>c.resource==="collected"&&c.eligible&&c.assigned_to===null&&inTime(c.date)),c=>c.amount||0),cashIssues:cashIssues.length,
 }};
}
export function cashReview(shipments:ElogyFact[],collected:ElogyFact[]):CashIssue[]{
 const cash=new Map<string,ElogyFact[]>();for(const c of collected)cash.set(c.order_id,[...(cash.get(c.order_id)||[]),c]);
 const seen=new Set<string>(),out:CashIssue[]=[];
 for(const s of shipments){
  seen.add(s.order_id);const rows=cash.get(s.order_id)||[],cod=["cod","cashondelivery"].includes(s.gateway);
  if(!cod&&!rows.length||cod&&s.state!=="delivered"&&!rows.length)continue;
  const received=rows.every(c=>c.currency==="EUR"&&c.total_cents!==null)?sum(rows,c=>c.total_cents||0):null,expected=s.currency==="EUR"?s.total_cents:null;
  let issue="";
  if(!cod&&rows.length)issue="Cobro COD en pedido online";
  else if(rows.length&&["returned","returning","cancelled"].includes(s.state))issue="Cobro con devolución o anulación";
  else if(rows.length&&s.state!=="delivered")issue="Cobro sin entrega confirmada";
  else if(expected===null||received===null)issue="Importe o moneda por revisar";
  else if(received<expected)issue=rows.length?"Cobro parcial":"Entregado sin cobro registrado";
  else if(received>expected)issue="Cobro superior a la venta";
  if(issue)out.push({id:s.id,ref:s.ref,guide:s.guide,date:s.occurred_at,state:s.state,expected,collected:received,difference:expected===null||received===null?null:received-expected,issue});
 }
 for(const [id,rows] of Array.from(cash.entries()))if(!seen.has(id))out.push({id,ref:rows[0].ref,guide:rows[0].guide,date:rows[0].occurred_at,state:"unknown",expected:null,collected:rows.every(c=>c.currency==="EUR"&&c.total_cents!==null)?sum(rows,c=>c.total_cents||0):null,difference:null,issue:"Cobro sin envío en el espejo"});
 return out;
}
