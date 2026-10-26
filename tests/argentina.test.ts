import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { argentinaDateRange } from "@/lib/argentina-filters";
import { ACCESS_STORES } from "@/lib/access-stores";
import { FINANCE_STORES } from "@/lib/store-config";
const { identity, queries, rpc, from } = vi.hoisted(() => ({
  identity:vi.fn(), queries:[] as Array<{table:string;calls:Array<[string,...unknown[]]>}>, rpc:vi.fn(), from:vi.fn(),
}));
vi.mock("@/lib/identidad",()=>({identidadActual:identity,actorActual:()=>"Operador autenticado"}));
vi.mock("@/lib/db",()=>({getDB:()=>({from,rpc})}));
import { argentinaAccess } from "@/lib/argentina-server";
import { GET as list } from "../app/api/argentina/orders/route";
import { GET as history, POST as manage } from "../app/api/argentina/shopify/[id]/route";
const req=(query="")=>new NextRequest(`https://app.test/api/argentina/orders?${query}`);
const value={status:"confirmed",version:0,sourceUpdatedAt:null,note:"Revisado",courier:"Courier de prueba",tracking:"QA",requestId:"12345678-1234-1234-1234-123456789012",store_id:5,actor:"spoof"};
const post=(origin="https://app.test",body:unknown=value)=>new Request("https://app.test/api/argentina/shopify/123",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});

describe("Gestión Kenku Argentina",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();queries.length=0;
    identity.mockReturnValue({id:2,tiendas:["kenku-ar"],permisos:["pedidos"]});
    rpc.mockResolvedValue({data:{ok:true,version:1},error:null});
    from.mockImplementation((table:string)=>{
      const record={table,calls:[] as Array<[string,...unknown[]]>};queries.push(record);
      const builder:Record<string,unknown>={};
      for(const method of ["select","eq","ilike","gte","lt","order","range","maybeSingle","single","limit"])
        builder[method]=(...args:unknown[])=>{record.calls.push([method,...args]);return builder;};
      builder.then=(resolve:(r:unknown)=>unknown)=>Promise.resolve({data:table==="stores"?{id:4}:table==="shopify_archivo_estado"?null:[],count:table==="argentina_orders"?10:null,error:null}).then(resolve);
      return builder;
    });
  });
  it("requires Argentina and operation permission, including page/API guards",async()=>{
    for(const who of [null,{id:1,tiendas:["kenku-it"],permisos:["pedidos"]},{id:2,tiendas:["kenku-ar"],permisos:["leads"]}]) {
      identity.mockReturnValue(who);expect(argentinaAccess()).toBe(false);
      expect((await list(req())).status).toBe(403);
      expect((await history(post(),{params:{id:"123"}})).status).toBe(403);
      expect((await manage(post(),{params:{id:"123"}})).status).toBe(403);
    }
    expect(from).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
    identity.mockReturnValue({id:0,tiendas:[],permisos:["pedidos"]});expect(argentinaAccess()).toBe(true);
    identity.mockReturnValue({id:2,tiendas:["kenku-ar"],permisos:["finanzas"]});expect(argentinaAccess()).toBe(true);
  });
  it("rejects unsupported sources, status and invalid date ranges before reading data",async()=>{
    for(const q of ["source=woocommerce","source=italia","status=paid","period=bad","period=range&from=2026-02-30&to=2026-03-01"])expect((await list(req(q))).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
  it("scopes rows, counts and sync to Argentina; paginates and uses local date boundaries",async()=>{
    const response=await list(req("summary=1&page=2&source=shopify&status=pending&search=50%25_&period=range&from=2026-10-25&to=2026-10-25&store_id=5"));
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    const data=await response.json();expect(data.count).toBe(10);expect(Object.keys(data.counts)).toHaveLength(8);
    const orders=queries.filter(q=>q.table==="argentina_orders");expect(orders).toHaveLength(9);
    for(const q of orders){
      expect(q.calls).toContainEqual(["eq","store_id",4]);expect(q.calls).toContainEqual(["eq","source","shopify"]);
      expect(q.calls).toContainEqual(["gte","created_at","2026-10-25T03:00:00.000Z"]);expect(q.calls).toContainEqual(["lt","created_at","2026-10-26T03:00:00.000Z"]);
      expect(q.calls).toContainEqual(["ilike","search_text","%50\\%\\_%"]);
    }
    expect(orders[0].calls).toContainEqual(["range",50,99]);
    for(const q of orders.slice(1)){expect(q.calls[0]).toEqual(["select","source_id",{count:"exact",head:true}]);expect(q.calls.some(c=>c[0]==="range")).toBe(false);}
    expect(queries.find(q=>q.table==="shopify_archivo_estado")?.calls).toContainEqual(["eq","store_id",4]);
    expect(queries.find(q=>q.table==="stores")?.calls).toContainEqual(["eq","code","kenku-ar"]);
    expect(queries.find(q=>q.table==="stores")?.calls).toContainEqual(["eq","active",true]);
  });
  it("uses authenticated actor/store for writes and never sends changes to Shopify",async()=>{
    const network=vi.spyOn(globalThis,"fetch");
    expect((await manage(post(),{params:{id:"123"}})).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("argentina_manage_shopify",expect.objectContaining({p_store:4,p_id:"123",p_actor:"Operador autenticado",p_expected:0}));
    expect(network).not.toHaveBeenCalled();network.mockRestore();
    expect((await history(post(),{params:{id:"123"}})).status).toBe(200);
    expect(queries.find(q=>q.table==="argentina_shopify_events")?.calls).toContainEqual(["eq","store_id",4]);
  });
  it("rejects CSRF, invalid ids and missing revision before persisting",async()=>{
    expect((await manage(post("https://other.test"),{params:{id:"123"}})).status).toBe(403);
    expect((await manage(post(),{params:{id:"0"}})).status).toBe(400);
    expect((await manage(post("https://app.test",{...value,version:undefined}),{params:{id:"123"}})).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
  });
  it("reports failed persistence, missing order and stale changes",async()=>{
    rpc.mockResolvedValue({data:{error:"conflict"},error:null});expect((await manage(post(),{params:{id:"123"}})).status).toBe(409);
    rpc.mockResolvedValue({data:{error:"not_found"},error:null});expect((await manage(post(),{params:{id:"123"}})).status).toBe(404);
    rpc.mockResolvedValue({data:null,error:{message:"private error"}});expect((await manage(post(),{params:{id:"123"}})).status).toBe(503);
    from.mockImplementation(()=>{throw Error("database down");});expect((await list(req("summary=1"))).status).toBe(503);
  });
  it("exposes Argentina in access administration without running legacy couriers for it",()=>{
    expect(ACCESS_STORES.filter(s=>s.code==="kenku-ar")).toHaveLength(1);
    expect(FINANCE_STORES.map(s=>s.code)).toEqual(["mireva-cr","mireva-hn"]);
  });
  it("uses Buenos Aires days",()=>{
    expect(argentinaDateRange("today","","",new Date("2026-10-26T01:30:00Z"))).toEqual({from:"2026-10-25T03:00:00.000Z",to:"2026-10-26T03:00:00.000Z"});
    expect(argentinaDateRange("month","","",new Date("2026-10-26T12:00:00Z"))).toEqual({from:"2026-10-01T03:00:00.000Z",to:"2026-10-27T03:00:00.000Z"});
    expect(argentinaDateRange("all")).toBeNull();
  });
});
