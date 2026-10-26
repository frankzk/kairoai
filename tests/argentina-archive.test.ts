import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {access,queries}=vi.hoisted(()=>({access:vi.fn(),queries:[] as any[]}));
vi.mock("@/lib/argentina-server",()=>({argentinaAccess:access,argentinaStoreId:async()=>4}));
vi.mock("@/lib/db",()=>({getDB:()=>({from:(table:string)=>{const calls:any[]=[];queries.push({table,calls});const b:any={};for(const m of ['select','eq','order','range','ilike','in'])b[m]=(...a:any[])=>{calls.push([m,...a]);return b;};b.then=(resolve:any)=>Promise.resolve({data:table==='shopify_archivo_imagenes'?[]:table==='shopify_archivo'?[{variants:[{sku:'DUP'},{sku:'DUP'},{sku:''}]}]:[{record_id:'123',archived_at:'2026-10-26',payload:{title:'Product',first_name:'Customer',last_name:'Test',email:'customer@example.test',tags:'',image:{id:5,src:'https://cdn.shopify.com/image.jpg'},variants:[{id:6,price:'12500.95',sku:'DUP',inventory_quantity:5},{id:7,price:'10.50',sku:'',inventory_quantity:2}],token:'MUST_NOT_REACH_BROWSER'}}],count:1,error:null}).then(resolve);return b;}})}));
import {argentinaArchiveList,internalCatalogSku} from "@/lib/argentina-archive";
describe("Argentina readers without Shopify",()=>{
 beforeEach(()=>{access.mockReturnValue(true);queries.length=0;});
 it("denies other stores before reading",async()=>{access.mockReturnValue(false);expect((await argentinaArchiveList(new NextRequest('https://app.test/api/argentina/customers'),'customer')).status).toBe(403);expect(queries).toEqual([]);});
 it("preserves exact prices and original SKUs; internal codes resolve duplicates and missing SKUs",async()=>{
  const network=vi.spyOn(globalThis,'fetch');const response=await argentinaArchiveList(new NextRequest('https://app.test/api/argentina/catalog?store_id=5'),'product');const d=await response.json();
  expect(d.rows[0].variants[0]).toMatchObject({price:'12500.95',sku:'DUP',internal_sku:'KAR-V6',sku_issue:'duplicate'});expect(d.rows[0].variants[1]).toMatchObject({sku:'',internal_sku:'KAR-V7',sku_issue:'missing'});
  expect(d.rows[0].image_url).toBeNull();expect(JSON.stringify(d)).not.toContain('shopify.com');expect(JSON.stringify(d)).not.toContain('MUST_NOT_REACH_BROWSER');expect(network).not.toHaveBeenCalled();network.mockRestore();
  for(const q of queries)expect(q.calls).toContainEqual(['eq','store_id',4]);
 });
 it("serves customers with paging and escaped search, from Kairo only",async()=>{
  const response=await argentinaArchiveList(new NextRequest('https://app.test/api/argentina/customers?page=2&search=50%25_'),'customer');const d=await response.json();expect(d.rows[0].name).toBe('Customer Test');expect(d.source).toBe('kairo-archive');expect(queries[0].table).toBe('argentina_customers');expect(queries[0].calls).toContainEqual(['range',50,99]);expect(queries[0].calls).toContainEqual(['ilike','search_text','%50\\%\\_%']);
 });
 it("keeps unique original codes instead of inventing replacements",()=>{expect(internalCatalogSku(' AR-ONE ','6',new Map([['ar-one',1]]))).toBe('AR-ONE');});
});
