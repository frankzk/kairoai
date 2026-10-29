import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {ITALIA_RECONCILED_STATES} from "@/lib/italia-filters";
const {access,queries,db}=vi.hoisted(()=>{
  const queries:Array<{table:string;calls:Array<[string,...unknown[]]>}>=[];
  const db={from:vi.fn(),rpc:vi.fn()};return {access:vi.fn(),queries,db};
});
vi.mock("@/lib/db",()=>({getDB:()=>db}));
vi.mock("@/lib/woo-server",()=>({wooAccess:access,wooStoreId:async()=>5}));
import {GET} from "../app/api/italia/orders/route";
const request=(query="")=>new NextRequest(`https://app.test/api/italia/orders?${query}`);

describe("Lista y contadores Italia",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();queries.length=0;access.mockReturnValue(true);
    db.rpc.mockResolvedValue({data:Object.fromEntries(ITALIA_RECONCILED_STATES.map(s=>[s,100])),error:null});
    db.from.mockImplementation((table:string)=>{
      const record={table,calls:[] as Array<[string,...unknown[]]>};queries.push(record);
      const builder:Record<string,unknown>={};
      for(const method of ["select","eq","ilike","gte","lt","order","range","maybeSingle"]){builder[method]=(...args:unknown[])=>{record.calls.push([method,...args]);return builder;};}
      builder.then=(resolve:(result:unknown)=>unknown)=>{
        const head=(record.calls.find(c=>c[0]==="select")?.[2] as {head?:boolean})?.head;
        return Promise.resolve({data:table==="shopify_archivo_estado"?null:[],count:head?100:2,error:null}).then(resolve);
      };
      return builder;
    });
  });
  it("rejects access, invalid sources and invalid dates before any database read",async()=>{
    access.mockReturnValue(false);expect((await GET(request("summary=1"))).status).toBe(403);access.mockReturnValue(true);
    for(const q of ["source=other","status=paid","reconciliation=forged","period=bad","period=range&from=2026-02-30&to=2026-03-01"])expect((await GET(request(q))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("counts the full filtered scope without fetching payloads or applying the selected status to other counters",async()=>{
    const response=await GET(request("page=2&source=shopify&status=pending&search=50%25_&period=range&from=2026-10-25&to=2026-10-25&summary=1&store_id=1"));
    expect(response.status).toBe(200);const result=await response.json();expect(Object.values(result.counts)).toEqual(ITALIA_RECONCILED_STATES.map(()=>100));expect(result.count).toBe(2);
    const orders=queries.filter(q=>q.table==="italia_orders_reconciled");expect(orders).toHaveLength(1);
    for(const q of orders){expect(q.calls).toContainEqual(["eq","store_id",5]);expect(q.calls).toContainEqual(["eq","source","shopify"]);expect(q.calls).toContainEqual(["ilike","search_text","%50\\%\\_%"]);expect(q.calls).toContainEqual(["gte","created_at","2026-10-24T22:00:00.000Z"]);expect(q.calls).toContainEqual(["lt","created_at","2026-10-25T23:00:00.000Z"]);}
    expect(orders[0].calls).toContainEqual(["range",50,99]);
    expect(db.rpc).toHaveBeenCalledWith("italia_reconciled_counts",{p_store:5,p_source:"shopify",p_search:"%50\\%\\_%",p_from:"2026-10-24T22:00:00.000Z",p_to:"2026-10-25T23:00:00.000Z",p_reconciliation:"all"});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not repeat count queries on paging unless explicitly requested",async()=>{
    const result=await (await GET(request("page=3&source=woocommerce"))).json();expect(result.counts).toBeNull();expect(queries.filter(q=>q.table==="italia_orders_reconciled")).toHaveLength(1);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("does not present a failed count as zero",async()=>{
    db.from.mockImplementation(()=>{throw Error("down");});const response=await GET(request("summary=1"));expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty("counts");
  });
  it("keeps reconciliation in the list and every count scope, including guide searches",async()=>{
    expect((await GET(request("summary=1&reconciliation=review&search=R123"))).status).toBe(200);
    const rows=queries.filter(q=>q.table==="italia_orders_reconciled");expect(rows).toHaveLength(1);
    for(const q of rows){expect(q.calls).toContainEqual(["eq","store_id",5]);expect(q.calls).toContainEqual(["eq","reconciliation_state","review"]);expect(q.calls).toContainEqual(["ilike","search_text","%R123%"]);}
    expect(queries.some(q=>q.table==="italia_elogy_sync")).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("italia_reconciled_counts",expect.objectContaining({p_store:5,p_source:"all",p_reconciliation:"review",p_search:"%R123%"}));
  });
  it("reports broken count reads as errors and fills genuinely absent groups with zero",async()=>{
    db.rpc.mockResolvedValueOnce({error:{message:"down"},data:null});expect((await GET(request("summary=1"))).status).toBe(503);
    db.rpc.mockResolvedValueOnce({error:null,data:{pending:3}});const result=await(await GET(request("summary=1"))).json();expect(result.counts.pending).toBe(3);expect(result.counts.delivered).toBe(0);
  });
});
