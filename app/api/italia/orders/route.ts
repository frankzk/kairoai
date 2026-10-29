import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { wooAccess, wooStoreId } from "@/lib/woo-server";
import { ITALIA_STATUS, mapItaliaOrder } from "@/lib/italia-orders";
import { ITALIA_RECONCILED_STATES, italiaDateRange } from "@/lib/italia-filters";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!wooAccess()) return NextResponse.json({error:"Sin acceso a Kenku Italia"},{status:403});
  const p=req.nextUrl.searchParams,page=Math.max(1,Math.min(100000,Math.floor(Number(p.get("page"))||1)));
  const source=p.get("source")||"all",status=p.get("status")||"",search=(p.get("search")||"").trim().slice(0,100);
  const reconciliation=p.get("reconciliation")||"all";
  if(!["all","matched","review","unmatched","ambiguous","unknown"].includes(reconciliation))return NextResponse.json({error:"Conciliación inválida"},{status:400});
  if(!["all","shopify","woocommerce"].includes(source) || status&&!Object.prototype.hasOwnProperty.call(ITALIA_STATUS,status)) return NextResponse.json({error:"Filtro inválido"},{status:400});
  let dates: ReturnType<typeof italiaDateRange>;
  try {dates=italiaDateRange(p.get("period")||"all",p.get("from")||"",p.get("to")||"");}
  catch {return NextResponse.json({error:"Elige un periodo o rango de fechas válido"},{status:400});}
  try {
    const db=getDB(),store=await wooStoreId();
    // Counts never fetch customer payloads and use the same source/search/date scope.
    const scoped=<Columns extends string>(columns:Columns,head=false)=>{
      let q=db.from("italia_orders_reconciled").select(columns,{count:"exact",head}).eq("store_id",store);
      if(reconciliation!=="all")q=q.eq("reconciliation_state",reconciliation);
      if(source!=="all")q=q.eq("source",source);
      if(search)q=q.ilike("search_text",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
      if(dates)q=q.gte("created_at",dates.from).lt("created_at",dates.to);
      return q;
    };
    let query=scoped("source,source_id,order_number,created_at,payload,status,version,synced_version,last_error,management_note,courier,tracking_number,managed_at,source_updated_at,base_status,reconciliation_state,reconciliation")
      .order("created_at",{ascending:false}).order("source").order("source_id",{ascending:false}).range((page-1)*50,page*50-1);
    if(status)query=query.eq("status",status);
    const [orders,sync,counts,elogy]=await Promise.all([
      query,
      db.from("shopify_archivo_estado").select("actualizado_at,completo,ultimo_error").eq("store_id",store).eq("recurso","order").maybeSingle(),
      p.get("summary")==="1" ? db.rpc("italia_reconciled_counts",{
        p_store:store,p_source:source,p_search:search?`%${search.replace(/[\\%_]/g,"\\$&")}%`:"",
        p_from:dates?.from??null,p_to:dates?.to??null,p_reconciliation:reconciliation,
      }).then(({data,error}:{data:Record<string,unknown>|null;error:unknown})=>{
        if(error||!data||typeof data!=="object"||Array.isArray(data))throw Error("count failed");
        return Object.fromEntries(ITALIA_RECONCILED_STATES.map(state=>{
          const value=data[state]??0;if(!Number.isSafeInteger(value)||Number(value)<0)throw Error("count invalid");
          return [state,Number(value)];
        }));
      }) : null,
      db.from("italia_elogy_sync").select("last_ok_at,completed_at,last_error").eq("store_id",store).eq("resource","shipments").maybeSingle(),
    ]);
    if(orders.error||sync.error||elogy.error)throw Error("read failed");
    return NextResponse.json({orders:(orders.data||[]).map(mapItaliaOrder),count:orders.count,page,counts,shopifySync:sync.data?{updatedAt:sync.data.actualizado_at,complete:sync.data.completo,error:Boolean(sync.data.ultimo_error)}:null,elogySync:elogy.data?{updatedAt:elogy.data.last_ok_at,completedAt:elogy.data.completed_at,error:Boolean(elogy.data.last_error)}:null},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"No se pudieron cargar los pedidos de Italia"},{status:503});}
}
