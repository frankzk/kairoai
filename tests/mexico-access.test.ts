import {beforeEach, describe, expect, it, vi} from "vitest";
const {identity, from} = vi.hoisted(() => ({identity:vi.fn(), from:vi.fn()}));
vi.mock("@/lib/identidad", () => ({identidadActual:identity}));
vi.mock("@/lib/db", () => ({getDB:() => ({from})}));
import {mexicoAccess, mexicoStoreId} from "@/lib/mexico-server";
import {orderDateRange} from "@/lib/italia-filters";
import {exigenciaDe, cumple} from "@/lib/permisos";

describe("Mexico authorization and calendar boundaries", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires both Mexico access and an operational permission", () => {
    for(const who of [null,{id:2,tiendas:["kenku-it"],permisos:["pedidos"]},{id:2,tiendas:["kenku-mx"],permisos:["leads"]}]) {
      identity.mockReturnValue(who); expect(mexicoAccess()).toBe(false);
    }
    identity.mockReturnValue({id:2,tiendas:["kenku-mx"],permisos:["pedidos"]}); expect(mexicoAccess()).toBe(true);
    identity.mockReturnValue({id:0,tiendas:[],permisos:["finanzas"]}); expect(mexicoAccess()).toBe(true);
    expect(cumple(exigenciaDe("/api/mexico/orders","GET"),["leads"])).toBe(false);
    expect(cumple(exigenciaDe("/api/mexico/shopify/123","POST"),["pedidos"])).toBe(true);
  });
  it("resolves only an active Mexico store, without a fallback to Costa Rica", async () => {
    const builder={select:vi.fn(),eq:vi.fn(),single:vi.fn()};
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder);
    builder.single.mockResolvedValue({data:{id:3},error:null}); from.mockReturnValue(builder);
    expect(await mexicoStoreId()).toBe(3);
    expect(builder.eq.mock.calls).toEqual([["code","kenku-mx"],["active",true]]);
    builder.single.mockResolvedValue({data:null,error:{message:"unavailable"}});
    await expect(mexicoStoreId()).rejects.toThrow();
  });
  it("uses Mexico's calendar date at UTC midnight and has no 2026 DST transition", () => {
    const zone="America/Mexico_City";
    expect(orderDateRange(zone,"today","","",new Date("2026-10-26T02:00:00Z"))).toEqual({from:"2026-10-25T06:00:00.000Z",to:"2026-10-26T06:00:00.000Z"});
    expect(orderDateRange(zone,"range","2026-10-25","2026-10-25")).toEqual({from:"2026-10-25T06:00:00.000Z",to:"2026-10-26T06:00:00.000Z"});
    expect(orderDateRange(zone,"range","2026-07-10","2026-07-10")).toEqual({from:"2026-07-10T06:00:00.000Z",to:"2026-07-11T06:00:00.000Z"});
  });
});
