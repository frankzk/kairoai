/** Public Elogy API contract: https://documenter.getpostman.com/view/198132/TVRq36Yh */
export const ELOGY_RESOURCES = {
  orders:"orders", shipments:"shipped", cod:"shippedCod", returns:"returnsV2", billings:"companyBillings",
} as const;
export type ElogyResource = keyof typeof ELOGY_RESOURCES;
export type ElogyRecord = Record<string,unknown>;
export const object = (v:unknown):ElogyRecord => v!==null&&typeof v==="object"&&!Array.isArray(v)?v as ElogyRecord:{};
export const text = (v:unknown):string => typeof v==="string"?v:typeof v==="number"&&Number.isFinite(v)?String(v):"";

export class ElogyError extends Error {
  constructor(public readonly code:string){super(code);this.name="ElogyError";}
}
export function elogyConfigured():boolean {return Boolean(process.env.ELOGY_KENKU_IT_API_KEY?.trim());}

export async function fetchElogyPage(resource:ElogyResource, offset=0, fetcher:typeof fetch=fetch):Promise<{rows:ElogyRecord[];total:number|null;next:number;complete:boolean}> {
  if(!Object.hasOwn(ELOGY_RESOURCES,resource)||!Number.isSafeInteger(offset)||offset<0)throw new ElogyError("invalid_request");
  const key=process.env.ELOGY_KENKU_IT_API_KEY?.trim();
  if(!key||/[\r\n]/.test(key))throw new ElogyError("not_configured");
  const url=new URL(`/api/${ELOGY_RESOURCES[resource]}`,"https://api.elogy.io");
  url.searchParams.set("offset",String(offset));url.searchParams.set("length","100");
  let response:Response;
  try{response=await fetcher(url,{headers:{Authorization:key,Accept:"application/json"},redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});}
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

export const LOGISTICS_LABELS = {
  created:"Envío creado", in_transit:"En tránsito", out_for_delivery:"En reparto", delivered:"Entregado",
  incident:"Incidencia", returning:"En devolución", returned:"Devuelto", cancelled:"Anulado", unknown:"Sin clasificar",
} as const;
export type LogisticsState=keyof typeof LOGISTICS_LABELS;
export function elogyLogisticsState(value:unknown):LogisticsState {
  const status=text(value).trim().toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(["consegnato","delivered"].includes(status))return "delivered";
  if(["riconsegnato al mittente","returned"].includes(status))return "returned";
  if(["reso al mittente","returning"].includes(status))return "returning";
  if(["in consegna","out for delivery"].includes(status))return "out_for_delivery";
  if(["in transito","arrivata in filiale","ritirato","in transit"].includes(status))return "in_transit";
  if(["giacenza aperta","destinatario assente","indirizzo errato","incident"].includes(status))return "incident";
  if(["spedizione creata","created"].includes(status))return "created";
  if(["annullato","cancelled","canceled"].includes(status))return "cancelled";
  return "unknown";
}

/** Integer cents; missing and invalid amounts are never silently changed to zero. */
export function euroCents(value:unknown):number|null {
  if(value===null||value===undefined||typeof value==="boolean")return null;
  let amount=text(value).trim().replace(/(?:EUR|€|\s)/g,"");
  if(amount.includes(",")&&amount.includes(".")){
    const decimal=amount.lastIndexOf(",")>amount.lastIndexOf(".")?",":".";
    amount=amount.replace(decimal===","?/\./g:/,/g,"").replace(",",".");
  }else amount=amount.replace(",",".");
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(amount))return null;
  const [whole,fraction=""]=amount.replace(/^-/ ,"").split(".");
  const result=(Number(whole)*100+Number(fraction.padEnd(2,"0")))*(amount.startsWith("-")?-1:1);
  return Number.isSafeInteger(result)?result:null;
}

export function normalizeOrderReference(value:unknown):string {return text(value).trim().replace(/^#+/,"").toUpperCase();}

/** Keep credentials out of persisted provider business records, including nested metadata. */
export function sanitizeElogyRecord(value:unknown,depth=0):unknown {
  if(depth>20)return null;
  if(Array.isArray(value))return value.map(v=>sanitizeElogyRecord(v,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:password|secret|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)/i.test(key)).map(([key,v])=>[key,sanitizeElogyRecord(v,depth+1)]));
  return value;
}
