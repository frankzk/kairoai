import {describe,it,expect} from "vitest";
import {financeInput} from "@/lib/italia-finance-input";
import {csvValue} from "@/components/italia/finance-ui";
const requestId="12345678-1234-1234-1234-123456789012";
describe("Registro financiero Italia",()=>{
 it("whitelists EUR cents and concurrency fields, never trusting actor/store/received status",()=>{
  const r=financeInput({action:"cost",requestId,sku:" RYU-01 ",name:"QA",unit_cost:"2,10",packaging_cost:"0",effective_from:"2026-01-01",expected_updated_at:null,store_id:1,actor:"spoof",currency:"USD"});
  expect(r?.body).toEqual({sku:"ryu-01",name:"QA",unit_cents:210,packaging_cents:0,effective_from:"2026-01-01",expected_updated_at:null,provisional:false});
 });
 it("requires an explicit boolean for the provisional cost marker",()=>{
  const b={action:"cost",requestId,sku:"qa",name:"QA",unit_cost:"9",packaging_cost:"0",effective_from:"2026-01-01",expected_updated_at:null};
  expect(financeInput({...b,provisional:true})?.body.provisional).toBe(true);expect(financeInput({...b,provisional:"true"})).toBeNull();
 });
 it("rejects malformed dates, negative amounts, unknown actions and missing request identity",()=>{
  const valid={action:"payout",requestId,reference:"R1",date:"2026-10-25",expected:"10.00"};expect(financeInput(valid)).not.toBeNull();
  for(const row of [{...valid,requestId:""},{...valid,date:"2026-02-30"},{...valid,expected:"-1"},{...valid,expected:""},{...valid,action:"delete"}])expect(financeInput(row)).toBeNull();
 });
 it("requires an explicit amount, date and version for a bank receipt",()=>{
  const valid={action:"receipt",requestId,id:1,version:1,date:"2026-10-25",received:"0"};expect(financeInput(valid)?.body.received_cents).toBe(0);expect(financeInput({...valid,version:undefined})).toBeNull();expect(financeInput({...valid,received:undefined})).toBeNull();
 });
 it("escapes CSV formula injection while retaining numeric negative results",()=>{
  expect(csvValue("=HYPERLINK(\"private\")")).toBe('"\'=HYPERLINK(""private"")"');expect(csvValue(-12)).toBe('"-12"');expect(csvValue("a;b")).toBe('"a;b"');
 });
});
