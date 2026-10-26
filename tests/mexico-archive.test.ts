import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {access,queries}=vi.hoisted(()=>({access:vi.fn(),queries:[] as any[]}));
vi.mock("@/lib/mexico-server",()=>({mexicoAccess:access,mexicoStoreId:async()=>3}));
vi.mock("@/lib/db",()=>({getDB:()=>({from:(table:string)=>{const calls:any[]=[];queries.push({table,calls});const b:any={};for(const m of ['select','eq','order','range','ilike','in'])b[m]=(...a:any[])=>{calls.push([m,...a]);return b;};b.then=(resolve:any)=>Promise.resolve({data:table==='shopify_archivo_imagenes'?[]:[{record_id:'123',archived_at:'2026-10-26',payload:{title:'Product',first_name:'Customer',last_name:'Test',email:'customer@example.test',tags:'',image:{id:5,src:'https://cdn.shopify.com/image.jpg'},variants:[{id:6,price:'49.95',sku:'MX-SKU',inventory_quantity:5}],token:'MUST_NOT_REACH_BROWSER'}}],count:1,error:null}).then(resolve);return b;}})}));
import {mexicoArchiveList} from "@/lib/mexico-archive";
describe("Mexico archive readers without Shopify",()=>{
 beforeEach(()=>{access.mockReturnValue(true);queries.length=0;});
 it("denies other tenants before reading",async()=>{access.mockReturnValue(false);expect((await mexicoArchiveList(new NextRequest('https://app.test/api/mexico/customers'),'customer')).status).toBe(403);expect(queries).toEqual([]);});
 it("keeps prices exact and never falls back to Shopify images or API",async()=>{
  const network=vi.spyOn(globalThis,'fetch');const response=await mexicoArchiveList(new NextRequest('https://app.test/api/mexico/catalog?store_id=5'),'product');const data=await response.json();
  expect(data.rows[0].variants[0].price).toBe('49.95');expect(data.rows[0].image_url).toBeNull();expect(JSON.stringify(data)).not.toContain('shopify.com');expect(JSON.stringify(data)).not.toContain('MUST_NOT_REACH_BROWSER');expect(network).not.toHaveBeenCalled();network.mockRestore();
  for(const q of queries)expect(q.calls).toContainEqual(['eq','store_id',3]);
 });
 it("serves customers from the archive with server paging and escaped search",async()=>{
  const response=await mexicoArchiveList(new NextRequest('https://app.test/api/mexico/customers?page=2&search=50%25_'),'customer');const data=await response.json();expect(data.rows[0].name).toBe('Customer Test');expect(data.source).toBe('kairo-archive');expect(queries[0].table).toBe('mexico_customers');expect(queries[0].calls).toContainEqual(['range',50,99]);expect(queries[0].calls).toContainEqual(['ilike','search_text','%50\\%\\_%']);
 });
});
