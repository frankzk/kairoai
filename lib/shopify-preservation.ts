import { createHash, randomUUID } from "node:crypto";
import { getDB } from "./db";
import { getShopifyCredentials, getShopifyOAuthCredentials, tiendaShopifyPorCodigo } from "./stores";
import { tokenShopify } from "./shopify-token";

export const PRESERVATION_BUCKET="shopify-preservation";
const API="2026-10";
type Obj=Record<string,any>; // JSON documents from a versioned external API.
type Plan={kind:"graphql"|"bulk"|"rest";query?:string;root?:string;path?:string;variables?:Obj;params?:Obj;forceFresh?:boolean;boundedPage?:boolean};
const STORE=3;
export function safeDownloadUrl(value:string):boolean {
  try {const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&(
    u.hostname==="storage.googleapis.com"||u.hostname.endsWith(".storage.googleapis.com")||u.hostname==="cdn.shopify.com"||u.hostname.endsWith(".shopifycdn.com")||u.hostname.endsWith(".myshopify.com"));}catch{return false;}
}
export function queryOnly(query:unknown):query is string {
  return typeof query==="string"&&query.length<100000&&/^\s*(?:query\b|\{)/.test(query)&&!/^\s*mutation\b/i.test(query);
}
export function preservationVariables(variables:Obj|undefined,root:string|undefined,cursor:string|null|undefined):Obj {
  return {...variables,...(root?{after:cursor||null}:{})};
}
export async function preservationRead(resource:string,id:string):Promise<Obj|null> {
  const r=await getDB().from("shopify_preservation_records").select("payload").eq("store_id",STORE).eq("resource",resource).eq("record_id",id).maybeSingle();
  if(r.error)throw Error("No se pudo leer la preservación");return r.data?.payload??null;
}
export async function preservationWrite(resource:string,id:string,payload:Obj) {
  const r=await getDB().from("shopify_preservation_records").upsert({store_id:STORE,resource,record_id:id,payload,archived_at:new Date().toISOString()},{onConflict:"store_id,resource,record_id"});
  if(r.error)throw Error("No se pudo guardar la preservación");
}
async function freshToken(){
  const store=tiendaShopifyPorCodigo("kenku-mx")!,{shop}=getShopifyCredentials(store),{clientId,clientSecret}=getShopifyOAuthCredentials(store);
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)||!clientId||!clientSecret)throw Error("La app no tiene credenciales de renovación disponibles");
  const r=await fetch(`https://${shop}/admin/oauth/access_token`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`Renovación de la app HTTP ${r.status}`);const data=await r.json();if(typeof data.access_token!=="string"||!data.access_token)throw Error("La app no devolvió credencial renovada");return data.access_token as string;
}
async function shopify(query:string,variables:Obj={},forceFresh=false) {
  const store=tiendaShopifyPorCodigo("kenku-mx")!;const cred=await tokenShopify(store),{shop}=getShopifyCredentials(store);
  if(!cred.ok||!shop)throw Error("Conexión Shopify México no disponible");
  const token=forceFresh?await freshToken():cred.valor.token;
  for(let attempt=0;attempt<5;attempt++) {
    const r=await fetch(`https://${shop}/admin/api/${API}/graphql.json`,{method:"POST",headers:{"X-Shopify-Access-Token":token,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(90000)});
    if(r.status===429){await new Promise(ok=>setTimeout(ok,2000));continue;}
    if(!r.ok)throw Error(`Shopify HTTP ${r.status}`);
    const data=await r.json();if(data.errors?.some((e:Obj)=>e.extensions?.code==="THROTTLED")){await new Promise(ok=>setTimeout(ok,2000));continue;}
    if(data.errors?.length)throw Error(data.errors.map((e:Obj)=>e.message).join("; ").slice(0,2500));
    return data.data as Obj;
  }throw Error("Shopify limitó temporalmente la lectura");
}
async function writeChunk(resource:string,index:number,lines:string[]) {
  const bytes=Buffer.from(lines.join("\n")+"\n"),sha256=createHash("sha256").update(bytes).digest("hex");
  const key=`kenku-mx/bulk/${resource}/${String(index).padStart(6,"0")}.jsonl`;
  const up=await getDB().storage.from(PRESERVATION_BUCKET).upload(key,bytes,{upsert:true,contentType:"application/x-ndjson"});
  if(up.error)throw Error("No se pudo conservar el archivo masivo");
  await preservationWrite("_file",`${resource}:${index}`,{resource,index,storage_path:key,bytes:bytes.length,sha256,lines:lines.length});
}
async function importBulk(resource:string,job:Obj,deadline:number) {
  if(!safeDownloadUrl(job.url))throw Error("URL de exportación rechazada");
  const response=await fetch(job.url,{redirect:"error",signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error("No se pudo descargar la exportación masiva");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",seen=0,lines:string[]=[],bytes=0;
  const flush=async()=>{if(!lines.length)return;await writeChunk(resource,job.parts||0,lines);job.parts=(job.parts||0)+1;job.lines=(job.lines||0)+lines.length;lines=[];bytes=0;await preservationWrite("_job",resource,job);};
  try {
    while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      let split:number;while((split=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,split).trim();buffer=buffer.slice(split+1);if(!line)continue;seen++;if(seen<=(job.lines||0))continue;JSON.parse(line);lines.push(line);bytes+=Buffer.byteLength(line)+1;if(bytes>=2*1024*1024)await flush();}
      if(done){if(buffer.trim()){seen++;if(seen>(job.lines||0)){JSON.parse(buffer);lines.push(buffer);}}await flush();if(BigInt(job.lines||0)!==BigInt(job.objectCount||0))throw Error("Conteo de exportación masiva incompleto");job.state="complete";job.completed_at=new Date().toISOString();delete job.url;await preservationWrite("_job",resource,job);return job;}
      if(Date.now()>deadline){await flush();return job;}
    }
  }finally{await reader.cancel().catch(()=>{});}
}
export function nestedTruncation(value:any,root=true):boolean {
  if(!value||typeof value!=="object")return false;
  if(!root&&value.pageInfo?.hasNextPage)return true;
  return Object.entries(value).some(([key,v])=>key!=="pageInfo"&&(Array.isArray(v)?v.some(x=>nestedTruncation(x,false)):nestedTruncation(v,false)));
}
async function runUnlocked(resource:string) {
  if(!/^[a-z][a-z0-9_-]{0,90}$/.test(resource))throw Error("Recurso inválido");
  const plan=await preservationRead("_plan",resource) as Plan|null;if(!plan)throw Error("Extractor no definido");
  let job=await preservationRead("_job",resource)||{state:"pending",count:0,started_at:new Date().toISOString()};
  if(job.state==="complete")return {state:job.state,count:job.count,lines:job.lines};
  if(job.operationId&&["FAILED","CANCELED","EXPIRED"].includes(job.shopifyStatus)){await preservationWrite("_attempt",`${resource}:${job.operationId}`,job);job={state:"pending",count:0,started_at:new Date().toISOString(),previous_operation_id:job.operationId};}
  const deadline=Date.now()+180000;
  try {
    delete job.error;
    if(plan.kind==="bulk"){
      if(!queryOnly(plan.query))throw Error("El plan debe ser una consulta de lectura");
      if(!job.operationId){
        const data=await shopify("mutation($query:String!){bulkOperationRunQuery(query:$query){bulkOperation{id status} userErrors{field message}}}",{query:plan.query},plan.forceFresh);
        const r=data.bulkOperationRunQuery;if(r.userErrors?.length)throw Error(r.userErrors.map((e:Obj)=>e.message).join("; "));
        if(!r.bulkOperation?.id)throw Error("Shopify no creó la exportación");job.operationId=r.bulkOperation.id;job.state="running";
      }
      const data=await shopify("query($id:ID!){node(id:$id){...on BulkOperation{id status errorCode objectCount rootObjectCount fileSize url}}}",{id:job.operationId},plan.forceFresh);
      const op=data.node;if(!op)throw Error("Exportación no encontrada");job.shopifyStatus=op.status;job.objectCount=op.objectCount;job.rootObjectCount=op.rootObjectCount;
      if(["FAILED","CANCELED","EXPIRED"].includes(op.status))throw Error(`Exportación ${op.status}: ${op.errorCode||"sin detalle"}`);
      if(op.status==="COMPLETED"){
        if(!op.url&&BigInt(op.objectCount||0)===BigInt(0)){job.state="complete";job.lines=0;job.parts=0;}else{job.url=op.url;job.state="downloading";await preservationWrite("_job",resource,job);job=await importBulk(resource,job,deadline);}
      }
    }else if(plan.kind==="graphql"){
      if(!queryOnly(plan.query))throw Error("El plan debe ser una consulta de lectura");
      do {
        const data=await shopify(plan.query,preservationVariables(plan.variables,plan.root,job.cursor),plan.forceFresh);
        if(!plan.root){if(nestedTruncation(data)&&!plan.boundedPage)throw Error("Una colección anidada necesita paginación adicional");await preservationWrite(resource,"singleton",data);job.count=1;job.state="complete";break;}
        const connection=plan.root.split(".").reduce((v:any,k)=>v?.[k],data);if(!connection)throw Error("Respuesta sin la colección esperada");
        const nodes=connection.nodes??connection.edges?.map((e:Obj)=>e.node);if(!Array.isArray(nodes))throw Error("Colección inválida");
        if(nestedTruncation(connection))throw Error("Una colección anidada necesita paginación adicional");
        for(const node of nodes){const id=String(node.id??node.resourceId??node.filename??node.type??node.handle??"");if(!id)throw Error("Registro sin identificador");await preservationWrite(resource,id,node);}
        job.count=(job.count||0)+nodes.length;
        if(connection.pageInfo?.hasNextPage){if(!connection.pageInfo.endCursor||connection.pageInfo.endCursor===job.cursor)throw Error("Cursor de paginación inválido");job.cursor=connection.pageInfo.endCursor;job.state="running";}else{job.state="complete";job.completed_at=new Date().toISOString();}
        await preservationWrite("_job",resource,job);
      }while(job.state!=="complete"&&Date.now()<deadline);
    }else if(plan.kind==="rest"){
      if(!plan.path||!/^\/[a-z0-9_/-]+\.json$/.test(plan.path))throw Error("Ruta de lectura inválida");
      const store=tiendaShopifyPorCodigo("kenku-mx")!,cred=await tokenShopify(store),{shop}=getShopifyCredentials(store);if(!cred.ok)throw Error("Conexión Shopify no disponible");
      const url=new URL(`https://${shop}/admin/api/${API}${plan.path}`);for(const[k,v]of Object.entries(plan.params||{}))url.searchParams.set(k,String(v));
      const token=plan.forceFresh?await freshToken():cred.valor.token;
      const res=await fetch(url,{headers:{"X-Shopify-Access-Token":token},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error(`Shopify HTTP ${res.status}`);
      const payload=await res.json();if(res.headers.get("link")?.includes('rel="next"'))throw Error("La colección REST requiere un extractor paginado");await preservationWrite(resource,"singleton",payload);job.count=1;job.state="complete";
    }else throw Error("Plan inválido");
    await preservationWrite("_job",resource,job);
    return {state:job.state,count:job.count,lines:job.lines,rootObjectCount:job.rootObjectCount,shopifyStatus:job.shopifyStatus};
  }catch(e){job.state="error";job.error=e instanceof Error?e.message.slice(0,2500):"Error de extracción";await preservationWrite("_job",resource,job);return {state:"error",error:job.error};}
}

export async function runPreservation(resource:string) {
  if(!/^[a-z][a-z0-9_-]{0,90}$/.test(resource))throw Error("Recurso inválido");
  const token=randomUUID(),db=getDB(),claim=await db.rpc("shopify_preservation_claim",{p_resource:resource,p_token:token});
  if(claim.error)throw Error("No se pudo reservar la extracción");
  if(!claim.data)return {state:"busy"};
  try{return await runUnlocked(resource);}finally{
    const released=await db.from("shopify_preservation_records").update({payload:{token,expires:new Date(0).toISOString()}}).eq("store_id",3).eq("resource","_lease").eq("record_id",resource).eq("payload->>token",token);
    if(released.error)throw Error("No se pudo liberar la extracción; el lease caducará");
  }
}
