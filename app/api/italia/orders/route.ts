import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { wooAccess, wooStoreId } from "@/lib/woo-server";
import { ITALIA_STATUS, mapItaliaOrder } from "@/lib/italia-orders";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest) {
  if(!wooAccess()) return NextResponse.json({error:"Sin acceso a Kenku Italia"},{status:403});
  const p=req.nextUrl.searchParams,page=Math.max(1,Math.min(100000,Math.floor(Number(p.get("page"))||1)));
  const source=p.get("source")||"all",status=p.get("status")||"",search=(p.get("search")||"").trim().slice(0,100);
  if(!["all","shopify","woocommerce"].includes(source) || status&&!Object.prototype.hasOwnProperty.call(ITALIA_STATUS,status)) return NextResponse.json({error:"Filtro inválido"},{status:400});
  try {
    const db=getDB(),store=await wooStoreId();
    let query=db.from("italia_orders").select("source,source_id,order_number,created_at,payload,status,version,synced_version,last_error,management_note,courier,tracking_number,managed_at,source_updated_at",{count:"exact"})
      .eq("store_id",store).order("created_at",{ascending:false}).order("source").order("source_id",{ascending:false}).range((page-1)*50,page*50-1);
    if(source!=="all")query=query.eq("source",source);
    if(status)query=query.eq("status",status);
    if(search)query=query.ilike("search_text",`%${search.replace(/[\\%_]/g,"\\$&")}%`);
    const [orders,sync]=await Promise.all([
      query,
      db.from("shopify_archivo_estado").select("actualizado_at,completo,ultimo_error").eq("store_id",store).eq("recurso","order").maybeSingle(),
    ]);
    if(orders.error||sync.error)throw Error("read failed");
    return NextResponse.json({orders:(orders.data||[]).map(mapItaliaOrder),count:orders.count,page,shopifySync:sync.data?{updatedAt:sync.data.actualizado_at,complete:sync.data.completo,error:Boolean(sync.data.ultimo_error)}:null},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"No se pudieron cargar los pedidos de Italia"},{status:503});}
}
