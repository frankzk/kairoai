import {describe,it,expect,vi} from "vitest";
import {NextRequest} from "next/server";
const createShopify=vi.fn();
vi.mock("@/lib/shopify",()=>({createLeadOrder:createShopify}));
describe("Shopify desactivado en Leads",()=>{
 it.each(["mireva-cr","mireva-hn"])("rechaza pantallas antiguas de %s antes de crear",async store=>{
  const {POST}=await import("../app/api/leads/[leadId]/order/route");
  for(const destino of [undefined,"shopify"]){
   const res=await POST(new NextRequest("http://localhost/api/leads/5/order",{method:"POST",body:JSON.stringify({store,destino,items:[{title:"Prueba",quantity:1}]})}),{params:{leadId:"5"}});
   expect(res.status).toBe(403);
   expect(createShopify).not.toHaveBeenCalled();
  }
 });
});
