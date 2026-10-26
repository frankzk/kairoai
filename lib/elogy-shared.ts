export type ElogyRecord = Record<string,unknown>;
export const object = (v:unknown):ElogyRecord => v!==null&&typeof v==="object"&&!Array.isArray(v)?v as ElogyRecord:{};
export const text = (v:unknown):string => typeof v==="string"?v:typeof v==="number"&&Number.isFinite(v)?String(v):"";

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
