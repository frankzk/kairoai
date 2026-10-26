// Copy source CDN files locally. No credentials and no execution of downloaded content.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const root=path.resolve(process.argv[2]||'backups/kenku-argentina');
const files=new Map(),mapping={},errors=[];
function allowed(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname==='cdn.shopify.com';}catch{return false;}}
function add(value){
 if(typeof value==='string')for(const m of value.matchAll(/(?:https:)?\/\/cdn\.shopify\.com\/[^\s"'<>\\)]+/g)){
  const raw=m[0].replaceAll('&amp;','&'),url=raw.startsWith('//')?'https:'+raw:raw;if(!allowed(url))continue;const u=new URL(url),key=u.origin+u.pathname;if(!files.has(key))files.set(key,url);
 }else if(Array.isArray(value))value.forEach(add);else if(value&&typeof value==='object')Object.values(value).forEach(add);
}
function jsonl(file){for(const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n'))if(line.trim())add(JSON.parse(line));}
for(const name of ['shopify_archivo.jsonl.gz','argentina_shopify_extra.jsonl.gz'])if(fs.existsSync(path.join(root,name)))jsonl(path.join(root,name));
function scan(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(e.name.endsWith('.jsonl.gz'))jsonl(p);}}
scan(path.join(root,'supplemental'));
const index=path.join(root,'shopify_archivo_imagenes.jsonl.gz');
if(fs.existsSync(index))for(const line of zlib.gunzipSync(fs.readFileSync(index)).toString('utf8').split('\n'))if(line.trim()){
 const p=JSON.parse(line),u=new URL(p.src),local='media/'+p.storage_path;if(fs.existsSync(path.join(root,local)))mapping[u.origin+u.pathname]=local;
}
async function worker(queue){while(queue.length){const [key,url]=queue.shift();if(mapping[key])continue;
 const ext=path.extname(new URL(url).pathname).toLowerCase(),relative='assets/'+crypto.createHash('sha256').update(key).digest('hex')+ext,target=path.join(root,relative);
 if(fs.existsSync(target)&&fs.statSync(target).size>0){mapping[key]=relative;continue;}
 let success=false;for(let attempt=0;attempt<3;attempt++)try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);const bytes=Buffer.from(await r.arrayBuffer());fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);mapping[key]=relative;success=true;break;}catch(e){if(attempt===2)errors.push({key,error:e.message});}
 if(!success)continue;
}}
(async()=>{const queue=[...files];await Promise.all(Array.from({length:4},()=>worker(queue)));fs.writeFileSync(path.join(root,'asset-map.json'),JSON.stringify(mapping,null,2));fs.writeFileSync(path.join(root,'asset-errors.json'),JSON.stringify(errors,null,2));console.log(JSON.stringify({cdnFiles:files.size,localCopies:Object.keys(mapping).length,errors:errors.length}));})().catch(e=>{console.error(e.message);process.exitCode=1;});
