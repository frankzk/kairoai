/** Public Elogy API contract: https://documenter.getpostman.com/view/198132/TVRq36Yh */
export const ELOGY_RESOURCES = {
  orders:"orders", shipments:"shipped", collected:"cods", costs:"billings",
} as const;
export type ElogyResource = keyof typeof ELOGY_RESOURCES;
import {object,text,type ElogyRecord} from "./elogy-shared";
export * from "./elogy-shared";

export class ElogyError extends Error {
  constructor(public readonly code:string){super(code);this.name="ElogyError";}
}
export function elogyConfigured():boolean {return Boolean(process.env.ELOGY_KENKU_IT_API_KEY?.trim());}

export async function fetchElogyPage(resource:ElogyResource, offset=0, fetcher:typeof fetch=fetch):Promise<{rows:ElogyRecord[];total:number|null;next:number;complete:boolean}> {
  if(!Object.hasOwn(ELOGY_RESOURCES,resource)||!Number.isSafeInteger(offset)||offset<0)throw new ElogyError("invalid_request");
  const key=process.env.ELOGY_KENKU_IT_API_KEY?.trim();
  if(!key||/[\r\n]/.test(key))throw new ElogyError("not_configured");
  const report=resource==="collected"||resource==="costs";
  const url=new URL(`/api/${ELOGY_RESOURCES[resource]}`,report?"https://batch.elogy.io":"https://api.elogy.io");
  url.searchParams.set(report?"$skip":"offset",String(offset));url.searchParams.set(report?"$top":"length","100");
  if(resource==="costs")url.searchParams.set("type","company");
  if(resource==="collected")url.searchParams.set("type","matched");
  let response:Response;
  try{response=await fetcher(url,{headers:{Authorization:key,Accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(45000)});}
  catch{throw new ElogyError("connection_failed");}
  if(!response.ok)throw new ElogyError(`http_${response.status}`);
  // Never include upstream response bodies in logs or client errors.
  const raw=await response.text();
  if(raw.length>8_000_000)throw new ElogyError("response_too_large");
  let payload:ElogyRecord;
  try{payload=object(JSON.parse(raw));}catch{throw new ElogyError("invalid_json");}
  if(payload.success!==true||!Array.isArray(payload.data))throw new ElogyError("unexpected_response");
  const rows=payload.data.map(object);
  if(rows.some(row=>!text(row.id)))throw new ElogyError("missing_record_identity");
  const total=Number.isSafeInteger(payload.total)&&Number(payload.total)>=0?Number(payload.total):null;
  const next=offset+rows.length;
  // A short page may just mean the provider capped the requested length.
  return {rows,total,next,complete:rows.length===0||total!==null&&next>=total};
}
