import {NextRequest,NextResponse} from "next/server";
import {wooAccess} from "@/lib/woo-server";
import {readElogyWorkspace,italiaFinanceAccess,elogyPeriod} from "@/lib/elogy-server";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(req:NextRequest){
 if(!wooAccess())return NextResponse.json({error:"Sin acceso a Italia"},{status:403});
 try{elogyPeriod(req.nextUrl.searchParams);}catch{return NextResponse.json({error:"Periodo inválido"},{status:400});}
 try{return NextResponse.json(await readElogyWorkspace(req.nextUrl.searchParams,italiaFinanceAccess()),{headers:{"Cache-Control":"no-store"}});}
 catch{return NextResponse.json({error:"No se pudo leer la información de Elogy en Kairo"},{status:503});}
}
