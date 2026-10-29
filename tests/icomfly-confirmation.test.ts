import {describe,it,expect,vi,beforeEach} from "vitest";
const {list}=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("@/lib/icomfly",()=>({getIcomflyExternalStoreId:(s:string)=>s==="mireva-cr"?71:90,listOrdersWithAttribution:list}));
import {verifyCreatedIcomflyOrder} from "../lib/icomfly-confirmation";
beforeEach(()=>list.mockReset());
describe("Verificación real del listado",()=>{
 it.each([{store_id:71,order_number:"EXCEL-123"},{store_id:90,order_number:"MANUAL-123"},{order_number:"MANUAL-123"},{store_id:71,order_number:"MANUAL-123",id:999}])("no confirma EXCEL, tienda ajena, sin tienda o ID distinto: %j",async row=>{
  list.mockResolvedValue({raw:[{id:123,...row}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123")).toBeNull();
 });
 it("requiere mismo ID, tienda y código MANUAL en una lectura independiente",async()=>{
  list.mockResolvedValue({raw:[{id:123,store_id:71,order_number:"MANUAL-123",total:19900}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123")).toMatchObject({id:"123",orderNumber:"MANUAL-123"});
  expect(list).toHaveBeenCalledWith({storeId:1,externalStoreId:71,page:1,limit:100});
 });
 it("busca páginas adicionales sin convertir la ausencia en éxito",async()=>{
  list.mockResolvedValue({raw:[],hasMore:true});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123")).toBeNull();
  expect(list).toHaveBeenCalledTimes(3);
 });
 it.each([196,"210"])("obtiene el correlativo visible %s de la lectura independiente",async seq=>{
  list.mockResolvedValue({raw:[{id:123,store_id:71,order_number:"MANUAL-123",store_web_seq:seq}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123")).toMatchObject({id:"123",storeWebSeq:String(seq)});
 });
 it("no confirma un pedido nativo que perdió una línea aunque exista el ID",async()=>{
  const expected={items:[{product_id:1561,variant_id:null,quantity:1},{product_id:3595,variant_id:null,quantity:1}],total:39800};
  list.mockResolvedValue({raw:[{id:123,store_id:71,order_number:"MANUAL-KAIRO-123",total:39800,items:[{product_id:1561,quantity:1}]}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123",expected)).toBeNull();
 });
 it("confirma al devolver ambas líneas con sus cantidades y total correctos",async()=>{
  const expected={items:[{product_id:1561,variant_id:null,quantity:1},{product_id:3595,variant_id:null,quantity:1}],total:39800};
  list.mockResolvedValue({raw:[{id:123,store_id:71,order_number:"MANUAL-KAIRO-123",total:39800,items:expected.items}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123",expected)).toMatchObject({id:"123"});
 });
 it.each([undefined,null,"",0,-1,"MANUAL-123","196.5"])("no inventa un correlativo cuando recibe %s",async seq=>{
  list.mockResolvedValue({raw:[{id:123,store_id:71,order_number:"MANUAL-123",store_web_seq:seq}],hasMore:false});
  expect(await verifyCreatedIcomflyOrder("mireva-cr","123")).toMatchObject({id:"123",storeWebSeq:null});
 });
});
