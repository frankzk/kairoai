import {euroCents,object,text} from "./elogy-shared";
const validDate=(v:unknown)=>typeof v==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const bounded=(v:unknown,max:number,required=false)=>typeof v==="string"&&v.length<=max&&(!required||v.trim().length>0);
const cents=(v:unknown)=>{const n=euroCents(v);return n!==null&&n>=0&&n<=100_000_000_000?n:null;};
export function financeInput(input:unknown):{action:string;requestId:string;body:Record<string,unknown>}|null {
 const b=object(input),a=text(b.action);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(b.requestId)))return null;
 const note=text(b.note);if(note.length>3000)return null;
 let body:Record<string,unknown>;
 if(a==="cost"){
  const unit=cents(b.unit_cost),pack=cents(b.packaging_cost);if(b.provisional!==undefined&&typeof b.provisional!=="boolean")return null;
  if(!bounded(b.sku,100,true)||!bounded(b.name,300)||!validDate(b.effective_from)||unit===null||pack===null||!(b.expected_updated_at===null||typeof b.expected_updated_at==="string"&&Number.isFinite(Date.parse(b.expected_updated_at))))return null;
  body={sku:text(b.sku).trim().toLowerCase(),name:b.name,unit_cents:unit,packaging_cents:pack,effective_from:b.effective_from,expected_updated_at:b.expected_updated_at,provisional:b.provisional===true};
 }else if(a==="expense"){
  const amount=cents(b.amount);if(!["ads","payroll","misc"].includes(text(b.type))||!validDate(b.date)||!bounded(b.description,300,true)||amount===null||!bounded(b.platform||"",100))return null;
  body={type:b.type,date:b.date,description:b.description,amount_cents:amount,platform:b.platform||"",note};
 }else if(a==="payout"){
  const expected=cents(b.expected);if(!bounded(b.reference,120,true)||!validDate(b.date)||expected===null)return null;
  body={reference:text(b.reference).trim(),date:b.date,expected_cents:expected,note};
 }else if(a==="receipt"){
  const amount=cents(b.received);if(!Number.isSafeInteger(b.id)||Number(b.id)<=0||!Number.isSafeInteger(b.version)||Number(b.version)<=0||!validDate(b.date)||amount===null)return null;
  body={id:b.id,version:b.version,date:b.date,received_cents:amount,note};
 }else return null;
 return {action:a,requestId:text(b.requestId),body};
}
