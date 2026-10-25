import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { actorActual } from "@/lib/identidad";
import { wooAccess,wooStoreId } from "@/lib/woo-server";
import { validManagementBody } from "@/lib/italia-orders";
export const dynamic="force-dynamic";
type Context={params:{id:string}};
export async function POST(req:Request,{params}:Context) {
  if(!wooAccess())return NextResponse.json({error:"Sin acceso a Kenku Italia"},{status:403});
  if(req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"Origen inválido"},{status:403});
  const body=await req.json().catch(()=>null);
  if(!/^[1-9]\d{0,19}$/.test(params.id)||!validManagementBody(body))return NextResponse.json({error:"Datos inválidos"},{status:400});
  try{
    const {data,error}=await getDB().rpc("italia_manage_shopify",{p_store:await wooStoreId(),p_id:params.id,p_expected:body.version,p_source_updated:body.sourceUpdatedAt,p_status:body.status,p_note:body.note,p_courier:body.courier,p_tracking:body.tracking,p_request:body.requestId,p_actor:actorActual()});
    if(error)throw Error("write failed");
    if(data.error)return NextResponse.json({error:data.error==="not_found"?"Pedido no encontrado":"El pedido cambió. Actualiza la lista antes de guardar."},{status:data.error==="not_found"?404:409});
    return NextResponse.json({ok:true,version:data.version,duplicate:Boolean(data.duplicate)});
  }catch{return NextResponse.json({error:"No se pudo guardar la gestión"},{status:503});}
}
export async function GET(_req:Request,{params}:Context) {
  if(!wooAccess())return NextResponse.json({error:"Sin acceso a Kenku Italia"},{status:403});
  if(!/^[1-9]\d{0,19}$/.test(params.id))return NextResponse.json({error:"ID inválido"},{status:400});
  try{
    const {data,error}=await getDB().from("italia_shopify_events").select("id,version,actor,before_state,after_state,created_at").eq("store_id",await wooStoreId()).eq("shopify_id",params.id).order("version",{ascending:false}).limit(30);
    if(error)throw Error("read failed");
    return NextResponse.json({events:data},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"No se pudo cargar el historial"},{status:503});}
}
