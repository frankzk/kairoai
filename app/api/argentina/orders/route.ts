import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { argentinaAccess, argentinaStoreId } from "@/lib/argentina-server";
import { ITALIA_STATUS, mapItaliaOrder } from "@/lib/italia-orders";
import { ITALIA_STATES } from "@/lib/italia-filters";
import { argentinaDateRange } from "@/lib/argentina-filters";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!argentinaAccess()) return NextResponse.json({error:"Sin acceso a Kenku Argentina"},{status:403});
  const p=req.nextUrl.searchParams,page=Math.max(1,Math.min(100000,Math.floor(Number(p.get("page"))||1)));
  const source=p.get("source")||"all",status=p.get("status")||"",search=(p.get("search")||"").trim().slice(0,100);
  if(!["all","shopify"].includes(source) || status&&!Object.prototype.hasOwnProperty.call(ITALIA_STATUS,status)) return NextResponse.json({error:"Filtro inválido"},{status:400});
  let dates: ReturnType<typeof argentinaDateRange>;
  try {dates=argentinaDateRange(p.get("period")||"all",p.get("from")||"",p.get("to")||"");}
  catch {return NextResponse.json({error:"Elige un periodo o rango de fechas válido"},{status:400});}
  try {
    const db=getDB(),store=await argentinaStoreId();
    // Counts never fetch customer payloads and use the same source/search/date scope.
    const scoped=<Columns extends string>(columns:Columns,head=false)=>{
      let q=db.from("argentina_orders").select(columns,{count:"exact",head}).eq("store_id",store);
      if(source!=="all")q=q.eq("source",source);
      if(search)q=q.ilike("search_text",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
      if(dates)q=q.gte("created_at",dates.from).lt("created_at",dates.to);
      return q;
    };
    let query=scoped("source,source_id,order_number,created_at,payload,status,version,synced_version,last_error,management_note,courier,tracking_number,managed_at,source_updated_at")
      .order("created_at",{ascending:false}).order("source").order("source_id",{ascending:false}).range((page-1)*50,page*50-1);
    if(status)query=query.eq("status",status);
    const [orders,sync,counts]=await Promise.all([
      query,
      db.from("shopify_archivo_estado").select("actualizado_at,completo,ultimo_error").eq("store_id",store).eq("recurso","order").maybeSingle(),
      p.get("summary")==="1" ? Promise.all(ITALIA_STATES.map(async state=>{
        const result=await scoped("source_id",true).eq("status",state);
        if(result.error||result.count===null)throw Error("count failed");
        return [state,result.count] as const;
      })).then(Object.fromEntries) : null,
    ]);
    if(orders.error||sync.error)throw Error("read failed");
    return NextResponse.json({orders:(orders.data||[]).map(mapItaliaOrder),count:orders.count,page,counts,shopifySync:sync.data?{updatedAt:sync.data.actualizado_at,complete:sync.data.completo,error:Boolean(sync.data.ultimo_error)}:null},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"No se pudieron cargar los pedidos de Argentina"},{status:503});}
}
