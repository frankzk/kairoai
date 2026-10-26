import { randomUUID, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { getDB } from "./db";
import { tiendaShopifyPorCodigo, getShopifyCredentials, getShopifyOAuthCredentials } from "./stores";
import { tokenShopify } from "./shopify-token";
import { CONFIG_RECURSOS, filasArchivo, siguientePadre, siguienteUrl, type RecursoArchivo } from "./shopify-archivo";

const VERSION="2026-10", STORE=4, BUCKET="argentina-shopify-archive";
type Obj=Record<string,unknown>;
type State={resource:string;status:string;next_url:string|null;parent_id:string|null;pages:number;records:number;meta:Obj;error:string|null};
export function backupAuthorized(header:string|null,secret:string|undefined):boolean {
 if(!secret||secret.length<32||!header)return false;
 const a=Buffer.from(header),b=Buffer.from(`Bearer ${secret}`);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function safeAssetUrl(value:string):boolean {
 try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&(u.hostname==="cdn.shopify.com"||u.hostname==="storage.googleapis.com"||u.hostname.endsWith(".storage.googleapis.com")||u.hostname.endsWith(".s3.amazonaws.com"));}catch{return false;}
}
export async function currentBackupToken(base:URL,clientId:string,clientSecret:string,saved:string,request:typeof fetch=fetch){
 if(base.protocol!=="https:"||!base.hostname.endsWith(".myshopify.com")||base.username||base.password)throw Error("invalid_shop");
 if(clientId&&clientSecret){
  const r=await request(new URL("/admin/oauth/access_token",base),{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",client_id:clientId,client_secret:clientSecret}).toString(),redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(r.ok){const d=await r.json();if(typeof d.access_token==="string"&&d.access_token)return{token:d.access_token,source:"client_credentials"};}
 }
 return {token:saved,source:"saved"};
}
export const BULK_QUERIES:Record<string,string>={
 orders:`{orders{edges{node{id legacyResourceId name createdAt updatedAt currencyCode transactions{id kind status gateway processedAt amountSet{shopMoney{amount currencyCode}}} metafields{edges{node{id namespace key type value}}}}}}}`,
 fulfillments:`{orders{edges{node{id fulfillmentOrders{edges{node{id status requestStatus createdAt updatedAt fulfillAt fulfillBy orderId orderName assignedLocation{name location{id}} lineItems{edges{node{id totalQuantity remainingQuantity lineItem{id}}}}}}}}}}}`,
 customers:`{customers{edges{node{id legacyResourceId metafields{edges{node{id namespace key type value}}}}}}}`,
 products:`{products{edges{node{id legacyResourceId title handle descriptionHtml status variants{edges{node{id legacyResourceId title sku barcode price compareAtPrice inventoryQuantity inventoryItem{id sku tracked unitCost{amount currencyCode} countryCodeOfOrigin harmonizedSystemCode} metafields{edges{node{id namespace key type value}}}}}} media{edges{node{id mediaContentType alt ... on MediaImage{image{url width height}} ... on Video{sources{url mimeType}} ... on ExternalVideo{originUrl host} ... on Model3d{sources{url mimeType}}}}} metafields{edges{node{id namespace key type value}}}}}}}`,
 files:`{files{edges{node{id alt createdAt ... on MediaImage{image{url width height}} ... on GenericFile{url mimeType} ... on Video{sources{url mimeType}} ... on Model3d{sources{url mimeType}}}}}}`,
};
const EXTRA_REST:Record<string,{path:(parent:string)=>string;key:string;parent?:string}>={
 theme:{path:()=>"themes",key:"themes"},
 theme_asset:{path:id=>`themes/${id}/assets`,key:"assets",parent:"theme"},
 shipping_zone:{path:()=>"shipping_zones",key:"shipping_zones"},
 carrier_service:{path:()=>"carrier_services",key:"carrier_services"},
 fulfillment_service:{path:()=>"fulfillment_services",key:"fulfillment_services"},
 tender_transaction:{path:()=>"tender_transactions",key:"tender_transactions"},
 payment_payout:{path:()=>"shopify_payments/payouts",key:"payouts"},
 payment_balance_transaction:{path:()=>"shopify_payments/balance/transactions",key:"transactions"},
};
const DIRECT_QUERIES:Record<string,{field:string;query:string}>={
 menus:{field:"menus",query:`query($after:String){menus(first:100,after:$after){nodes{id handle title items{id title type url resourceId items{id title type url resourceId items{id title type url resourceId}}}} pageInfo{hasNextPage endCursor}}}`},
 metaobject_definitions:{field:"metaobjectDefinitions",query:`query($after:String){metaobjectDefinitions(first:100,after:$after){nodes{id name type fieldDefinitions{key name type{name}}} pageInfo{hasNextPage endCursor}}}`},
 markets:{field:"markets",query:`query($after:String){markets(first:100,after:$after){nodes{id name handle} pageInfo{hasNextPage endCursor}}}`},
};
export const BACKUP_RESOURCES=[...Object.keys(CONFIG_RECURSOS),...Object.keys(EXTRA_REST),...Object.keys(DIRECT_QUERIES),"theme_files","draft_order_links","theme_originals"];

async function checked<T extends {error:unknown}>(p:PromiseLike<T>):Promise<T>{const r=await p;if(r.error)throw Error("backup_persistence_failed");return r;}
async function state(resource:string):Promise<State>{
 const {data}=await checked(getDB().from("argentina_shopify_extra_state").select("resource,status,next_url,parent_id,pages,records,meta,error").eq("store_id",STORE).eq("resource",resource).maybeSingle());
 return data||{resource,status:"pending",next_url:null,parent_id:null,pages:0,records:0,meta:{},error:null};
}
async function save(s:State){await checked(getDB().from("argentina_shopify_extra_state").upsert({...s,store_id:STORE,updated_at:new Date().toISOString()},{onConflict:"store_id,resource"}));}
async function extra(resource:string,external_id:string,payload:unknown,parent_id:string|null=null){await checked(getDB().from("argentina_shopify_extra").upsert({store_id:STORE,resource,external_id,parent_id,payload,captured_at:new Date().toISOString()},{onConflict:"store_id,resource,external_id"}));}
async function ids(resource:string,base:boolean):Promise<string[]>{
 const out:string[]=[];for(let offset=0;;offset+=1000){const q=base?getDB().from("shopify_archivo").select("id:shopify_id").eq("recurso",resource):getDB().from("argentina_shopify_extra").select("id:external_id").eq("resource",resource);
  const {data}=await checked(q.eq("store_id",STORE).order(base?"shopify_id":"external_id").range(offset,offset+999));
  for(const r of data||[])out.push(String(r.id));if(!data||data.length<1000)return out;
 }
}
async function client(){
 const store=tiendaShopifyPorCodigo("kenku-ar");if(!store||store.id!==STORE)throw Error("wrong_store");
 const {shop}=getShopifyCredentials(store),credential=await tokenShopify(store);if(!credential.ok)throw Error("shopify_credentials_unavailable");
 const base=new URL(`https://${shop}`);if(base.protocol!=="https:"||!base.hostname.endsWith(".myshopify.com")||base.username||base.password)throw Error("invalid_shop");
 // Refresh for this extraction only, so an old saved token cannot hide newly
 // authorized scopes. Other integrations keep their existing credentials.
 const oauth=getShopifyOAuthCredentials(store),current=await currentBackupToken(base,oauth.clientId,oauth.clientSecret,credential.valor.token);
 const read=async(path:string,body?:Obj):Promise<Response>=>{
  const url=new URL(path,base);if(url.origin!==base.origin||!url.pathname.startsWith("/admin/"))throw Error("foreign_shopify_url");
  const run=()=>fetch(url,{method:body?"POST":"GET",headers:{"X-Shopify-Access-Token":current.token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(45000)});
  let r=await run();if(r.status===429){await new Promise(resolve=>setTimeout(resolve,Math.min(5,Number(r.headers.get("retry-after"))||2)*1000));r=await run();}return r;
 };
 const gql=async(query:string,variables:Obj={})=>{const r=await read(`/admin/api/${VERSION}/graphql.json`,{query,variables});if(!r.ok)throw Error(`shopify_http_${r.status}`);const d=await r.json();if(d.errors)throw Error(`graphql_${String(d.errors[0]?.message||"error").slice(0,180)}`);return d.data;};
 return {read,gql,base,tokenSource:current.source};
}
async function audit(c:Awaited<ReturnType<typeof client>>){
 const d=await c.gql(`{currentAppInstallation{app{id title} accessScopes{handle}} orders(first:1,sortKey:CREATED_AT){nodes{createdAt}} ordersCount(limit:null){count precision}}`);
 const counts:Record<string,unknown>={};
 for(const [name,path] of Object.entries({orders:"orders/count.json?status=any",customers:"customers/count.json",products:"products/count.json",drafts:"draft_orders/count.json"})){
  const r=await c.read(`/admin/api/${VERSION}/${path}`);counts[name]=r.ok?(await r.json()).count:{status:r.status};
 }
 const scopes=d.currentAppInstallation.accessScopes.map((s:{handle:string})=>s.handle);
 const result={at:new Date().toISOString(),app:d.currentAppInstallation.app,tokenSource:c.tokenSource,scopes,readAllOrders:scopes.includes("read_all_orders"),oldestOrderAt:d.orders.nodes[0]?.createdAt||null,ordersCount:d.ordersCount,counts};
 await extra("audit",result.at,result);return result;
}
async function restResource(resource:string,c:Awaited<ReturnType<typeof client>>,deadline:number){
 const cfg=CONFIG_RECURSOS[resource as RecursoArchivo],other=EXTRA_REST[resource];if(!cfg&&!other)throw Error("invalid_resource");
 const s=await state(resource);if(s.status==="complete")return s;
 const parent=cfg?.padre||other?.parent,baseParent=Boolean(cfg?.padre),parents=parent?await ids(parent,baseParent):null;
 const urlFor=(id:string)=>{const p=new URLSearchParams({limit:"250",...(cfg?.params?.(id)||{})});return `/admin/api/${VERSION}/${cfg?cfg.ruta(id):other.path(id)}.json?${p}`;};
 if(!s.next_url){s.parent_id=parents?siguientePadre(parents,s.parent_id):null;if(parents&&!s.parent_id){s.status="complete";await save(s);return s;}s.next_url=urlFor(s.parent_id||"");}
 s.status="running";s.error=null;
 while(Date.now()<deadline&&s.next_url){
  const r=await c.read(s.next_url);if(!r.ok)throw Error(`shopify_http_${r.status}`);const data=await r.json(),value=data[cfg?.clave||other.key];
  if(value===undefined)throw Error("shopify_response_missing_resource");const rows=(Array.isArray(value)?value:[value]) as Obj[];
  if(cfg){const mapped=filasArchivo(resource as RecursoArchivo,rows,STORE,new Date());if(mapped.length!==rows.length)throw Error("missing_source_id");for(let i=0;i<mapped.length;i+=25)await checked(getDB().from("shopify_archivo").upsert(mapped.slice(i,i+25),{onConflict:"store_id,recurso,shopify_id"}));}
  else for(const row of rows){const id=String(row.id||row.key||"");if(!id)throw Error("missing_source_id");await extra(resource,s.parent_id?`${s.parent_id}:${id}`:id,row,s.parent_id);}
  s.pages++;s.records+=rows.length;s.next_url=siguienteUrl(r.headers.get("link"));
  if(!s.next_url&&parents){s.parent_id=siguientePadre(parents,s.parent_id);if(s.parent_id)s.next_url=urlFor(s.parent_id);}
  if(!s.next_url)s.status="complete";await save(s);if(s.next_url)await new Promise(resolve=>setTimeout(resolve,400));
 }
 return s;
}
async function directResource(resource:string,c:Awaited<ReturnType<typeof client>>,deadline:number){
 const def=DIRECT_QUERIES[resource],s=await state(resource);if(s.status==="complete")return s;s.status="running";s.error=null;
 while(Date.now()<deadline){const d=(await c.gql(def.query,{after:s.next_url}))[def.field];for(const row of d.nodes)await extra(resource,String(row.id),row);
  s.pages++;s.records+=d.nodes.length;s.next_url=d.pageInfo.hasNextPage?d.pageInfo.endCursor:null;s.status=s.next_url?"running":"complete";await save(s);if(!s.next_url)break;
 }return s;
}
async function themeFiles(c:Awaited<ReturnType<typeof client>>,deadline:number){
 const s=await state("theme_files");if(s.status==="complete")return s;const themes=await ids("theme",false);s.status="running";s.error=null;
 if(!s.parent_id)s.parent_id=siguientePadre(themes,null);
 while(s.parent_id&&Date.now()<deadline){
  const d=await c.gql(`query($id:ID!,$after:String){theme(id:$id){files(first:100,after:$after){nodes{filename checksumMd5 contentType size body{...on OnlineStoreThemeFileBodyText{content} ...on OnlineStoreThemeFileBodyBase64{contentBase64} ...on OnlineStoreThemeFileBodyUrl{url}}} pageInfo{hasNextPage endCursor} userErrors{filename code}}}}`,{id:`gid://shopify/OnlineStoreTheme/${s.parent_id}`,after:s.next_url});
  if(!d.theme?.files||d.theme.files.userErrors?.length)throw Error("theme_files_incomplete");
  const files=d.theme.files,rows=files.nodes.map((f:Obj)=>{const body=f.body as Obj;return{store_id:STORE,resource:"theme_file",external_id:`${s.parent_id}:${f.filename}`,parent_id:s.parent_id,payload:{key:f.filename,checksum_md5:f.checksumMd5,content_type:f.contentType,size:f.size,...(body.content!==undefined?{value:body.content}:{}),...(body.contentBase64!==undefined?{attachment:body.contentBase64}:{}),...(body.url!==undefined?{public_url:body.url}:{})},captured_at:new Date().toISOString()};});
  for(let i=0;i<rows.length;i+=10)await checked(getDB().from("argentina_shopify_extra").upsert(rows.slice(i,i+10),{onConflict:"store_id,resource,external_id"}));
  s.pages++;s.records+=rows.length;s.next_url=files.pageInfo.hasNextPage?files.pageInfo.endCursor:null;
  if(!s.next_url)s.parent_id=siguientePadre(themes,s.parent_id);
  if(!s.parent_id)s.status="complete";await save(s);
 }if(!s.parent_id){s.status="complete";await save(s);}return s;
}
async function draftOrderLinks(c:Awaited<ReturnType<typeof client>>,deadline:number){
 const s=await state("draft_order_links");if(s.status==="complete")return s;
 const grants=await c.gql(`{currentAppInstallation{accessScopes{handle}}}`);if(!grants.currentAppInstallation.accessScopes.some((v:{handle:string})=>v.handle==="read_all_orders"))throw Error("requires_read_all_orders");
 const present=new Set(await ids("order",true)),references=new Set<string>();
 for(let offset=0;;offset+=1000){const {data}=await checked(getDB().from("shopify_archivo").select("order_id:payload->order_id").eq("store_id",STORE).eq("recurso","draft_order").order("shopify_id").range(offset,offset+999));for(const row of data||[]){const id=String(row.order_id||"");if(/^\d+$/.test(id)&&!present.has(id))references.add(id);}if(!data||data.length<1000)break;}
 s.status="running";s.error=null;s.meta={missingReferences:references.size,recovered:0,unavailable:0};
 for(const id of Array.from(references)){if(Date.now()>=deadline){await save(s);return s;}const r=await c.read(`/admin/api/${VERSION}/orders/${id}.json`);
  if(r.status===404){await extra("unavailable_order",id,{httpStatus:404,referencedBy:"draft_order",checkedAt:new Date().toISOString()});s.meta.unavailable=Number(s.meta.unavailable)+1;}
  else {if(!r.ok)throw Error(`shopify_http_${r.status}`);const order=(await r.json()).order;if(!order||String(order.id)!==id)throw Error("invalid_referenced_order");const mapped=filasArchivo("order",[order],STORE,new Date());await checked(getDB().from("shopify_archivo").upsert(mapped,{onConflict:"store_id,recurso,shopify_id"}));s.meta.recovered=Number(s.meta.recovered)+1;}
  s.pages++;s.records++;await save(s);
 }s.status="complete";await save(s);return s;
}
async function themeOriginals(c:Awaited<ReturnType<typeof client>>){
 const s=await state("theme_originals");if(s.status==="complete")return s;s.status="running";s.error=null;
 for(const id of await ids("theme",false)){const key="config/settings_schema.json",params=new URLSearchParams({"asset[key]":key}),r=await c.read(`/admin/api/${VERSION}/themes/${id}/assets.json?${params}`);if(!r.ok)throw Error(`shopify_http_${r.status}`);const asset=(await r.json()).asset;if(asset?.key!==key||typeof asset.value!=="string")throw Error("invalid_theme_schema");await extra("theme_file_original",`${id}:${key}`,asset,id);s.pages++;s.records++;await save(s);}
 s.status="complete";await save(s);return s;
}
async function bulk(kind:string,c:Awaited<ReturnType<typeof client>>){
 if(!BULK_QUERIES[kind])throw Error("invalid_bulk_kind");const s=await state(`bulk_${kind}`);if(s.status==="complete")return s;
 if(!s.meta.id){
  const d=await c.gql(`mutation($query:String!){bulkOperationRunQuery(query:$query){bulkOperation{id status} userErrors{message}}}`,{query:BULK_QUERIES[kind]});
  const op=d.bulkOperationRunQuery;if(op.userErrors.length)throw Error(`bulk_${String(op.userErrors[0].message).slice(0,180)}`);
  s.meta={id:op.bulkOperation.id};s.status="running";s.error=null;await save(s);return s;
 }
 const d=await c.gql(`query($id:ID!){node(id:$id){...on BulkOperation{id status errorCode objectCount fileSize url partialDataUrl}}}`,{id:s.meta.id});const op=d.node;
 if(!op)throw Error("bulk_missing");s.meta.status=op.status;s.meta.objectCount=op.objectCount;s.meta.fileSize=op.fileSize;
 if(["FAILED","CANCELED","EXPIRED"].includes(op.status))throw Error(`bulk_${op.status}_${op.errorCode||"unknown"}`);
 if(op.status!=="COMPLETED"){await save(s);return s;}
 if(op.url){
  if(!safeAssetUrl(op.url))throw Error("unexpected_bulk_host");const r=await fetch(op.url,{redirect:"error",signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`bulk_download_${r.status}`);const text=await r.text();
  let count=0;for(const line of text.split("\n")){if(!line.trim())continue;JSON.parse(line);count++;}if(count!==Number(op.objectCount))throw Error("bulk_count_mismatch");
  const bytes=gzipSync(text),file=`kenku-ar/bulk-${kind}-${String(s.meta.id).split('/').at(-1)}.jsonl.gz`;
  await checked(getDB().storage.from(BUCKET).upload(file,bytes,{contentType:"application/gzip",upsert:true}));
  await extra("bulk_export",kind,{path:file,bucket:BUCKET,bytes:bytes.length,records:count,operationId:s.meta.id});s.records=count;
 }
 s.status="complete";s.error=null;await save(s);return s;
}
export async function runArgentinaBackup(action:string,resource:string,deadline=Date.now()+180000){
 const db=getDB(),token=randomUUID(),claim=await checked(db.rpc("argentina_backup_claim",{p_token:token}));if(!claim.data)throw Error("backup_busy");
 try{
  const c=await client();if(action==="audit")return await audit(c);
  if(action==="bulk"){
   try{return await bulk(resource,c);}catch(e){const s=await state(`bulk_${resource}`);s.status="error";s.error=e instanceof Error?e.message:"backup_failed";await save(s);return s;}
  }
  if(action!=="resource"||!BACKUP_RESOURCES.includes(resource))throw Error("invalid_action");
  try{if(resource==="theme_files")return await themeFiles(c,deadline);if(resource==="draft_order_links")return await draftOrderLinks(c,deadline);if(resource==="theme_originals")return await themeOriginals(c);if(DIRECT_QUERIES[resource])return await directResource(resource,c,deadline);return await restResource(resource,c,deadline);}
  catch(e){const s=await state(resource);s.status="error";s.error=e instanceof Error?e.message:"backup_failed";await save(s);return s;}
 }finally{await checked(db.rpc("argentina_backup_release",{p_token:token}));}
}
