import { afterEach, describe, expect, it, vi } from "vitest";
import { buildManualOrder, manualOrderReference, matchesExpectedIcomflyOrder, resolveManualOrderLine } from "../lib/icomfly-manual-order";
import { createManualIcomflyOrder } from "../lib/icomfly";
import type { PedidoLead } from "../lib/icomfly-pedido-lead";

const items=[
 {title:"Pulsera",sku:"64565434",price:19900,quantity:1},
 {title:"Gomitas",sku:"GOMITAS/SHILAJIT",price:19900,quantity:1},
];
const pedido:PedidoLead={items,envio:{name:"PRUEBA",address:"NO DESPACHAR",canton:"San José",province:"San José"},nombreLead:null,telefono:"50600000000",pago:"cod"};
const lines=items.map((item,i)=>resolveManualOrderLine(item,{id:i?3595:1561,store_id:71,name:item.title,variants:[]},71));
const prepared=buildManualOrder(pedido,lines,71,"request-test");

describe("Contrato nativo de iComfly",()=>{
 it("usa la referencia corta nativa y guarda la misma referencia para reconciliar el descuento",()=>{
  const key="41401ecb-f583-4a14-af81-5ee680172f09";
  const reference=manualOrderReference(key,1793307897766);
  expect(reference).toMatch(/^MANUAL-1793307897766-[A-Z0-9]{5}$/);
  expect(reference).toHaveLength(26);
  expect(manualOrderReference(key,1793307897766)).toBe(reference);
  expect(manualOrderReference("41401ecb-f583-4a14-af81-5ee680172f08",1793307897766)).not.toBe(reference);
  const result=buildManualOrder({...pedido,descuento:{type:"percentage",value:15}},lines,71,key);
  expect(result.body.orderNumber).toMatch(/^MANUAL-\d{13}-[A-Z0-9]{5}$/);
  expect(result.expected.discount_adjustment?.order_number).toBe(result.body.orderNumber);
 });
 it("envía los campos de envío nativos además del cliente, sin mezclar los dos productos",()=>{
  const result=buildManualOrder({...pedido,telefono:" 50600000000 ",envio:{...pedido.envio,reference:"PORTÓN AZUL"}},lines,71,"test");
  expect(result.body).toMatchObject({
   shipping_name:"PRUEBA",shipping_phone:"50600000000",shipping_address:"NO DESPACHAR - PORTÓN AZUL",
   shipping_city:"San José",shipping_department:"San José",paymentMethod:"Contra entrega",payment_type:"cod",
   customer:{fullName:"PRUEBA",phone:"50600000000",address:"NO DESPACHAR - PORTÓN AZUL",city:"San José",department:"San José"},
   products:[{id:1561,quantity:1},{id:3595,quantity:1}],
  });
 });
 it("preserva dos productos, sus IDs, cantidades y total; no crea una línea genérica",()=>{
  expect(prepared.body).toMatchObject({
   manual_order:true,store_id:71,isCartOrder:true,quantity:2,subtotal:39800,total:39800,status:"Pendiente",
   send_to_shopify:false,send_confirmation:false,
   products:[{id:1561,name:"Pulsera",quantity:1,price:19900},{id:3595,name:"Gomitas",quantity:1,price:19900}],
  });
  expect(prepared.expected).toEqual({items:[{product_id:1561,variant_id:null,quantity:1},{product_id:3595,variant_id:null,quantity:1}],total:39800});
 });
 it("conserva un descuento fijo y no duplica el valor de productos",()=>{
  const result=buildManualOrder({...pedido,descuento:{type:"fixed_amount",value:6420}},lines,71,"test");
  expect(result.body).toMatchObject({subtotal:39800,discountAmount:6420,discountType:"amount",discountValue:6420,total:33380,quantity:2});
  expect(result.expected.total).toBe(33380);
  expect(result.expected.discount_adjustment).toEqual({subtotal:39800,order_number:result.body.orderNumber,cod:true});
 });
 it("conserva cantidades y descuento porcentual",()=>{
  const p={...pedido,items:[{...items[0],quantity:2},items[1]],descuento:{type:"percentage" as const,value:10}};
  const l=[{...lines[0],quantity:2},lines[1]];
  expect(buildManualOrder(p,l,71,"test").body).toMatchObject({quantity:3,subtotal:59700,discountAmount:5970,discountType:"percent",discountValue:10,total:53730});
 });
 it("elige la variante única por SKU y conserva su ID nativo",()=>{
  expect(resolveManualOrderLine({...items[0],variant_title:"Negro / L",sku:"SHORT-L"},{
   id:4,store_id:71,name:"Short",variants:[{id:"v-m",name:"Negro / M",sku:"SHORT-M"},{id:"v-l",name:"Negro / L",sku:"SHORT-L"}]
  },71)).toMatchObject({productId:4,variantId:"v-l",variantName:"Negro / L"});
 });
 it("no inventa talla ni toma la primera variante ante una selección ambigua",()=>{
  expect(()=>resolveManualOrderLine({...items[0],sku:"desconocido",variant_title:"Negro / XL"},{
   id:4,store_id:71,name:"Short",variants:[{id:"m",name:"M"},{id:"l",name:"L"}]
  },71)).toThrow(/variante única/);
 });
 it("rechaza producto de otra tienda y cantidad fraccionaria",()=>{
  expect(()=>resolveManualOrderLine(items[0],{id:4,store_id:90,name:"Producto"},71)).toThrow(/esta tienda/);
  expect(()=>resolveManualOrderLine({...items[0],quantity:1.5},{id:4,store_id:71,name:"Producto"},71)).toThrow(/cantidad entera/);
 });
});

describe("Lectura independiente de todos los productos",()=>{
 const row={total:39800,items:[{product_id:3595,quantity:1},{product_id:1561,quantity:1}]};
 it("acepta los mismos productos en cualquier orden",()=>expect(matchesExpectedIcomflyOrder(row,prepared.expected)).toBe(true));
 it.each([
  {...row,items:[{product_id:null,quantity:1}]},
  {...row,items:[{product_id:1561,quantity:1}]},
  {...row,items:[{product_id:1561,quantity:1},{product_id:3595,quantity:2}]},
  {...row,total:19900},
  {...row,items:[{product_id:1561,variant_id:"otra-talla",quantity:1},{product_id:3595,quantity:1}]},
 ])("no confirma líneas sin producto, incompletas o cantidades/importe/variante distintos: %j",r=>{
  expect(matchesExpectedIcomflyOrder(r,prepared.expected)).toBe(false);
 });
});

describe("POST nativo sin reenvíos",()=>{
 afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
 it("envía la clave y la tienda correspondientes; realiza solo un POST",async()=>{
  vi.stubEnv("ICOMFLY_CR_TOKEN","test-cr-token");
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id:123}}),{status:200}));
  vi.stubGlobal("fetch",fetchMock);
  expect(await createManualIcomflyOrder("mireva-cr",prepared.body)).toMatchObject({id:123});
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url,init]=fetchMock.mock.calls[0];
  expect(url).toContain("/orders");
  expect(init).toMatchObject({method:"POST",headers:{Authorization:"Bearer test-cr-token","X-Active-Store-Ids":"71"}});
  expect(JSON.parse(init.body)).toMatchObject({store_id:71,products:[{id:1561},{id:3595}]});
 });
 it("no reintenta un timeout ni un error HTTP al crear",async()=>{
  vi.stubEnv("ICOMFLY_CR_TOKEN","test-cr-token");
  const fetchMock=vi.fn().mockRejectedValue(new Error("timeout"));
  vi.stubGlobal("fetch",fetchMock);
  await expect(createManualIcomflyOrder("mireva-cr",prepared.body)).rejects.toThrow("timeout");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockReset().mockResolvedValue(new Response("{}",{status:500}));
  await expect(createManualIcomflyOrder("mireva-cr",prepared.body)).rejects.toThrow("HTTP 500");
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it("rechaza una tienda ajena antes de enviar el POST",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  await expect(createManualIcomflyOrder("mireva-cr",{...prepared.body,store_id:90})).rejects.toThrow(/tienda/);
  expect(fetchMock).not.toHaveBeenCalled();
 });
});

