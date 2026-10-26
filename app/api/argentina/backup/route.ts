import { NextResponse } from "next/server";
import { BACKUP_RESOURCES, BULK_QUERIES, backupAuthorized, runArgentinaBackup } from "@/lib/argentina-backup";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function POST(req:Request){
 if(!backupAuthorized(req.headers.get("authorization"),process.env.ARGENTINA_BACKUP_SECRET))return NextResponse.json({error:"Unauthorized"},{status:401});
 const text=await req.text();if(text.length>4096)return NextResponse.json({error:"Invalid request"},{status:400});
 let b;try{b=JSON.parse(text);}catch{return NextResponse.json({error:"Invalid request"},{status:400});}
 const action=b?.action,resource=typeof b?.resource==="string"?b.resource:"";
 if(action!=="audit"&&!(action==="resource"&&BACKUP_RESOURCES.includes(resource))&&!(action==="bulk"&&Object.hasOwn(BULK_QUERIES,resource)))return NextResponse.json({error:"Invalid request"},{status:400});
 try{return NextResponse.json({ok:true,result:await runArgentinaBackup(action,resource)},{headers:{"Cache-Control":"no-store"}});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"backup_failed"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
