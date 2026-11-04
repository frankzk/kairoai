// Read-only, bounded probe. Only field names and marketing fields may enter build logs.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'), cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const req=createRequire(file);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>{const p=id.startsWith('@/')?path.join(root,id.slice(2)):id.startsWith('.')?path.resolve(path.dirname(file),id):null;return p&&fs.existsSync(p+'.ts')?load(p+'.ts'):req(id)},m,m.exports);return m.exports;}
async function main(){
 if(process.env.VERCEL_ENV!=='production'||process.argv[2]!=='--read-only')throw Error('Requires explicit production read-only invocation');
 const api=load('lib/icomfly.ts');
 const detail=await api.getIcomflyOrder('mireva-cr','873332');
 const page=await api.listOrdersWithAttribution({storeId:1,externalStoreId:71,page:1,limit:100});
 const sample=page.raw.find(x=>String(x.id)==='873332');
 const origin=sample?.ad_origin||{};
 const extract=o=>Object.fromEntries(Object.entries(o||{}).filter(([k])=>/^(utm_|ad_id$|adset_id$|campaign_id$|channel$|origen$)/i.test(k)));
 console.log('KAIRO_UTM_PROBE '+JSON.stringify({id:detail.id,seq:detail.store_web_seq,originKeys:Object.keys(origin),origin:extract(origin),hasClick:Boolean(origin.fbclid||origin.ttclid||origin.gclid),sampleCount:page.raw.length,withOrigin:page.raw.filter(x=>x.ad_origin).length}));
}
module.exports={load};
if(require.main===module)main().catch(e=>{console.error('KAIRO_UTM_PROBE_ERROR '+JSON.stringify({type:e.name,status:String(e.message).match(/(?:HTTP|error)\s+(\d+)/)?.[1]||null}));process.exitCode=1});
