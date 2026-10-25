import {beforeEach,describe,it,expect,vi} from "vitest";
const {rpc,access}=vi.hoisted(()=>({rpc:vi.fn(),access:vi.fn()}));
vi.mock("@/lib/db",()=>({getDB:()=>({rpc})}));
vi.mock("@/lib/woo-server",()=>({wooAccess:access,wooStoreId:async()=>5}));
vi.mock("@/lib/identidad",()=>({actorActual:()=>"Authenticated operator"}));
import {POST} from "../app/api/italia/shopify/[id]/route";
const body={status:"confirmed",version:0,sourceUpdatedAt:null,note:"Test",courier:"BRT",tracking:"TEST",requestId:"12345678-1234-1234-1234-123456789012",actor:"spoof",store_id:1};
const req=(origin="https://app.example",value:unknown=body)=>new Request("https://app.example/api/italia/shopify/123",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(value)});
describe("Shopify Italy management route",()=>{
 beforeEach(()=>{vi.clearAllMocks();access.mockReturnValue(true);rpc.mockResolvedValue({data:{ok:true,version:1},error:null});});
 it("fails closed for other stores and missing identity",async()=>{access.mockReturnValue(false);expect((await POST(req(),{params:{id:"123"}})).status).toBe(403);expect(rpc).not.toHaveBeenCalled();});
 it("rejects CSRF, malformed id and missing concurrency before touching data",async()=>{
  expect((await POST(req("https://wrong.example"),{params:{id:"123"}})).status).toBe(403);
  expect((await POST(req(),{params:{id:"0"}})).status).toBe(400);
  expect((await POST(req("https://app.example",{...body,version:undefined}),{params:{id:"123"}})).status).toBe(400);expect(rpc).not.toHaveBeenCalled();
 });
 it("scopes the store and actor server-side and never calls Shopify or Woo",async()=>{
  const network=vi.spyOn(globalThis,"fetch");const response=await POST(req(),{params:{id:"123"}});
  expect(response.status).toBe(200);expect(rpc.mock.calls[0][1]).toMatchObject({p_store:5,p_actor:"Authenticated operator",p_id:"123"});expect(network).not.toHaveBeenCalled();network.mockRestore();
 });
 it("returns conflicts and write failures without claiming success",async()=>{
  rpc.mockResolvedValue({data:{error:"conflict"},error:null});expect((await POST(req(),{params:{id:"123"}})).status).toBe(409);
  rpc.mockResolvedValue({data:{error:"not_found"},error:null});expect((await POST(req(),{params:{id:"123"}})).status).toBe(404);
  rpc.mockResolvedValue({error:{message:"down"}});expect((await POST(req(),{params:{id:"123"}})).status).toBe(503);
 });
});
