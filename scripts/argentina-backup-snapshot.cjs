// Private, portable snapshot. Never prints records, credentials or signed URLs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {once}=require('node:events');
require('@next/env').loadEnvConfig(process.cwd());
const {createClient}=require('@supabase/supabase-js');
const root=path.resolve(process.argv[2]||'backups/kenku-argentina');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
if(new URL(process.env.SUPABASE_URL).hostname!=='xxqunqnicvjhnwbnyghe.supabase.co')throw Error('Unexpected database');
const manifest={store:'kenku-ar',store_id:4,started_at:new Date().toISOString(),files:[],tables:{},errors:[]};
fs.mkdirSync(root,{recursive:true});
async function checked(q){const r=await q;if(r.error)throw Error(r.error.code||'database read failed');return r;}
async function exportTable(table,order,optional=false){
 const filename=table+'.jsonl.gz',target=path.join(root,filename),temp=target+'.partial';
 let count=0;const out=fs.createWriteStream(temp),gzip=zlib.createGzip({level:6});gzip.pipe(out);
 try{
  const expected=await checked(db.from(table).select('*',{count:'exact',head:true}).eq('store_id',4));
  for(let offset=0;;offset+=250){let q=db.from(table).select('*').eq('store_id',4);for(const col of order)q=q.order(col);const {data}=await checked(q.range(offset,offset+249));
   for(const row of data){if(row.store_id!==4)throw Error('Cross-store row');if(!gzip.write(JSON.stringify(row)+'\n'))await once(gzip,'drain');count++;}
   if(data.length<250)break;
  }
  gzip.end();await once(out,'close');
  if(expected.count!==count)throw Error('Source changed during export; rerun snapshot');
  fs.renameSync(temp,target);manifest.tables[table]={rows:count};return;
 }catch(e){gzip.destroy();out.destroy();if(optional){manifest.errors.push({table,error:e.message});return;}throw e;}
}
async function downloadMedia(){
 const {data}=await checked(db.from('shopify_archivo_imagenes').select('*').eq('store_id',4).order('image_id'));
 let done=0;for(const row of data){
  if(!row.storage_path.startsWith('kenku-ar/')||row.storage_path.includes('..'))throw Error('Invalid media path');
  const relative='media/'+row.storage_path,target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target)&&fs.statSync(target).size===row.bytes){done++;continue;}
  const r=await db.storage.from('shopify-archivo').download(row.storage_path);
  if(r.error){manifest.errors.push({image_id:row.image_id,error:'storage download failed'});continue;}
  const bytes=Buffer.from(await r.data.arrayBuffer());if(row.bytes!==null&&bytes.length!==row.bytes)throw Error('Media size mismatch');fs.writeFileSync(target,bytes);done++;
 }
 manifest.media={expected:data.length,downloaded:done};
}
function hashFiles(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){hashFiles(file);continue;}if(entry.name==='manifest.json'||entry.name.endsWith('.partial'))continue;const b=fs.readFileSync(file);manifest.files.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});}}
(async()=>{
 for(const [table,order,optional] of [['shopify_archivo',['recurso','shopify_id']],['shopify_archivo_estado',['recurso']],['shopify_archivo_imagenes',['image_id']],['argentina_shopify_management',['shopify_id']],['argentina_shopify_events',['id']],['argentina_shopify_extra',['resource','external_id'],true],['argentina_shopify_extra_state',['resource'],true]]){
  await exportTable(table,order,optional);console.log(JSON.stringify({table,rows:manifest.tables[table]?.rows,optionalError:manifest.errors.some(e=>e.table===table)}));
 }
 await downloadMedia();hashFiles(root);manifest.finished_at=new Date().toISOString();fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({root,tables:manifest.tables,media:manifest.media,errors:manifest.errors}));
})().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
