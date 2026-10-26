/** Next's local canonical URL can differ from the Host actually routed by the server. */
export function italiaSameOrigin(req:Request):boolean {
 try{
  const origin=req.headers.get("origin");if(!origin)return false;
  const url=new URL(req.url),given=new URL(origin),host=req.headers.get("host");
  if(given.origin!==origin||given.protocol!==url.protocol)return false;
  if(!host)return given.origin===url.origin;
  const routed=new URL(`${url.protocol}//${host}`);
  // Do not accept paths, credentials, multiple hosts or arbitrary forwarded-host headers.
  return routed.host===host.toLowerCase()&&!routed.username&&!routed.password&&routed.pathname==="/"&&given.origin===routed.origin;
 }catch{return false;}
}
