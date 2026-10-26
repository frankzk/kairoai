import { beforeEach, describe, expect, it, vi } from "vitest";
const { run }=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("@/lib/argentina-backup",async original=>({...await original<typeof import("@/lib/argentina-backup")>(),runArgentinaBackup:run}));
import { backupAuthorized, safeAssetUrl, currentBackupToken, BACKUP_RESOURCES, BULK_QUERIES } from "@/lib/argentina-backup";
import { POST } from "../app/api/argentina/backup/route";
const secret="a".repeat(64);
const req=(body:unknown,authorization:string|null=`Bearer ${secret}`)=>new Request("https://app.test/api/argentina/backup",{method:"POST",headers:{...(authorization?{Authorization:authorization}:{}),"Content-Type":"application/json"},body:JSON.stringify(body)});
describe("Private Argentina extraction",()=>{
 beforeEach(()=>{vi.clearAllMocks();process.env.ARGENTINA_BACKUP_SECRET=secret;run.mockResolvedValue({status:"complete",records:10});});
 it("fails closed without a strong configured secret",()=>{
  for(const [header,key] of [[null,secret],[`Bearer ${secret}`,undefined],[`Bearer ${secret}`,""],[`Bearer ${secret}`,"short"],[`Bearer ${secret}x`,secret],[`Bearer ${"b".repeat(64)}`,secret]])expect(backupAuthorized(header??null,key??undefined)).toBe(false);
  expect(backupAuthorized(`Bearer ${secret}`,secret)).toBe(true);
 });
 it("rejects missing auth before parsing or running backup",async()=>{expect((await POST(req({action:"audit"},null))).status).toBe(401);expect(run).not.toHaveBeenCalled();});
 it("does not allow custom URLs, arbitrary queries or operations",async()=>{
  for(const b of [{action:"resource",resource:"https://example.com"},{action:"graphql",query:"mutation{orderDelete}"},{action:"bulk",resource:"constructor"},{action:"resource",resource:"__proto__"},null])expect((await POST(req(b))).status).toBe(400);
  expect(run).not.toHaveBeenCalled();
 });
 it("only runs fixed allowlisted read/export tasks and never accepts a store id",async()=>{
  const response=await POST(req({action:"resource",resource:"order",store_id:5}));expect(response.status).toBe(200);expect(run).toHaveBeenCalledExactlyOnceWith("resource","order");expect(response.headers.get("cache-control")).toBe("no-store");
 });
 it("does not claim extraction success on errors",async()=>{run.mockRejectedValue(Error("backup_busy"));expect((await POST(req({action:"audit"}))).status).toBe(503);});
 it("restricts unauthenticated export downloads to Shopify and recognized bulk storage hosts",()=>{
  for(const url of ["http://cdn.shopify.com/a","https://cdn.shopify.com.evil.test/a","https://evil.test/a","https://cdn.shopify.com@evil.test/a","file:///etc/passwd"])expect(safeAssetUrl(url)).toBe(false);
  expect(safeAssetUrl("https://cdn.shopify.com/s/files/a.png")).toBe(true);expect(safeAssetUrl("https://storage.googleapis.com/shopify-export/a.jsonl?signature=example")).toBe(true);
 });
 it("includes the existing data plus independent files and theme copies",()=>{
  for(const resource of ["order","customer","product","draft_order","theme","theme_asset","theme_files","shipping_zone","menus"])expect(BACKUP_RESOURCES).toContain(resource);
  for(const query of Object.values(BULK_QUERIES))expect(query).not.toMatch(/\bmutation\b|orderCreate|customerUpdate/);
 });
 it("uses a fresh app token after scopes change, without sending credentials to other hosts or following redirects",async()=>{
  const request=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:"fresh-test-token"}),{status:200}));
  expect(await currentBackupToken(new URL("https://example.myshopify.com"),"test-id","test-secret","old-test-token",request)).toEqual({token:"fresh-test-token",source:"client_credentials"});
  expect(String(request.mock.calls[0][0])).toBe("https://example.myshopify.com/admin/oauth/access_token");expect(request.mock.calls[0][1].redirect).toBe("error");
  expect(new URLSearchParams(request.mock.calls[0][1].body).get("grant_type")).toBe("client_credentials");
  request.mockClear();await expect(currentBackupToken(new URL("https://evil.example"),"test-id","test-secret","old",request)).rejects.toThrow("invalid_shop");expect(request).not.toHaveBeenCalled();
 });
 it("retains the saved token for apps that do not support client credentials",async()=>{
  const request=vi.fn().mockResolvedValue(new Response("{}",{status:400}));expect(await currentBackupToken(new URL("https://example.myshopify.com"),"test-id","test-secret","old",request)).toEqual({token:"old",source:"saved"});
 });
});
