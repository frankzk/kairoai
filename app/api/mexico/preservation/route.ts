import {NextResponse} from "next/server";
import {identidadActual} from "@/lib/identidad";
import {getDB} from "@/lib/db";
import {runPreservation} from "@/lib/shopify-preservation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
function allowed(){const who=identidadActual();return Boolean(who&&(who.id===0||who.tiendas.includes("kenku-mx"))&&who.permisos.includes("config"));}
export async function POST(req:Request){
  if(!allowed())return NextResponse.json({error:"Sin acceso"},{status:403});
  if(req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"Origen inválido"},{status:403});
  const body=await req.json().catch(()=>null);
  if(!body||typeof body.resource!=="string"||!/^[a-z][a-z0-9_-]{0,90}$/.test(body.resource))return NextResponse.json({error:"Recurso inválido"},{status:400});
  try{return NextResponse.json(await runPreservation(body.resource),{headers:{"Cache-Control":"no-store"}});}catch{return NextResponse.json({error:"No se pudo ejecutar el extractor"},{status:503});}
}
export async function GET(){
  if(!allowed())return NextResponse.json({error:"Sin acceso"},{status:403});
  const r=await getDB().from("shopify_preservation_records").select("record_id,payload").eq("store_id",3).eq("resource","_job").order("record_id");
  if(r.error)return NextResponse.json({error:"No se pudo leer el estado"},{status:503});
  return NextResponse.json({jobs:(r.data||[]).map(r=>({resource:r.record_id,state:r.payload.state,count:r.payload.count,lines:r.payload.lines,roots:r.payload.rootObjectCount,error:r.payload.error}))},{headers:{"Cache-Control":"no-store"}});
}
