import {describe,it,expect} from "vitest";
import {italiaSameOrigin} from "@/lib/italia-origin";
describe("Italy same-origin forms",()=>{
 const req=(origin:string,host?:string,url="https://app.example/api/italia/finance")=>new Request(url,{headers:{Origin:origin,...(host?{Host:host}:{})}});
 it("accepts the routed host when Next's local canonical URL uses localhost",()=>{expect(italiaSameOrigin(req("http://127.0.0.1:3193","127.0.0.1:3193","http://localhost:3193/api/italia/finance"))).toBe(true);expect(italiaSameOrigin(req("https://app.example","app.example"))).toBe(true);expect(italiaSameOrigin(req("https://app.example"))).toBe(true);});
 it("rejects cross-origin, scheme changes, malformed origins/hosts and absent Origin",()=>{for(const r of [req("https://evil.example","app.example"),req("http://app.example","app.example"),req("null","app.example"),req("https://app.example/path","app.example"),req("https://app.example","app.example@evil.example"),new Request("https://app.example")])expect(italiaSameOrigin(r)).toBe(false);});
 it("does not trust a client-supplied forwarded host",()=>{expect(italiaSameOrigin(new Request("https://app.example/api/italia/finance",{headers:{Host:"app.example",Origin:"https://evil.example","x-forwarded-host":"evil.example"}}))).toBe(false);});
});
