import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const {access,finance,read,period,sync,rpc,log}=vi.hoisted(()=>({access:vi.fn(),finance:vi.fn(),read:vi.fn(),period:vi.fn(),sync:vi.fn(),rpc:vi.fn(),log:vi.fn()}));
vi.mock("@/lib/woo-server",()=>({wooAccess:access,wooStoreId:async()=>5}));
vi.mock("@/lib/elogy-server",()=>({italiaFinanceAccess:finance,readElogyWorkspace:read,elogyPeriod:period,syncElogy:sync}));
vi.mock("@/lib/db",()=>({getDB:()=>({rpc})}));
vi.mock("@/lib/identidad",()=>({actorActual:()=>"Italy operator"}));
vi.mock("@/lib/cron-runs",()=>({withCronRun:(_name:string,fn:()=>Promise<Response>)=>()=>{log();return fn();}}));
import {GET} from "../app/api/italia/elogy/route";
import {POST as save} from "../app/api/italia/finance/route";
import {POST as refresh} from "../app/api/italia/elogy/sync/route";
import {GET as cron} from "../app/api/cron/elogy/route";
const origin="https://app.example";
const body={action:"expense",type:"ads",description:"Publicidad",date:"2026-10-01",amount:"25.00",requestId:"12345678-1234-1234-1234-123456789012",store_id:1,actor:"spoof",currency:"USD"};
const post=(value:unknown=body,from=origin)=>new Request(origin+"/api/italia/finance",{method:"POST",headers:{Origin:from,"Content-Type":"application/json"},body:JSON.stringify(value)});
describe("Elogy Italy API boundaries",()=>{
 beforeEach(()=>{vi.clearAllMocks();access.mockReturnValue(true);finance.mockReturnValue(true);period.mockReturnValue(null);read.mockResolvedValue({finance:true});rpc.mockResolvedValue({data:{ok:true}});sync.mockResolvedValue({orders:{complete:true}});vi.stubEnv("WOO_KENKU_IT_SYNC_SECRET","dedicated-italy");});
 it("blocks unauthorized reads, syncs and writes before touching data",async()=>{
  access.mockReturnValue(false);finance.mockReturnValue(false);
  expect((await GET(new NextRequest(origin+"/api/italia/elogy"))).status).toBe(403);
  expect((await refresh(post())).status).toBe(403);expect((await save(post())).status).toBe(403);
  expect(read).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it("passes operation-only reads to the restricted DTO and validates period",async()=>{
  finance.mockReturnValue(false);const response=await GET(new NextRequest(origin+"/api/italia/elogy?period=all"));
  expect(response.headers.get("cache-control")).toBe("no-store");expect(read.mock.calls[0][1]).toBe(false);
  period.mockImplementation(()=>{throw Error();});expect((await GET(new NextRequest(origin+"/api/italia/elogy?period=bad"))).status).toBe(400);
 });
 it("rejects CSRF and malformed money before financial writes",async()=>{
  expect((await save(post(body,"https://evil.example"))).status).toBe(403);
  expect((await refresh(post({},"https://evil.example"))).status).toBe(403);
  expect((await save(post({...body,amount:"-1"}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
 });
 it("binds store, actor and EUR amounts server-side, preserves idempotency and conflicts",async()=>{
  expect((await save(post())).status).toBe(200);
  expect(rpc.mock.calls[0][1]).toMatchObject({p_store:5,p_actor:"Italy operator",p_action:"expense",p_body:{amount_cents:2500}});
  expect(rpc.mock.calls[0][1].p_body).not.toHaveProperty("store_id");expect(rpc.mock.calls[0][1].p_body).not.toHaveProperty("currency");
  rpc.mockResolvedValue({data:{duplicate:true}});expect((await (await save(post())).json()).duplicate).toBe(true);
  rpc.mockResolvedValue({data:{error:"conflict"}});expect((await save(post())).status).toBe(409);
  rpc.mockResolvedValue({error:{message:"private database failure"}});const r=await save(post());expect(r.status).toBe(503);expect(await r.text()).not.toContain("private database");
 });
 it("cron rejects unrelated tokens and absent config before creating a run",async()=>{
  access.mockReturnValue(false);vi.stubEnv("CRON_SECRET","other-store-secret");
  expect((await cron(new NextRequest(origin+"/api/cron/elogy",{headers:{Authorization:"Bearer other-store-secret"}}))).status).toBe(401);
  vi.stubEnv("WOO_KENKU_IT_SYNC_SECRET","");expect((await cron(new NextRequest(origin+"/api/cron/elogy"))).status).toBe(401);expect(log).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
 });
 it("scoped worker sync is resumable and partial errors mark health unhealthy",async()=>{
  access.mockReturnValue(false);const req=new NextRequest(origin+"/api/cron/elogy",{headers:{Authorization:"Bearer dedicated-italy"}});
  expect((await cron(req)).status).toBe(200);expect(sync).toHaveBeenCalledWith(10);
  sync.mockResolvedValue({costs:{error:"unauthorized"}});expect((await cron(req)).status).toBe(503);
 });
});
