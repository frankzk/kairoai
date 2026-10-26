import {describe,it,expect} from "vitest";
import {normalizeElogyFact,elogyTracking,productCost,profitability,type ElogyFact,type CostVersion} from "@/lib/elogy-model";
const fact=(resource:"orders"|"shipments"|"costs"|"collected",extra:Record<string,unknown>={}):ElogyFact=>normalizeElogyFact(resource,{id:resource==="orders"||resource==="shipments"?"o1":resource,order_id:"o1",order_number:"#KITA10",country:"IT",currency:"EUR",total_price:39.9,total:7.46,amount:39.9,type:"company",status:"matched",gateway:"cashondelivery",last_tracking_status:19,shipping_date:"2026-10-25T10:00:00Z",created_at:"2026-09-25T10:00:00Z",products:[{sku:"RYU-01",name:"QA",quantity:3}],...extra})!;
const versions:CostVersion[]=[{sku:"ryu-01",unit_cost:2,packaging_cost:0.1,currency:"EUR",effective_from:"2026-01-01",created_at:"2026-01-01"},{sku:"ryu-01",unit_cost:9,packaging_cost:0,currency:"EUR",effective_from:"2026-10-01",created_at:"2026-10-01"}];
describe("Normalización de Elogy",()=>{
 it("filters other countries/stores, unconfirmed cash matches and other fee levels",()=>{
  for(const extra of [{country:"ES"},{order_number:"MCRC10"},{type:"platform"},{type:"general"}])expect(normalizeElogyFact("costs",{...fact("costs"),order_number:"KITA10",...extra})).toBeNull();
  expect(normalizeElogyFact("collected",{order_number:"KITA10",country:"IT",status:"unmatched"})).toBeNull();
 });
 it("keeps 19.1 distinct from 19 and classifies reopen/partial states as incidents",()=>{
  expect(elogyTracking(19).state).toBe("delivered");expect(elogyTracking(19.1).state).toBe("returned");expect(elogyTracking(22).state).toBe("incident");expect(elogyTracking(18.5).state).toBe("incident");expect(elogyTracking(null).state).toBe("unknown");expect(elogyTracking(998).state).toBe("unknown");
 });
 it("selects only explicit facts, not API keys, addresses, IPs or arbitrary source fields",()=>{
  const row=fact("shipments",{api_key:"private",address:"private",browser_ip:"private",extra:"private"});expect(JSON.stringify(row)).not.toContain("private");expect(row.total_cents).toBe(3990);
 });
 it("retains collected money separately and does not map it to bank receipts",()=>{
  const row=fact("collected",{value_date:"2026-10-24T00:00:00Z",file:{name:"source report",url:"secret signed URL"}});expect(row.total_cents).toBe(3990);expect(row.occurred_at).toBe("2026-10-24T00:00:00.000Z");expect(row).not.toHaveProperty("received_cents");expect(JSON.stringify(row)).not.toContain("secret");
 });
});
describe("Rentabilidad sin importes inventados",()=>{
 it("costs all 3 and 5 units, including gifts, using the historical effective date",()=>{
  expect(productCost([{sku:"ryu-01",name:"QA",quantity:3}],"2026-09-25",versions).cents).toBe(630);
  expect(productCost([{sku:"ryu-01",name:"QA",quantity:5}],"2026-09-25",versions).cents).toBe(1050);
  const row=profitability([fact("shipments")],[fact("orders")],[fact("costs")],[fact("collected")],versions)[0];
  expect(row.products).toBe(630);expect(row.logistics).toBe(746);expect(row.contribution).toBe(2614);expect(row.collected).toBe(3990);
 });
 it("does not replace missing SKU, prices or foreign currencies with zero",()=>{
  expect(productCost([{sku:"missing",name:"QA",quantity:1}],"2026-09-25",versions).cents).toBeNull();
  const row=profitability([fact("shipments",{currency:"USD"})],[fact("orders")],[],[],versions)[0];expect(row.sales).toBeNull();expect(row.contribution).toBeNull();expect(row.collected).toBeNull();
 });
 it("requires online fees and returned inventory closure and flags duplicate fee rows",()=>{
  for(const extra of [{gateway:"online"},{last_tracking_status:19.1},{last_tracking_status:17.5}])expect(profitability([fact("shipments",extra)],[fact("orders")],[fact("costs")],[],versions)[0].contribution).toBeNull();
  expect(profitability([fact("shipments")],[fact("orders")],[fact("costs"),fact("costs",{id:"other"})],[],versions)[0].missing).toContain("Cargos múltiples por revisar");
 });
 it("keeps invalid quantities visible as missing cost instead of dropping part of an order",()=>{
  const order=fact("orders",{products:[{sku:"ryu-01",quantity:1},{sku:"ryu-01",quantity:"invalid"}]});
  expect(order.items).toHaveLength(2);expect(order.items[1].quantity).toBe(0);
  const row=profitability([fact("shipments")],[order],[fact("costs")],[],versions)[0];expect(row.products).toBeNull();expect(row.contribution).toBeNull();
  expect(profitability([fact("shipments",{total_price:null})],[fact("orders")],[fact("costs")],[],versions)[0].missing).toContain("Importe de venta pendiente");
 });
});
