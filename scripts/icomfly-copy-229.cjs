// Explicit, one-off operator tool. Never dispatches, confirms or cancels an order.
// Run only in a staged, unaliased deployment with the existing production secrets.
const fs = require('fs'), path = require('path'), {createRequire} = require('module');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const RUN_ID = '7f1b3893-81d3-4893-8344-00c5164d8050';
const RUN_AT = 1793311080697;
const MARKER = 'KAIRO-COPY229:' + RUN_ID;
const modules = new Map();
let stage='guard';
function load(file) {
 file = path.resolve(ROOT, file);
 if (modules.has(file)) return modules.get(file).exports;
 const m = {exports:{}}; modules.set(file,m);
 const requireAt = createRequire(file);
 const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(id=>{
  const local = id.startsWith('@/') ? path.join(ROOT,id.slice(2)) : id.startsWith('.') ? path.resolve(path.dirname(file),id) : null;
  return local && fs.existsSync(local+'.ts') ? load(local+'.ts') : requireAt(id);
 },m,m.exports);
 return m.exports;
}
function prepareCopy(detail, catalog) {
 const o = detail.pedido || {}, c = detail.cliente || {}, s = detail.envio || {};
 if (Number(o.id)!==792305 || !['Confirmada','Pendiente'].includes(o.status) || o.tracking_number || o.carrier_name || o.tracking_status ||
  Number(o.total)!==33830 || Number(o.valor_a_recaudar)!==33830 || o.tipo_recaudo!=='con_recaudo' ||
  !String(c.nombre||'').trim() || !c.telefono || !s.direccion || !s.ciudad || !s.departamento ||
  !Array.isArray(detail.items) || detail.items.length!==2) throw Error('El original cambió: no se permite crear la copia.');
 const {buildManualOrder,resolveManualOrderLine,manualOrderReference} = load('lib/icomfly-manual-order.ts');
 const items = [1561,3595].map(id=>{
  const p=catalog.find(p=>Number(p.id)===id);
  const item=p && detail.items.find(i=>i.product_name===p.name);
  if(!item || Number(item.quantity)!==1 || Number(item.product_price)!==19900 || item.variant_name) throw Error('Los productos del original cambiaron.');
  return {title:p.name,product_title:p.name,sku:p.shiphero_sku,price:19900,quantity:1};
 });
 const pedido={items,envio:{name:s.nombre||c.nombre,province:s.departamento,canton:s.ciudad,address:s.direccion},nombreLead:c.nombre,
  telefono:s.telefono||c.telefono,pago:'cod',descuento:{type:'percentage',value:15},
  nota:'Copia técnica autorizada del pedido #229 (792305). '+MARKER+'. Mantener pendiente; no preparar ni despachar automáticamente.'};
 const result=buildManualOrder(pedido,items.map((it,i)=>resolveManualOrderLine(it,catalog.find(p=>Number(p.id)===[1561,3595][i]),71)),71,RUN_ID);
 // Fixed native-format reference lets any subsequent read identify this one run.
 result.body.orderNumber=manualOrderReference(RUN_ID,RUN_AT);
 result.expected.discount_adjustment.order_number=result.body.orderNumber;
 return result;
}
async function main() {
 if(process.argv[2]!=='--execute-copy-229' || process.env.VERCEL_ENV!=='production' || process.env.KAIRO_COPY229_CONFIRMATION!==RUN_ID) {
  throw Error('Requiere invocación explícita en un despliegue de diagnóstico sin dominios.');
 }
 const api=load('lib/icomfly.ts'), mcp=load('lib/icomfly-mcp.ts');
 stage='store-check';
 const connection=await mcp.tiendaDeLaConexion('mireva-cr');
 if(connection.id!==71 || api.getIcomflyExternalStoreId('mireva-cr')!==71)throw Error('Tienda incorrecta.');
 stage='source-read';
 const detail=await mcp.llamarHerramientaIcomfly('mireva-cr','detalle_pedido',{identificador:'792305'});
 stage='catalog-read';
 const catalog=await Promise.all([1561,3595].map(id=>api.getIcomflyCatalogProduct('mireva-cr',id)));
 stage='prepare';
 const prepared=prepareCopy(detail,catalog);
 stage='duplicate-check';
 const found=await mcp.llamarHerramientaIcomfly('mireva-cr','buscar_pedido',{query:prepared.body.orderNumber});
 const existing=found.pedidos||[];
 if(existing.length>1 || Number(found.encontrados)>1)throw Error('Referencia repetida: revisar sin crear.');
 let id=existing[0]?.id;
 if(!id) {
  stage='source-shipment-check';
  let source;
  for(let page=1;page<=10;page++) {
   const list=await api.listOrdersWithAttribution({storeId:1,externalStoreId:71,page,limit:100});
   source=list.raw.find(r=>Number(r.id)===792305 && Number(r.store_id)===71);
   if(source || !list.hasMore)break;
  }
  if(!source || source.boxful_synced_at || source.tracking_number || source.carrier_name)throw Error('No se confirmó el original sin envío.');
  if(String(source.internal_note||'').includes(MARKER))throw Error('Intento ya registrado; no se vuelve a crear tras un resultado incierto.');
  stage='attempt-record';
  await mcp.llamarHerramientaIcomfly('mireva-cr','agregar_nota_pedido',{order_id:792305,nota:MARKER+' — intento único de copia pendiente con 2 productos y total 33830. Si falta confirmación, buscar la referencia '+prepared.body.orderNumber+' antes de repetir.'});
  console.log('KAIRO_COPY229_ATTEMPT_REGISTERED '+prepared.body.orderNumber);
  // Exactly one POST. A timeout exits; the durable marker prevents resubmission.
  stage='create-once';
  const created=await api.createManualIcomflyOrder('mireva-cr',prepared.body);
  id=created.id;
  if(!/^\d+$/.test(String(id||'')))throw Error('Creación sin ID confirmado; revisar sin repetir.');
  console.log('KAIRO_COPY229_CREATED_ID '+id);
 }
 stage='discount-verification';
 await load('lib/icomfly-discount.ts').ensureManualOrderDiscount('mireva-cr',String(id),prepared.expected);
 stage='final-verification';
 const verified=await load('lib/icomfly-confirmation.ts').verifyCreatedIcomflyOrder('mireva-cr',String(id),prepared.expected);
 const after=await mcp.llamarHerramientaIcomfly('mireva-cr','detalle_pedido',{identificador:String(id)});
 const order=after.pedido||{};
 if(!verified || order.status!=='Pendiente' || order.tracking_number || order.carrier_name ||
  Number(order.total)!==33830 || Number(order.valor_a_recaudar)!==33830)throw Error('Copia sin verificación final: revisar el ID existente, no repetir.');
 console.log('KAIRO_COPY229_RESULT '+JSON.stringify({id:String(id),reference:verified.orderNumber,store_web_seq:verified.storeWebSeq,status:order.status,
  item_count:after.items.length,subtotal:39800,discount:5970,total:33830,cod:33830,tracking:null,dispatch_executed:false}));
}
module.exports={prepareCopy,RUN_ID};
if(require.main===module)main().catch(error=>{console.error('KAIRO_COPY229_STOPPED '+JSON.stringify({stage,error_type:error.name,code:error.code||null,http_status:String(error.message||'').match(/HTTP\s+(\d+)/)?.[1]||null}));process.exitCode=1;});
