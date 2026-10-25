import { beforeEach,describe,it,expect,vi } from "vitest";
import { createHmac } from "node:crypto";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/db",()=>({getDB:()=>({rpc})}));
vi.mock("@/lib/woo-server",()=>({wooEnv:()=>({secret:"test",origins:["https://shop.example"]}),wooStoreId:async()=>5}));
import {POST} from "../app/api/webhooks/cod-core/[storeCode]/route";
const payload={event:"order.created",site:"https://shop.example",order:{id:42,number:"KIT42",status:"cod-pending",created_at:"2026-10-25T10:00:00Z",currency:"EUR",total:39.9,shipping:0,discount:0,payment_method:"cod"},customer:{first_name:"Test",phone:"+393123456789"},address:{country:"IT",state:"RM",city:"Roma",address_1:"Via Test 10",postcode:"00118"},items:[{product_id:1,sku:"TEST",name:"Test",quantity:1,total:39.9}]};
function request(valid=true,input:unknown=payload){const body=JSON.stringify(input);return new Request("https://app.example/api/webhooks/cod-core/kenku-it",{method:"POST",headers:{"X-Cod-Event":"order.created","X-Cod-Signature":"sha256="+createHmac("sha256",valid?"test":"wrong").update(body).digest("hex")},body});}
describe("Woo receiver persistence boundary",()=>{
 beforeEach(()=>rpc.mockReset());
 it("rejects invalid signatures and unknown stores before writing",async()=>{
   expect((await POST(request(false),{params:{storeCode:"kenku-it"}})).status).toBe(401);
   expect((await POST(request(),{params:{storeCode:"mireva-cr"}})).status).toBe(404);expect(rpc).not.toHaveBeenCalled();
 });
 it("does not acknowledge a failed DB write",async()=>{rpc.mockResolvedValue({error:{message:"down"}});expect((await POST(request(),{params:{storeCode:"kenku-it"}})).status).toBe(503);});
 it("maps the store server-side and acknowledges durable duplicates",async()=>{rpc.mockResolvedValue({data:{id:2,duplicate:true},error:null});const res=await POST(request(),{params:{storeCode:"kenku-it"}});expect(res.status).toBe(200);expect((await res.json()).duplicate).toBe(true);expect(rpc.mock.calls[0][1].p_store).toBe(5);});
});

describe("Stripe en la frontera firmada",()=>{
 const paid=()=>({...payload,order:{...payload.order,payment_method:"stripe",status:"processing",paid:true,transaction_id:"pi_SYNTHETIC",paid_at:"2026-10-25T10:00:00Z"}});
 it("persiste el pago sin convertirlo en confirmación operativa",async()=>{rpc.mockReset();rpc.mockResolvedValue({data:{id:9,duplicate:false},error:null});const r=await POST(request(true,paid()),{params:{storeCode:"kenku-it"}});expect(r.status).toBe(200);const p=rpc.mock.calls[0][1].p_payload;expect(p.payment_method).toBe("stripe");expect(p.payment_paid).toBe(true);expect(p).not.toHaveProperty("status");});
 it("no persiste un pago incompleto aunque la firma sea válida",async()=>{rpc.mockReset();const p=paid();p.order.paid=false;expect((await POST(request(true,p),{params:{storeCode:"kenku-it"}})).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
});