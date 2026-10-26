const fs=require('node:fs');
const endpoint='https://kairoai-pearl.vercel.app/api/argentina/backup';
const secret=fs.readFileSync('.env.argentina-backup-secret','utf8').trim();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function call(action,resource=''){
 const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({action,resource}),redirect:'error',signal:AbortSignal.timeout(280000)});
 const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'request_failed');
 fs.writeFileSync(`.env.argentina-backup-${action}-${resource||'audit'}.json`,JSON.stringify(d.result,null,2));
 return d.result;
}
const resources=['order','customer','product','checkout','custom_collection','smart_collection','collect','page','blog','article','policy','shop','redirect','price_rule','discount_code','draft_order','location','inventory_level','shop_metafield','product_metafield','theme','theme_asset','shipping_zone','carrier_service','fulfillment_service','tender_transaction','payment_payout','payment_balance_transaction','menus','metaobject_definitions','markets','theme_files'];
async function resource(name){for(let n=0;n<30;n++){const s=await call('resource',name);console.log(JSON.stringify({resource:name,status:s.status,pages:s.pages,records:s.records,error:s.error}));if(['complete','error'].includes(s.status))return;sleep: await wait(500);}}
async function bulk(kind){for(let n=0;n<90;n++){const s=await call('bulk',kind);console.log(JSON.stringify({resource:'bulk_'+kind,status:s.status,records:s.records,error:s.error}));if(['complete','error'].includes(s.status))return;await wait(10000);}}
(async()=>{
 const [action,name]=process.argv.slice(2);
 if(action==='audit'){console.log(JSON.stringify(await call('audit')));return;}
 if(action==='resource'){await resource(name);return;}
 if(action==='bulk'){await bulk(name);return;}
 if(action!=='all')throw Error('Use audit, resource <name>, bulk <kind>, or all');
 console.log(JSON.stringify({audit:await call('audit')}));
 for(const r of resources)await resource(r);
 for(const kind of ['orders','customers','products','files'])await bulk(kind);
 console.log(JSON.stringify({finalAudit:await call('audit')}));
})().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
