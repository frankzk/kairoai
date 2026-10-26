import {describe,it,expect,vi} from "vitest";
vi.mock("@/lib/db",()=>({getDB:vi.fn()}));
vi.mock("@/lib/stores",()=>({getShopifyCredentials:vi.fn(),tiendaShopifyPorCodigo:vi.fn()}));
vi.mock("@/lib/shopify-token",()=>({tokenShopify:vi.fn()}));
import {safeDownloadUrl,queryOnly,runPreservation} from "@/lib/shopify-preservation";
describe("Shopify preservation boundaries",()=>{
 it("downloads only known HTTPS export or asset hosts without embedded credentials",()=>{
  for(const value of ["https://storage.googleapis.com/shopify-export/abc","https://cdn.shopify.com/s/files/a.jpg"])expect(safeDownloadUrl(value)).toBe(true);
  for(const value of ["http://cdn.shopify.com/a","https://cdn.shopify.com.attacker.test/a","https://cdn.shopify.com@127.0.0.1/a","https://user:pass@cdn.shopify.com/a","file:///tmp/a","https://127.0.0.1/a"])expect(safeDownloadUrl(value)).toBe(false);
 });
 it("does not accept sales mutations or arbitrary request bodies as extraction plans",()=>{
  expect(queryOnly('{orders{edges{node{id}}}}')).toBe(true);expect(queryOnly('query Q{shop{id}}')).toBe(true);
  for(const value of ['mutation{orderCreate(input:{}){order{id}}}',{},'',null,'x'.repeat(100001)])expect(queryOnly(value)).toBe(false);
 });
 it("rejects path-like resources before touching the database",async()=>{
  for(const resource of ['../italia','_plan','orders?store=5','http://example.test',''])await expect(runPreservation(resource)).rejects.toThrow();
 });
});
