import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const {prepareCopy}=createRequire(import.meta.url)("../scripts/icomfly-copy-229.cjs");
const catalog=[{id:1561,store_id:71,name:"Pulsera",variants:[]},{id:3595,store_id:71,name:"Gomitas",variants:[]}];
const original={pedido:{id:792305,status:"Confirmada",total:33830,valor_a_recaudar:33830,tipo_recaudo:"con_recaudo"},
 cliente:{nombre:"Cliente de prueba del original",telefono:"50600000000"},
 envio:{nombre:"Cliente de prueba del original",telefono:"50600000000",direccion:"FICTICIA — NO DESPACHAR",ciudad:"Abangares",departamento:"Guanacaste"},
 items:[{product_name:"Pulsera",quantity:1,product_price:19900},{product_name:"Gomitas",quantity:1,product_price:19900}]};
describe("Copia técnica autorizada del #229",()=>{
 it("conserva los dos productos, 15%, destinatario y total; crea solo pendiente",()=>{
  const result=prepareCopy(original,catalog);
  expect(result.body).toMatchObject({status:"Pendiente",store_id:71,subtotal:39800,total:33830,discountAmount:5970,
   customer:{fullName:original.cliente.nombre},shipping_address:original.envio.direccion,
   send_confirmation:false,send_to_shopify:false,products:[{id:1561,quantity:1},{id:3595,quantity:1}]});
  expect(result.body.orderNumber).toMatch(/^MANUAL-\d{13}-[A-Z0-9]{5}$/);
  expect(result.expected.discount_adjustment.order_number).toBe(result.body.orderNumber);
 });
 it("usa una referencia fija para que un reintento solo recupere la misma copia",()=>{
  expect(prepareCopy(original,catalog).body.orderNumber).toBe(prepareCopy(original,catalog).body.orderNumber);
 });
 it.each([{tracking_number:"123"},{status:"Enviada"},{total:39800},{valor_a_recaudar:39800},{id:123}])("rechaza cambios del original: %j",change=>{
  expect(()=>prepareCopy({...original,pedido:{...original.pedido,...change}},catalog)).toThrow();
 });
 it("rechaza un producto de otra tienda o una segunda línea cambiada",()=>{
  expect(()=>prepareCopy(original,[catalog[0],{...catalog[1],store_id:90}])).toThrow();
  expect(()=>prepareCopy({...original,items:[original.items[0],{...original.items[1],quantity:2}]},catalog)).toThrow();
 });
});
