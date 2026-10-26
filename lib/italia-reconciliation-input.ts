import {euroCents,object,text} from "./elogy-shared";
const id=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const bounded=(v:unknown,max=300,required=true)=>typeof v==="string"&&v.length<=max&&(!required||v.trim().length>0);
const day=(v:unknown)=>typeof v==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const cents=(v:unknown,negative=false)=>{const n=euroCents(v);return n!==null&&Math.abs(n)<=100_000_000_000&&(negative||n>=0)?n:null;};
export function reconciliationInput(input:unknown):{action:string;requestId:string;body:Record<string,unknown>}|null {
 const b=object(input),action=text(b.action),requestId=text(b.requestId);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))return null;
 let body:Record<string,unknown>;
 if(action==="bank"){
  const amount=cents(b.amount),eur=b.currency==="EUR"?amount:b.eur_amount===""||b.eur_amount===undefined?null:cents(b.eur_amount);
  if(!bounded(b.account,100)||!bounded(b.reference,160)||!bounded(b.proof,500)||!bounded(b.note||"",3000,false)||!day(b.date)||!["EUR","USD","GBP"].includes(text(b.currency))||amount===null||amount<=0||eur!==null&&eur<=0)return null;
  body={account:text(b.account).trim().toLowerCase(),reference:text(b.reference).trim(),proof:text(b.proof).trim(),date:b.date,currency:b.currency,amount_cents:amount,eur_cents:eur,note:b.note||""};
 }else if(action==="bank_rate"||action==="bank_void"){
  if(!id(b.bank_id)||!id(b.version)||!bounded(b.reason,500))return null;
  body={bank_id:b.bank_id,version:b.version,reason:text(b.reason).trim()};
  if(action==="bank_rate"){const amount=cents(b.eur_amount);if(amount===null||amount<=0||!bounded(b.proof,500))return null;body={...body,eur_cents:amount,proof:text(b.proof).trim()};}
 }else{
  if(!id(b.payout_id)||!id(b.version))return null;body={payout_id:b.payout_id,version:b.version};
  if(action==="statement"){
   const adjustment=cents(b.adjustment??"0",true),expected=cents(b.expected);
   if(!bounded(b.reference,120)||!day(b.date)||expected===null||!bounded(b.proof||"",500,false)||!bounded(b.note||"",3000,false)||!bounded(b.adjustment_reason||"",500,false)||typeof b.confirmed!=="boolean"||adjustment===null||adjustment!==0&&!bounded(b.adjustment_reason,500)||b.confirmed&&!bounded(b.proof,500))return null;
   body={...body,reference:text(b.reference).trim(),date:b.date,expected_cents:expected,proof:text(b.proof).trim(),note:b.note||"",confirmed:b.confirmed,adjustment_cents:adjustment,adjustment_reason:text(b.adjustment_reason).trim()};
  }else if(action==="source_link"){
   if(!["collected","costs"].includes(text(b.resource))||!Array.isArray(b.ids)||!b.ids.length||b.ids.length>100||b.ids.some(v=>!bounded(v,160)))return null;
   body={...body,resource:b.resource,ids:Array.from(new Set(b.ids))};
  }else if(action==="source_unlink"){
   if(!id(b.line_id)||!bounded(b.reason,500))return null;body={...body,line_id:b.line_id,reason:text(b.reason).trim()};
  }else if(action==="allocate"){
   const amount=cents(b.amount);if(!id(b.bank_id)||amount===null||amount<=0)return null;body={...body,bank_id:b.bank_id,amount_cents:amount};
  }else if(action==="unallocate"){
   if(!id(b.bank_id)||!bounded(b.reason,500))return null;body={...body,bank_id:b.bank_id,reason:text(b.reason).trim()};
  }else if(action==="reopen"){
   if(!bounded(b.reason,500))return null;body={...body,reason:text(b.reason).trim()};
  }else if(action!=="close")return null;
 }
 return {action,requestId,body};
}
