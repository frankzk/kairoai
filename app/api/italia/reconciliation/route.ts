import {NextResponse} from "next/server";
import {getDB} from "@/lib/db";
import {actorActual} from "@/lib/identidad";
import {wooStoreId} from "@/lib/woo-server";
import {italiaFinanceAccess} from "@/lib/elogy-server";
import {reconciliationInput} from "@/lib/italia-reconciliation-input";
import {italiaSameOrigin} from "@/lib/italia-origin";
export const dynamic="force-dynamic";
const messages:Record<string,string>={reference_exists:"Esta referencia de liquidación ya está registrada.",conflict:"El registro cambió. Actualiza antes de continuar.",request_reused:"La solicitud ya se utilizó con otros datos.",not_found:"No se encontró el registro en Italia.",closed:"Reabre la liquidación con un motivo antes de modificarla.",bank_duplicate:"Esta referencia bancaria ya está registrada en la cuenta.",bank_voided:"El movimiento bancario está anulado.",bank_allocated:"Retira las asignaciones antes de modificar este movimiento.",bank_overallocated:"El importe supera el saldo disponible del abono.",fx_pending:"Falta el contravalor documentado en EUR.",source_missing:"Un registro de Elogy ya no está disponible.",source_ineligible:"Revisa el importe, moneda y tarifa company del registro.",source_assigned:"Un cobro o cargo ya pertenece a otra liquidación.",detail_pending:"Completa y confirma el detalle contra el extracto de Elogy.",detail_difference:"El detalle no coincide con el neto declarado.",source_changed:"Elogy cambió un importe o pedido vinculado. Revisa el detalle.",bank_difference:"Los abonos vinculados no coinciden con el neto declarado.",reopen_reason:"La reapertura necesita un motivo y una liquidación cerrada."};
export async function POST(req:Request){
 if(!italiaFinanceAccess())return NextResponse.json({error:"Se requiere acceso de finanzas de Italia"},{status:403});
 if(!italiaSameOrigin(req))return NextResponse.json({error:"Origen inválido"},{status:403});
 const input=reconciliationInput(await req.json().catch(()=>null));if(!input)return NextResponse.json({error:"Revisa los campos, importes y comprobantes"},{status:400});
 try{
  const r=await getDB().rpc("italia_elogy_reconcile",{p_store:await wooStoreId(),p_action:input.action,p_body:input.body,p_request:input.requestId,p_actor:actorActual()});
  if(r.error)throw Error();if(r.data.error)return NextResponse.json({error:messages[r.data.error]||"No se pudo conciliar. Actualiza y revisa los datos."},{status:409});
  return NextResponse.json({ok:true,duplicate:Boolean(r.data.duplicate)});
 }catch{return NextResponse.json({error:"No se pudo guardar la conciliación"},{status:503});}
}
