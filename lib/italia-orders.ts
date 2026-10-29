import { WOO_STATUS, WOO_TRANSITIONS, type WooStatus } from "./woo-config";

export const MANAGEMENT_STATUS = {...WOO_STATUS, partial:"Envío parcial", returned:"Devuelto", refunded:"Reembolsado"};
export const ITALIA_STATUS = {...MANAGEMENT_STATUS, preparing:"En preparación", out_for_delivery:"En reparto", incident:"Incidencia", returning:"En devolución"};
export type ItaliaStatus = keyof typeof ITALIA_STATUS;
export type ItaliaSource = "shopify" | "woocommerce";
export const SHOPIFY_TRANSITIONS: Partial<Record<ItaliaStatus, ItaliaStatus[]>> = {
  pending:["confirmed","cancelled"], confirmed:["dispatched","cancelled"],
  partial:["dispatched","returned"], dispatched:["delivered","returned"],
  delivered:[], cancelled:[], returned:[], refunded:[],
};
export function transitions(order: Pick<ItaliaOrder,"source"|"status">): ItaliaStatus[] {
  return order.source === "shopify" ? SHOPIFY_TRANSITIONS[order.status] ?? [] : WOO_TRANSITIONS[order.status as WooStatus] ?? [];
}
export interface ItaliaOrder {
  id:string; source:ItaliaSource; source_id:string; order_number:string; created_at:string;
  status:ItaliaStatus; version:number; synced_version:number; last_error:string|null;
  source_updated_at:string|null; managed_at:string|null;
  management_note:string; courier:string; tracking_number:string;
  customer_name:string; phone:string; email:string; currency:string; total:number|null;
  address:{address_1:string;address_2:string;city:string;state:string;postcode:string;country:string;region:string;province:string};
  items:Array<{name:string;sku:string;quantity:number;total:number|null}>;
  note:string; financial_status:string; fulfillment_status:string; original_tracking:string;
  shopify_cancelled:boolean;
  reconciliation?: {
    state:"matched"|"review"|"unmatched"|"ambiguous"|"unknown";
    baseStatus:ItaliaStatus; applied:boolean; elogyStatus:string; label:string;
    guide:string; carrier:string; stateAt:string|null; observedAt:string|null;
    reason:string; totalCents:number|null; currency:string;
  };
}
type Obj = Record<string,unknown>;
const obj = (v:unknown):Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const text = (v:unknown):string => typeof v === "string" ? v : "";
const num = (v:unknown):number|null => (typeof v === "string" && v.trim() !== "" || typeof v === "number") && Number.isFinite(Number(v)) ? Number(v) : null;
const arr = (v:unknown):Obj[] => Array.isArray(v) ? v.map(obj) : [];
const first = (...values:unknown[]) => values.map(text).find(v=>v.trim()) || "";

/** Only explicitly selected operational fields reach the browser, never the raw archive. */
export function mapItaliaOrder(row: Obj): ItaliaOrder {
  const p=obj(row.payload), source=row.source as ItaliaSource;
  const shopify=source==="shopify", customer=obj(p.customer), billing=obj(p.billing_address), shipping=obj(p.shipping_address);
  const address=shopify ? (Object.keys(shipping).length ? shipping : billing) : obj(p.address);
  const fullName=[text(customer.first_name),text(customer.last_name)].filter(Boolean).join(" ");
  const items=arr(shopify?p.line_items:p.items).map(i=>{
    const quantity=num(i.quantity)??0,price=num(i.price),discount=num(i.total_discount)??0;
    return {name:first(i.name,i.title)||"Producto",sku:text(i.sku),quantity,total:shopify?(price===null?null:Math.max(0,price*quantity-discount)):num(i.total)};
  });
  const r=obj(row.reconciliation), hasReconciliation=shopify&&["matched","review","unmatched","ambiguous","unknown"].includes(text(row.reconciliation_state));
  return {
    id:`${source}:${String(row.source_id)}`,source,source_id:String(row.source_id),order_number:text(row.order_number),created_at:text(row.created_at),
    status:row.status as ItaliaStatus,version:Number(row.version),synced_version:Number(row.synced_version),last_error:text(row.last_error)||null,
    source_updated_at:text(row.source_updated_at)||null,managed_at:text(row.managed_at)||null,
    management_note:text(row.management_note),courier:text(row.courier),tracking_number:text(row.tracking_number),
    customer_name:shopify?first(fullName,shipping.name,billing.name)||"Sin nombre":text(p.customer_name),
    phone:shopify?first(p.phone,shipping.phone,billing.phone,customer.phone):text(p.phone),
    email:shopify?first(p.email,customer.email):text(p.email),currency:text(p.currency),
    total:num(shopify?p.total_price:p.total),items,note:text(p.note),
    address:{address_1:first(address.address1,address.address_1),address_2:first(address.address2,address.address_2),city:text(address.city),state:first(address.province_code,address.state,address.province),postcode:first(address.zip,address.postcode),country:first(address.country_code,address.country),region:text(address.region),province:text(address.province)},
    financial_status:shopify?text(p.financial_status):(p.payment_method==="stripe"&&p.payment_paid===true?"paid":"cod"),fulfillment_status:shopify?text(p.fulfillment_status)||"unfulfilled":"",
    original_tracking:arr(p.fulfillments).filter(f=>f.status!=="cancelled").flatMap(f=>Array.isArray(f.tracking_numbers)?f.tracking_numbers.map(text):[text(f.tracking_number)]).filter(Boolean).join(", "),
    shopify_cancelled:shopify && Boolean(p.cancelled_at),
    ...(hasReconciliation?{reconciliation:{
      state:text(row.reconciliation_state) as NonNullable<ItaliaOrder["reconciliation"]>["state"],
      baseStatus:text(row.base_status) as ItaliaStatus,applied:r.applied===true,
      elogyStatus:text(r.status),label:text(r.label),guide:text(r.guide),carrier:text(r.carrier),
      stateAt:text(r.state_at)||null,observedAt:text(r.observed_at)||null,
      reason:text(r.reason),totalCents:num(r.total_cents),currency:text(r.currency),
    }}:{}),
  };
}

export function validManagementBody(value:unknown): value is {status:ItaliaStatus;version:number;sourceUpdatedAt:string|null;note:string;courier:string;tracking:string;requestId:string} {
  const b=obj(value);
  return Object.prototype.hasOwnProperty.call(MANAGEMENT_STATUS,b.status as string) && Number.isSafeInteger(b.version) && Number(b.version)>=0 &&
    (b.sourceUpdatedAt===null || typeof b.sourceUpdatedAt==="string" && Number.isFinite(Date.parse(b.sourceUpdatedAt))) &&
    typeof b.note==="string" && b.note.length<=3000 && typeof b.courier==="string" && b.courier.length<=100 &&
    typeof b.tracking==="string" && b.tracking.length<=150 && typeof b.requestId==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.requestId);
}
export const FINANCIAL_LABELS:Record<string,string>={pending:"Pendiente de pago",paid:"Pagado",partially_paid:"Pago parcial",refunded:"Reembolsado",partially_refunded:"Reembolso parcial",voided:"Pago anulado",authorized:"Pago autorizado"};
export const FULFILLMENT_LABELS:Record<string,string>={unfulfilled:"Sin preparar",fulfilled:"Preparado / enviado",partial:"Preparación parcial",restocked:"Repuesto en stock"};
