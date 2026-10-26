import {afterEach,describe,it,expect,vi} from "vitest";
import {fetchElogyPage,euroCents,elogyLogisticsState,sanitizeElogyRecord,normalizeOrderReference} from "@/lib/elogy";
afterEach(()=>vi.unstubAllEnvs());
describe("Cliente Elogy de solo lectura",()=>{
 it("uses the documented host/header and offset pagination",async()=>{
  vi.stubEnv("ELOGY_KENKU_IT_API_KEY","qa-token");const request=vi.fn().mockResolvedValue(Response.json({success:true,data:[{id:"shipment"}],total:3}));
  const result=await fetchElogyPage("shipments",1,request);expect(result).toMatchObject({next:2,complete:false,total:3});
  const [url,options]=request.mock.calls[0];expect(String(url)).toBe("https://api.elogy.io/api/shipped?offset=1&length=100");expect(options).toMatchObject({headers:{Authorization:"qa-token"},redirect:"error",cache:"no-store"});expect(options.method).toBeUndefined();
 });
 it("does not assume a short page is complete, and stops on an empty page",async()=>{
  vi.stubEnv("ELOGY_KENKU_IT_API_KEY","qa-token");
  expect((await fetchElogyPage("cod",0,vi.fn().mockResolvedValue(Response.json({success:true,data:[{id:1}]})))).complete).toBe(false);
  expect((await fetchElogyPage("cod",20,vi.fn().mockResolvedValue(Response.json({success:true,data:[]})))).complete).toBe(true);
 });
 it("fails closed for missing credentials, unsupported resources and malformed envelopes",async()=>{
  vi.stubEnv("ELOGY_KENKU_IT_API_KEY","");const network=vi.fn();await expect(fetchElogyPage("orders",0,network)).rejects.toThrow("not_configured");expect(network).not.toHaveBeenCalled();
  vi.stubEnv("ELOGY_KENKU_IT_API_KEY","qa-token");await expect(fetchElogyPage("deleteOrders" as "orders",0,network)).rejects.toThrow("invalid_request");
  for(const body of [{success:false,data:[]},{success:true,data:[{}]},{success:true,data:{}}])await expect(fetchElogyPage("orders",0,vi.fn().mockResolvedValue(Response.json(body)))).rejects.toThrow();
 });
 it("returns only technical errors, never an upstream body or credentials",async()=>{
  vi.stubEnv("ELOGY_KENKU_IT_API_KEY","qa-secret");await expect(fetchElogyPage("orders",0,vi.fn().mockResolvedValue(new Response("private upstream info",{status:401})))).rejects.toThrow(/^http_401$/);
 });
});
describe("Importes y estados de Elogy",()=>{
 it("parses cents without confusing unknown amounts and zero or rounding silently",()=>{
  expect(euroCents("€ 3.494,67")).toBe(349467);expect(euroCents("3,494.67")).toBe(349467);expect(euroCents(39.9)).toBe(3990);expect(euroCents(0)).toBe(0);expect(euroCents("-4,50")).toBe(-450);
  for(const v of [null,undefined,"",false,"1.234","oops",Number.MAX_SAFE_INTEGER])expect(euroCents(v)).toBeNull();
 });
 it("distinguishes returned, returning and delivered; unknown statuses require classification",()=>{
  expect(elogyLogisticsState("CONSEGNATO")).toBe("delivered");expect(elogyLogisticsState("Riconsegnato al mittente")).toBe("returned");expect(elogyLogisticsState("Reso al mittente")).toBe("returning");expect(elogyLogisticsState("Giacenza aperta")).toBe("incident");expect(elogyLogisticsState("invented status")).toBe("unknown");
 });
 it("matches exact order references without stripping country prefixes",()=>{
  expect(normalizeOrderReference(" #KITA7243 ")).toBe("KITA7243");expect(normalizeOrderReference("#7243")).not.toBe(normalizeOrderReference("KITA7243"));
 });
 it("removes nested transport secrets while keeping source business facts",()=>{
  expect(sanitizeElogyRecord({id:"order",amount:null,customer:{name:"QA",api_key:"secret"},Authorization:"secret",rows:[{password:"secret",sku:"QA"}]})).toEqual({id:"order",amount:null,customer:{name:"QA"},rows:[{sku:"QA"}]});
 });
});
