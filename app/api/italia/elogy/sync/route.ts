import {NextResponse} from "next/server";
import {wooAccess} from "@/lib/woo-server";
import {syncElogy} from "@/lib/elogy-server";
import {italiaSameOrigin} from "@/lib/italia-origin";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(req:Request){
 if(!wooAccess())return NextResponse.json({error:"Sin acceso a Italia"},{status:403});
 if(!italiaSameOrigin(req))return NextResponse.json({error:"Origen inválido"},{status:403});
 try{const result=await syncElogy(2);return NextResponse.json({result,ok:!Object.values(result).some(v=>Boolean((v as {error?:string}).error))});}
 catch{return NextResponse.json({error:"No se pudo sincronizar Elogy. Revisa la configuración o el estado de la conexión."},{status:503});}
}
