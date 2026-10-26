import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {wooAccess} from "@/lib/woo-server";
import {syncElogy} from "@/lib/elogy-server";
import {withCronRun} from "@/lib/cron-runs";
export const runtime="nodejs";
export const dynamic = "force-dynamic";
export const maxDuration=300;
const run = withCronRun("elogy",async()=>{
 try{const result=await syncElogy(10);const ok=!Object.values(result).some(v=>Boolean((v as {error?:string}).error));return NextResponse.json({ok,result},{status:ok?200:503});}
 catch{return NextResponse.json({ok:false,error:"Elogy no disponible o sin configuración"},{status:503});}
});
export async function GET(req:NextRequest){
 const secret=process.env.WOO_KENKU_IT_SYNC_SECRET,expected=Buffer.from(`Bearer ${secret||""}`),supplied=Buffer.from(req.headers.get("authorization")||"");
 if(!(secret&&supplied.length===expected.length&&timingSafeEqual(expected,supplied))&&!wooAccess())return NextResponse.json({error:"Unauthorized"},{status:401});
 return run();
}
