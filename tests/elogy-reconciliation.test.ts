import {describe,it,expect} from "vitest";
import {cashReview,reconciliationData,type ElogyStatement,type StatementLine,type BankMovement,type BankAllocation} from "@/lib/elogy-reconciliation";
import {normalizeElogyFact,type ElogyFact} from "@/lib/elogy-model";
import {reconciliationInput} from "@/lib/italia-reconciliation-input";
const source=(resource:"orders"|"shipments"|"costs"|"collected",extra:Record<string,unknown>={}):ElogyFact=>normalizeElogyFact(resource,{id:resource==="shipments"?"o1":resource,order_id:"o1",order_number:"KITA1",country:"IT",currency:"EUR",total_price:"100.00",total:"10.00",amount:"100.00",type:"company",status:"matched",gateway:"cashondelivery",last_tracking_status:19,shipping_date:"2026-09-25T10:00:00Z",value_date:"2026-09-28T10:00:00Z",...extra})!;
const statement=(extra:Partial<ElogyStatement>={}):ElogyStatement=>({id:1,reference:"ELOGY-1",statement_date:"2026-09-30",expected_cents:9000,version:1,received_cents:null,received_at:null,note:"",statement_proof:"Elogy extract 1",adjustment_cents:0,adjustment_reason:"",details_confirmed:true,closed_at:null,closed_by:"",...extra});
const lines:StatementLine[]=[{id:1,payout_id:1,resource:"collected",source_id:"collected",order_id:"o1",order_ref:"KITA1",amount_cents:10000,currency:"EUR"},{id:2,payout_id:1,resource:"costs",source_id:"costs",order_id:"o1",order_ref:"KITA1",amount_cents:1000,currency:"EUR"}];
const bank=(extra:Partial<BankMovement>={}):BankMovement=>({id:1,account:"bank alias",reference:"BANK-1",value_date:"2026-09-30",currency:"EUR",amount_cents:9000,eur_cents:9000,proof_reference:"Bank extract row 1",note:"",version:1,voided:false,...extra});
const run=(p:ElogyStatement[]= [statement()],b:BankMovement[]=[],a:BankAllocation[]=[],r:{from:string;to:string}|null=null)=>reconciliationData(p,lines,b,a,[source("collected")],[source("costs")],[source("shipments")],r);
describe("Elogy treasury reconciliation",()=>{
 it("does not confuse courier cash or statement net with bank receipt",()=>{const d=run();expect(d.checks[0]).toMatchObject({gross:10000,fees:1000,detailNet:9000,status:"awaiting_bank",bank:0});expect(d.summary.bankReceived).toBe(0);expect(d.summary.closed).toBe(0);});
 it("counts partial bank deposits in their own months and a statement across both months",()=>{
  const d=run([statement()],[bank({amount_cents:4000,eur_cents:4000}),bank({id:2,value_date:"2026-10-02",amount_cents:5000,eur_cents:5000})],[{id:1,bank_id:1,payout_id:1,amount_cents:4000},{id:2,bank_id:2,payout_id:1,amount_cents:5000}],{from:"2026-09-30T22:00:00.000Z",to:"2026-10-31T23:00:00.000Z"});
  expect(d.checks[0]).toMatchObject({bank:9000,status:"ready"});expect(d.summary.bankReceived).toBe(5000);expect(d.statements).toHaveLength(1);expect(d.banks[0].in_period).toBe(false);
 });
 it("shares one bank credit between statements without counting it twice",()=>{
  const d=run([statement(),statement({id:2,reference:"ELOGY-2",expected_cents:1000})],[bank({amount_cents:10000,eur_cents:10000})],[{id:1,bank_id:1,payout_id:1,amount_cents:9000},{id:2,bank_id:1,payout_id:2,amount_cents:1000}]);expect(d.summary.bankReceived).toBe(10000);expect(d.banks[0].remaining).toBe(0);
 });
 it("holds unknown foreign-currency equivalents pending and excludes voided credits",()=>{
  const d=run([],[bank({currency:"USD",eur_cents:null}),bank({id:2,voided:true})]);expect(d.summary.pendingFx).toBe(1);expect(d.banks[0].remaining).toBeNull();expect(d.summary.bankUnassigned).toBe(0);expect(d.summary.closed).toBe(0);
 });
 it("records a proven but unassigned bank credit as received, with its full balance available",()=>{const d=run([],[bank()]);expect(d.summary.bankReceived).toBe(9000);expect(d.summary.bankApplied).toBe(0);expect(d.summary.bankUnassigned).toBe(9000);});
 it("does not close on zero records and permits a documented zero-net statement",()=>{
  const empty=reconciliationData([statement({expected_cents:0,details_confirmed:false,statement_proof:""})],[],[],[],[],[],[],null);expect(empty.checks[0].status).toBe("missing_detail");
  const d=reconciliationData([statement({expected_cents:0})],[lines[0],{...lines[1],amount_cents:10000}],[],[],[source("collected")],[source("costs",{total:"100.00"})],[],null);expect(d.checks[0].status).toBe("ready");
 });
 it("flags changed provider amounts after closure and preserves the statement snapshot",()=>{
  const d=reconciliationData([statement({closed_at:"2026-10-01T00:00:00Z"})],lines,[bank()],[{id:1,bank_id:1,payout_id:1,amount_cents:9000}],[source("collected",{amount:"110.00"})],[source("costs")],[],null);expect(d.checks[0]).toMatchObject({status:"changed",sourceChanges:1,gross:10000,bank:9000});
 });
 it("keeps unverified statement differences explicit even with a matching bank deposit",()=>{const d=run([statement({expected_cents:8000})],[bank({amount_cents:8000,eur_cents:8000})],[{id:1,bank_id:1,payout_id:1,amount_cents:8000}]);expect(d.checks[0]).toMatchObject({detailDifference:1000,bankDifference:0,status:"detail_difference"});});
});
describe("COD review",()=>{
 it("finds unpaid, partial, excess and returned cash without expecting COD from online sales",()=>{
  expect(cashReview([source("shipments")],[])[0].issue).toBe("Entregado sin cobro registrado");
  expect(cashReview([source("shipments")],[source("collected",{amount:"40"})])[0].issue).toBe("Cobro parcial");
  expect(cashReview([source("shipments")],[source("collected",{amount:"101"})])[0].issue).toBe("Cobro superior a la venta");
  expect(cashReview([source("shipments",{last_tracking_status:19.1})],[source("collected")])[0].issue).toBe("Cobro con devolución o anulación");
  expect(cashReview([source("shipments",{gateway:"online"})],[])).toEqual([]);
  expect(cashReview([source("shipments",{gateway:"online"})],[source("collected")])[0].issue).toBe("Cobro COD en pedido online");
 });
 it("sums distinct partial collections by source order ID and never substitutes unknown amounts",()=>{
  expect(cashReview([source("shipments")],[source("collected",{amount:"40"}),source("collected",{id:"second",amount:"60"})])).toEqual([]);
  expect(cashReview([source("shipments",{total_price:null})],[source("collected")])[0].expected).toBeNull();
  expect(cashReview([], [source("collected")])[0].issue).toBe("Cobro sin envío en el espejo");
 });
});
describe("Reconciliation inputs",()=>{
 const requestId="12345678-1234-1234-1234-123456789012";
 const credit={action:"bank",requestId,account:"EUR bank",reference:"ABC",proof:"Extract row 1",date:"2026-10-01",currency:"EUR",amount:"90.00",eur_amount:"999",store_id:1,actor:"spoof"};
 it("fixes EUR equivalents to the actual EUR credit and does not trust actor or store",()=>{const r=reconciliationInput(credit)!;expect(r.body).toMatchObject({amount_cents:9000,eur_cents:9000,account:"eur bank"});expect(r.body).not.toHaveProperty("store_id");expect(r.body).not.toHaveProperty("actor");});
 it("allows foreign credits without an invented rate and rejects invalid evidence/date/amount",()=>{
  expect(reconciliationInput({...credit,currency:"USD",eur_amount:""})?.body.eur_cents).toBeNull();
  for(const change of [{proof:""},{date:"2026-02-30"},{amount:"-1"},{currency:"JPY"},{requestId:""}])expect(reconciliationInput({...credit,...change})).toBeNull();
 });
 it("requires statement version and explicit documented adjustments, not client-provided source money",()=>{
  const body={action:"statement",requestId,payout_id:1,version:1,reference:"ELOGY-1",date:"2026-09-30",expected:"90",confirmed:true,proof:"Statement",adjustment:"0"};expect(reconciliationInput(body)).not.toBeNull();expect(reconciliationInput({...body,adjustment:"-1"})).toBeNull();
  const linked=reconciliationInput({action:"source_link",requestId,payout_id:1,version:1,resource:"costs",ids:["a","a"],amount_cents:999})!;expect(linked.body.ids).toEqual(["a"]);expect(linked.body).not.toHaveProperty("amount_cents");
  expect(reconciliationInput({action:"allocate",requestId,payout_id:1,version:1,bank_id:"1",amount:"1"})).toBeNull();
 });
 it("requires reasons for unlinking, voiding and reopening",()=>{for(const action of ["reopen","source_unlink","unallocate","bank_void"]){const b={action,requestId,payout_id:1,version:1,bank_id:1,line_id:1};expect(reconciliationInput(b)).toBeNull();expect(reconciliationInput({...b,reason:"Evidence corrected"})).not.toBeNull();}});
});
