import {beforeEach,describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
import {ITALIA_STATES} from "@/lib/italia-filters";
const {access,queries,db}=vi.hoisted(()=>{
  const queries:Array<{table:string;calls:Array<[string,...unknown[]]>}>=[];
  const db={from:vi.fn()};return {access:vi.fn(),queries,db};
});
vi.mock("@/lib/db",()=>({getDB:()=>db}));
vi.mock("@/lib/woo-server",()=>({wooAccess:access,wooStoreId:async()=>5}));
import {GET} from "../app/api/italia/orders/route";
const request=(query="")=>new NextRequest(`https://app.test/api/italia/orders?${query}`);

describe("Lista y contadores Italia",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();queries.length=0;access.mockReturnValue(true);
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
    for(const q of ["source=other","status=paid","period=bad","period=range&from=2026-02-30&to=2026-03-01"])expect((await GET(request(q))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("counts the full filtered scope without fetching payloads or applying the selected status to other counters",async()=>{
    const response=await GET(request("page=2&source=shopify&status=pending&search=50%25_&period=range&from=2026-10-25&to=2026-10-25&summary=1&store_id=1"));
    expect(response.status).toBe(200);const result=await response.json();expect(Object.values(result.counts)).toEqual(ITALIA_STATES.map(()=>100));expect(result.count).toBe(2);
    const orders=queries.filter(q=>q.table==="italia_orders");expect(orders).toHaveLength(1+ITALIA_STATES.length);
    for(const q of orders){expect(q.calls).toContainEqual(["eq","store_id",5]);expect(q.calls).toContainEqual(["eq","source","shopify"]);expect(q.calls).toContainEqual(["ilike","search_text","%50\\%\\_%"]);expect(q.calls).toContainEqual(["gte","created_at","2026-10-24T22:00:00.000Z"]);expect(q.calls).toContainEqual(["lt","created_at","2026-10-25T23:00:00.000Z"]);}
    expect(orders[0].calls).toContainEqual(["range",50,99]);
    orders.slice(1).forEach((q,i)=>{expect(q.calls[0]).toEqual(["select","source_id",{count:"exact",head:true}]);expect(q.calls.filter(c=>c[0]==="eq"&&c[1]==="status")).toEqual([["eq","status",ITALIA_STATES[i]]]);expect(q.calls.some(c=>c[0]==="range")).toBe(false);});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not repeat count queries on paging unless explicitly requested",async()=>{
    const result=await (await GET(request("page=3&source=woocommerce"))).json();expect(result.counts).toBeNull();expect(queries.filter(q=>q.table==="italia_orders")).toHaveLength(1);
  });
  it("does not present a failed count as zero",async()=>{
    db.from.mockImplementation(()=>{throw Error("down");});const response=await GET(request("summary=1"));expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty("counts");
  });
});
