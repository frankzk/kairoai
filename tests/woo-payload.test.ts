import { describe,it,expect } from "vitest";
import { createHmac } from "node:crypto";
import { normalizeWooPayload,validWooSignature,readWooBody,MAX_WOO_BODY } from "../lib/woo-payload";
import { WC_STATUS,WOO_TRANSITIONS } from "../lib/woo-config";
export const sample = () => ({event:"order.created",site:"https://shop.example",order:{id:123,number:"KIT123",status:"cod-pending",created_at:"2026-10-25T10:00:00+02:00",currency:"EUR",total:39.9,shipping:0,discount:20.1,payment_method:"cod",note:"",created_via:"cod-core"},customer:{first_name:"TEST",last_name:"NON SPEDIRE",phone:"+39 3123456789",email:"",subscribed:false},address:{country:"IT",state:"RM",city:"Roma",address_1:"Via Test 10",address_2:"",postcode:"00118",territory:{code:"12058091",region:"Lazio",province:"Roma"}},items:[{product_id:1,variation_id:0,sku:"TEST",name:"Test",quantity:1,total:39.9}]});
describe("cod-core envelope",()=>{
  it("preserves CAP zeros, EUR, SKU, phone and marketing choice",()=>{
    const p=normalizeWooPayload(sample(),["https://shop.example"]);
    expect(p.address.postcode).toBe("00118");expect(p.phone).toBe("+393123456789");expect(p.total).toBe(39.9);expect(p.currency).toBe("EUR");expect(p.items[0].sku).toBe("TEST");expect(p.marketing_consent).toBe(false);
  });
  it.each(["currency","status","payment_method"])("rejects wrong %s",key=>{const p=sample();(p.order as Record<string,unknown>)[key]="bad";expect(()=>normalizeWooPayload(p,[p.site])).toThrow();});
  it("rejects other sites, numeric CAP and negative quantity",()=>{
    const p=sample();expect(()=>normalizeWooPayload(p,["https://another.example"])).toThrow();
    (p.address as Record<string,unknown>).postcode=118;expect(()=>normalizeWooPayload(p,[p.site])).toThrow();
    const q=sample();q.items[0].quantity=-1;expect(()=>normalizeWooPayload(q,[q.site])).toThrow();
  });
  it("authenticates exact bytes and rejects malformed/missing signatures",()=>{
    const raw=Buffer.from(JSON.stringify(sample())); const sig="sha256="+createHmac("sha256","test-secret").update(raw).digest("hex");
    expect(validWooSignature(raw,sig,"test-secret")).toBe(true);
    expect(validWooSignature(Buffer.concat([raw,Buffer.from(" ")]),sig,"test-secret")).toBe(false);
    for(const signature of [null,"sha256=abc",sig.replace(/.$/,"z")]) expect(validWooSignature(raw,signature,"test-secret")).toBe(false);
  });
  it("limits streamed bodies without Content-Length",async()=>{
    const req=new Request("https://app.example",{method:"POST",body:"x".repeat(MAX_WOO_BODY+1)});
    await expect(readWooBody(req)).rejects.toThrow();
  });
  it("uses explicit registered Woo states and terminal states cannot rewind",()=>{
    expect(WC_STATUS.dispatched).toBe("cod-shipped");expect(WOO_TRANSITIONS.delivered).toEqual([]);expect(WOO_TRANSITIONS.cancelled).toEqual([]);
  });
});
