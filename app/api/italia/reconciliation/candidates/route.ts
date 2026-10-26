import {NextRequest,NextResponse} from "next/server";
import {italiaFinanceAccess} from "@/lib/elogy-server";
import {wooStoreId} from "@/lib/woo-server";
import {getDB} from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
 if(!italiaFinanceAccess())return NextResponse.json({error:"Se requiere acceso de finanzas de Italia"},{status:403});
 const q=req.nextUrl.searchParams,resource=q.get("resource")||"collected",search=(q.get("search")||"").trim().replace(/^#+/,""),page=Number(q.get("page")||1);
 if(!["collected","costs"].includes(resource)||search.length>100||!Number.isInteger(page)||page<1||page>1000)return NextResponse.json({error:"Filtro inválido"},{status:400});
 try{const r=await getDB().rpc("italia_elogy_candidates",{p_store:await wooStoreId(),p_resource:resource,p_search:search,p_page:page});if(r.error)throw Error();return NextResponse.json(r.data,{headers:{"Cache-Control":"no-store"}});}
 catch{return NextResponse.json({error:"No se pudieron leer las partidas disponibles"},{status:503});}
}
