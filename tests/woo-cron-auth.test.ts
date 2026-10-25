import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { wooCronAccessAllowed } from "@/lib/cron-auth";
const {sync, log, access} = vi.hoisted(() => ({sync:vi.fn(),log:vi.fn(),access:vi.fn()}));
vi.mock("@/lib/woo-server", () => ({syncWooStatuses:sync,wooAccess:access}));
vi.mock("@/lib/cron-runs", () => ({withCronRun:(_name:string,fn:()=>Promise<Response>)=>()=>{log();return fn();}}));
import {GET} from "../app/api/cron/woo-status/route";
describe("Woo worker authorization", () => {
  const base = {identity:null, authorization:null, secret:undefined};
  beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("WOO_KENKU_IT_SYNC_SECRET","test");access.mockReturnValue(false);sync.mockResolvedValue({synced:0,failed:0});});
  it("fails closed without configuration or with a wrong token", () => {
    expect(wooCronAccessAllowed(base)).toBe(false);
    expect(wooCronAccessAllowed({...base,secret:"test",authorization:"Bearer wrong"})).toBe(false);
    expect(wooCronAccessAllowed({...base,secret:"test",authorization:"Bearer test"})).toBe(true);
  });
  it("limits manual runs to authorized Italy operators", () => {
    expect(wooCronAccessAllowed({...base,identity:{u:10,s:["mireva-cr"],p:["pedidos"]}})).toBe(false);
    expect(wooCronAccessAllowed({...base,identity:{u:10,s:["kenku-it"],p:["panel"]}})).toBe(false);
    expect(wooCronAccessAllowed({...base,identity:{u:10,s:["kenku-it"],p:["pedidos"],mc:true}})).toBe(false);
    expect(wooCronAccessAllowed({...base,identity:{u:10,s:["kenku-it"],p:["pedidos"]}})).toBe(true);
  });
  it("rejects before recording a run or mutating Woo",async()=>{
    expect((await GET(new NextRequest("https://app.example/api/cron/woo-status"))).status).toBe(401);
    expect(log).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
    vi.stubEnv("WOO_KENKU_IT_SYNC_SECRET","");
    expect((await GET(new NextRequest("https://app.example/api/cron/woo-status",{headers:{Authorization:"Bearer "}}))).status).toBe(401);
  });
  it("runs with the dedicated token and marks failed deliveries unhealthy",async()=>{
    sync.mockResolvedValue({synced:0,failed:1});
    const response=await GET(new NextRequest("https://app.example/api/cron/woo-status",{headers:{Authorization:"Bearer test"}}));
    expect(response.status).toBe(200);expect((await response.json()).ok).toBe(false);expect(sync).toHaveBeenCalledOnce();
  });
});
