import {NextResponse} from "next/server";
import {getDB} from "@/lib/db";
import {actorActual} from "@/lib/identidad";
import {wooStoreId} from "@/lib/woo-server";
import {italiaFinanceAccess} from "@/lib/elogy-server";
import {financeInput} from "@/lib/italia-finance-input";
export const dynamic="force-dynamic";
export async function POST(req:Request){
 if(!italiaFinanceAccess())return NextResponse.json({error:"Se requiere acceso de finanzas de Italia"},{status:403});
 if(req.headers.get("origin")!==new URL(req.url).origin)return NextResponse.json({error:"Origen inválido"},{status:403});
 const input=financeInput(await req.json().catch(()=>null));if(!input)return NextResponse.json({error:"Revisa los campos, fechas e importes"},{status:400});
 try{
  const r=await getDB().rpc("italia_finance_mutate",{p_store:await wooStoreId(),p_action:input.action,p_body:input.body,p_request:input.requestId,p_actor:actorActual()});
  if(r.error)throw Error();
  if(r.data.error)return NextResponse.json({error:r.data.error==="reference_exists"?"Esta referencia de liquidación ya está registrada":"El registro cambió. Actualiza antes de guardar."},{status:409});
  return NextResponse.json({ok:true,duplicate:Boolean(r.data.duplicate)});
 }catch{return NextResponse.json({error:"No se pudo guardar el registro financiero"},{status:503});}
}
