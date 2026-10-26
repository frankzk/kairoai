import type {ElogyFact,ProfitRow} from "@/lib/elogy-model";
import type {ReconciliationData} from "@/lib/elogy-reconciliation";
export type Cost={id:number;sku:string;product_name:string;unit_cost:number;packaging_cost:number;effective_from:string;updated_at:string;provisional?:boolean};
export type Expense={id:number;type:string;expense_date:string;description:string;amount:number;currency:string;platform:string;notes:string};
export type Payout={id:number;reference:string;statement_date:string;expected_cents:number;received_cents:number|null;received_at:string|null;note:string;version:number};
export interface WorkspaceData {
 configured:boolean;finance:boolean;sourceCount:number;
 sync:Array<{resource:string;next_offset:number;total:number|null;last_ok_at:string|null;completed_at:string|null;last_error:string|null;cycles:number}>;
 shipments:Array<Pick<ElogyFact,"id"|"ref"|"guide"|"carrier"|"customer"|"state"|"state_label"|"state_at"|"occurred_at"|"gateway"|"currency"|"total_cents">&{match:string}>;profit?:ProfitRow[];costs?:Cost[];expenses?:Expense[];payouts?:Payout[];collected?:Array<Pick<ElogyFact,"id"|"ref"|"guide"|"occurred_at"|"currency"|"total_cents">>;
 skuCatalog?:Array<{sku:string;name:string}>;
 reconciliation?:ReconciliationData;
 summary?:{deliveredSales:number;collected:number;expectedBank:number;receivedBank:number;expenses:number;knownContribution:number;incomplete:number;complete:boolean;netProfit:number|null;estimated:number};
}
export const eur=(value:number|null|undefined)=>value===null||value===undefined?"Pendiente":new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(value/100);
export const field="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function romeToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
export function csvValue(value:unknown):string {let s=value==null?"":String(value);if(typeof value!=="number"&&/^[=+@\-\t\r]/.test(s))s="'"+s;return `"${s.replace(/"/g,'""')}"`;}
export function downloadCsv(name:string,rows:unknown[][]){const blob=new Blob(["\uFEFF"+rows.map(r=>r.map(csvValue).join(";")).join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
