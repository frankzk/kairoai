import {beforeEach,describe,it,expect,vi} from "vitest";
const {rpc,access}=vi.hoisted(()=>({rpc:vi.fn(),access:vi.fn()}));
vi.mock("@/lib/db",()=>({getDB:()=>({rpc})}));vi.mock("@/lib/elogy-server",()=>({italiaFinanceAccess:access}));vi.mock("@/lib/woo-server",()=>({wooStoreId:async()=>5}));vi.mock("@/lib/identidad",()=>({actorActual:()=>"Authorized operator"}));
import {POST} from "../app/api/italia/reconciliation/route";
import {GET} from "../app/api/italia/reconciliation/candidates/route";
import {NextRequest} from "next/server";
const body={action:"close",requestId:"12345678-1234-1234-1234-123456789012",payout_id:1,version:2,store_id:1,actor:"spoof"};
const request=(b:unknown=body,origin="https://app.example")=>new Request("https://app.example/api/italia/reconciliation",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(b)});
describe("Reconciliation write boundary",()=>{
 beforeEach(()=>{vi.clearAllMocks();access.mockReturnValue(true);rpc.mockResolvedValue({data:{ok:true}});});
 it("rejects other stores/non-finance operators and CSRF before calling the database",async()=>{access.mockReturnValue(false);expect((await POST(request())).status).toBe(403);access.mockReturnValue(true);expect((await POST(request(body,"https://evil.example"))).status).toBe(403);expect(rpc).not.toHaveBeenCalled();});
 it("binds store and actor server-side and sends only validated fields",async()=>{expect((await POST(request())).status).toBe(200);expect(rpc.mock.calls[0]).toEqual(["italia_elogy_reconcile",{p_store:5,p_action:"close",p_body:{payout_id:1,version:2},p_request:body.requestId,p_actor:"Authorized operator"}]);});
 it("keeps retries idempotent and surfaces concurrency, over-allocation and incomplete statements",async()=>{rpc.mockResolvedValue({data:{duplicate:true}});expect((await (await POST(request())).json()).duplicate).toBe(true);for(const error of ["conflict","bank_overallocated","detail_difference","source_assigned","bank_difference"]){rpc.mockResolvedValue({data:{error}});expect((await POST(request())).status).toBe(409);}});
 it("rejects malformed inputs and hides private database errors",async()=>{expect((await POST(request({...body,version:undefined}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();rpc.mockResolvedValue({error:{message:"private bank content"}});const r=await POST(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain("private bank");});
 it("limits source browsing to finance, validates filters and binds pagination to Italy",async()=>{
  access.mockReturnValue(false);expect((await GET(new NextRequest("https://app.example/api/italia/reconciliation/candidates"))).status).toBe(403);access.mockReturnValue(true);
  expect((await GET(new NextRequest("https://app.example/api/italia/reconciliation/candidates?resource=bank"))).status).toBe(400);
  rpc.mockResolvedValue({data:{rows:[],count:0}});const r=await GET(new NextRequest("https://app.example/api/italia/reconciliation/candidates?resource=costs&page=2&search=%23KITA1"));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect(rpc).toHaveBeenCalledWith("italia_elogy_candidates",{p_store:5,p_resource:"costs",p_page:2,p_search:"KITA1"});
 });
});
