import { describe,it,expect } from "vitest";
import { mapItaliaOrder,validManagementBody,transitions } from "@/lib/italia-orders";
const base={source:"shopify",source_id:"12345678901234",order_number:"#1001",created_at:"2026-10-25T10:00:00Z",status:"pending",version:0,synced_version:0,payload:{}};
describe("Italian Shopify mapping",()=>{
 it("keeps original identity, CAP, currency, source payment and shipping states",()=>{
  const order=mapItaliaOrder({...base,payload:{currency:"EUR",total_price:"39.90",financial_status:"paid",fulfillment_status:null,shipping_address:{name:"Test",zip:"00118",city:"Roma",province_code:"RM",country_code:"IT",address1:"Via test",phone:"+393000000000"},line_items:[{title:"Product",sku:"SKU",quantity:2,price:"24.95",total_discount:"10.00"}]}});
  expect(order.id).toBe("shopify:12345678901234");expect(order.status).toBe("pending");expect(order.financial_status).toBe("paid");expect(order.fulfillment_status).toBe("unfulfilled");
  expect(order.address.postcode).toBe("00118");expect(order.phone).toBe("+393000000000");expect(order.items[0].total).toBe(39.9);expect(order.total).toBe(39.9);
 });
 it("handles missing customers, phones, prices and addresses without inventing data",()=>{
  const order=mapItaliaOrder(base);expect(order.customer_name).toBe("Sin nombre");expect(order.phone).toBe("");expect(order.total).toBeNull();expect(order.address.postcode).toBe("");
 });
 it("does not send the raw archive or private customer metadata to the client",()=>{
  const order=mapItaliaOrder({...base,payload:{customer:{first_name:"Test",last_name:"Customer",phone:"123",email:"test@example.test",note:"private archive note"},client_details:{browser_ip:"127.0.0.1"},token:"private"}});
  expect(order.customer_name).toBe("Test Customer");expect(order.phone).toBe("123");expect(order).not.toHaveProperty("payload");expect(JSON.stringify(order)).not.toContain("private");expect(JSON.stringify(order)).not.toContain("127.0.0.1");
 });
 it("uses Woo's own identity and workflow even when the numeric id matches Shopify",()=>{
  const order=mapItaliaOrder({...base,source:"woocommerce",source_id:"12345678901234",status:"dispatched",payload:{customer_name:"Woo",currency:"EUR",total:20,phone:"+393000000000",address:{postcode:"00118",address_1:"Via",country:"IT"},items:[{name:"Woo item",sku:"W",quantity:1,total:20}]}});
  expect(order.id).toBe("woocommerce:12345678901234");expect(order.customer_name).toBe("Woo");expect(transitions(order)).toEqual(["delivered","cancelled"]);
  expect(transitions({...order,source:"shopify"})).toEqual(["delivered","returned"]);
 });
 it("preserves non-EUR amounts and ignores cancelled fulfillments for original tracking",()=>{
  const order=mapItaliaOrder({...base,payload:{currency:"USD",total_price:"10",fulfillments:[{status:"cancelled",tracking_number:"OLD"},{status:"success",tracking_numbers:["CURRENT"]}]}});
  expect(order.currency).toBe("USD");expect(order.original_tracking).toBe("CURRENT");
 });
});
describe("Management body",()=>{
 const valid={status:"confirmed",version:0,sourceUpdatedAt:null,note:"",courier:"",tracking:"",requestId:"12345678-1234-1234-1234-123456789012"};
 it("accepts a bounded operation and rejects missing concurrency fields and malformed values",()=>{
  expect(validManagementBody(valid)).toBe(true);
  for(const body of [{...valid,sourceUpdatedAt:undefined},{...valid,version:-1},{...valid,version:"0"},{...valid,note:"a".repeat(3001)},{...valid,requestId:"bad"},{...valid,status:"paid"},{...valid,sourceUpdatedAt:"bad"}])expect(validManagementBody(body)).toBe(false);
 });
});
