import { beforeEach,describe,expect,it,vi } from "vitest";
const {rpc,who}=vi.hoisted(()=>({rpc:vi.fn(),who:vi.fn()}));
vi.mock("@/lib/db",()=>({getDB:()=>({rpc})}));
vi.mock("@/lib/identidad",()=>({identidadActual:who}));
import {wooAccess,syncWooStatuses} from "../lib/woo-server";
describe("Woo access and durable acknowledgements",()=>{
 beforeEach(()=>{vi.unstubAllGlobals();rpc.mockReset();who.mockReset();process.env.WOO_KENKU_IT_URL="https://shop.example";process.env.WOO_KENKU_IT_CONSUMER_KEY="test-key";process.env.WOO_KENKU_IT_CONSUMER_SECRET="test-secret";});
 it("fails closed without identity or without Italy and operation permission",()=>{
   for(const identity of [null,{id:1,tiendas:["mireva-cr"],permisos:["pedidos"]},{id:2,tiendas:["kenku-it"],permisos:["leads"]}]){who.mockReturnValue(identity);expect(wooAccess()).toBe(false);}
   who.mockReturnValue({id:2,tiendas:["kenku-it"],permisos:["pedidos"]});expect(wooAccess()).toBe(true);
 });
 it("sends a registered status and a version, then acknowledges only matching Woo response",async()=>{
   rpc.mockResolvedValueOnce({data:[{id:1,woo_id:123,status:"dispatched",version:2,lease_token:"lease"}]}).mockResolvedValueOnce({});
   const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:123,status:"cod-shipped"}),{status:200}));vi.stubGlobal("fetch",fetcher);
   expect(await syncWooStatuses(1)).toEqual({synced:1,failed:0});
   expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({status:"cod-shipped",meta_data:[{key:"_cod_core_crm_revision",value:2}]});
   expect(rpc.mock.calls[1]).toEqual(["woo_finish_status",{p_id:1,p_lease:"lease",p_error:null}]);
 });
 it("keeps timeouts pending instead of acknowledging success",async()=>{
   rpc.mockResolvedValueOnce({data:[{id:1,woo_id:123,status:"confirmed",version:1,lease_token:"lease"}]}).mockResolvedValueOnce({});
   vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("timeout")));
   expect(await syncWooStatuses(1)).toEqual({synced:0,failed:1});expect(rpc.mock.calls[1][1].p_error).toBeTruthy();
 });
});
