// Imports the same full payload used by regular sync. Never writes to iComfly.
// Run in an unaliased deployment after the withAdOrigin sync is live.
const {load}=require('./icomfly-utm-probe.cjs');
async function main(){
 if(process.env.VERCEL_ENV!=='production'||process.argv[2]!=='--backfill-ad-origin')throw Error('Requires explicit production backfill invocation');
 const code=process.argv[3],first=Number(process.argv[4]||1),max=Number(process.argv[5]||500);
 if(!['mireva-cr','mireva-hn'].includes(code)||!Number.isInteger(first)||first<1||!Number.isInteger(max)||max<1||max>1000)throw Error('Invalid store/page limits');
 const api=load('lib/icomfly.ts'),{getDB}=load('lib/db.ts');
 const store=api.resolveIcomflyStoreContext({store:code});
 const db=getDB();let pages=0,imported=0,withOrigin=0,unchanged=0,done=false;
 for(let page=first;page<first+max&&!done;page+=4){
  const results=await Promise.all(Array.from({length:Math.min(4,first+max-page)},(_,i)=>api.listOrdersWithAttribution({storeId:store.store.id,externalStoreId:store.externalStoreId,page:page+i,limit:100})));
  for(let i=0;i<results.length;i++){
   const result=results[i];pages++;
   if(result.raw.some(o=>Number(o.store_id)!==store.externalStoreId||!/^[1-9]\d*$/.test(String(o.id))))throw Error('Foreign store or invalid ID in API response');
   // A missing key would mean the endpoint did not honour withAdOrigin; do not clear existing data.
   if(result.raw.some(o=>!Object.hasOwn(o,'ad_origin')))throw Error('API omitted ad_origin; backfill stopped');
   // Merge only the ad_origin key. Retain the current operational payload and never insert an order.
   for(let j=0;j<result.raw.length;j+=25){
    const slice=result.raw.slice(j,j+25);
    const {data:existing,error:readError}=await db.from('icomfly_order_payloads').select('icomfly_order_id,payload,synced_at').eq('store_id',store.store.id).in('icomfly_order_id',slice.map(o=>String(o.id)));
    if(readError)throw Error('Payload read failed');
    await Promise.all((existing||[]).map(async row=>{
     const source=slice.find(o=>String(o.id)===row.icomfly_order_id);
     if(JSON.stringify(row.payload.ad_origin??null)===JSON.stringify(source.ad_origin??null)){unchanged++;return;}
     const {data,error}=await db.from('icomfly_order_payloads').update({payload:{...row.payload,ad_origin:source.ad_origin}}).eq('store_id',store.store.id).eq('icomfly_order_id',row.icomfly_order_id).eq('synced_at',row.synced_at).select('icomfly_order_id');
     if(error||data?.length!==1)throw Error('Concurrent sync or write failed; restart this page');
     imported++;if(source.ad_origin)withOrigin++;
    }));
   }
   console.log('KAIRO_UTM_BACKFILL '+JSON.stringify({store:code,page:page+i,imported,withOrigin,unchanged}));
   if(!result.hasMore){done=true;break;}
  }
 }
 if(!done)throw Error('Page limit reached; continue from next page');
 console.log('KAIRO_UTM_BACKFILL_DONE '+JSON.stringify({store:code,pages,imported,withOrigin,unchanged,externalWrites:0}));
}
if(require.main===module)main().catch(e=>{console.error('KAIRO_UTM_BACKFILL_STOPPED '+JSON.stringify({type:e.name,reason:e.message}));process.exitCode=1});
