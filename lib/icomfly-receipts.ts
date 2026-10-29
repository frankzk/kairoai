import { getDB } from "@/lib/db";
import type { ExpectedIcomflyOrder } from "@/lib/icomfly-manual-order";
export interface Receipt { request_id: string; store_id: number; lead_id: number; advisor_id: number; icomfly_id: string | null; confirmed_at: string | null; expected_order?: ExpectedIcomflyOrder | null }
export async function findReceipt(storeId: number, leadId: number, requestId: string): Promise<Receipt | null> {
 const db=getDB();
 const exact=await db.from("lead_icomfly_receipts").select("*").eq("store_id",storeId).eq("lead_id",leadId).eq("request_id",requestId).maybeSingle();
 if(exact.error)throw new Error("No se pudo consultar el intento de creación.");
 if(exact.data)return exact.data;
 const open=await db.from("lead_icomfly_receipts").select("*").eq("store_id",storeId).eq("lead_id",leadId).is("confirmed_at",null).maybeSingle();
 if(open.error)throw new Error("No se pudo consultar el intento pendiente.");
 return open.data;
}
export async function reserveReceipt(receipt: Receipt): Promise<boolean> {
 const {error}=await getDB().from("lead_icomfly_receipts").insert(receipt);
 if(error?.code==="23505")return false;
 if(error)throw new Error("No se pudo registrar el intento; no se envió el pedido.");
 return true;
}
export async function saveReceiptId(receipt: Receipt, id: string): Promise<void> {
 const {error}=await getDB().from("lead_icomfly_receipts").update({icomfly_id:id}).eq("request_id",receipt.request_id).eq("store_id",receipt.store_id);
 if(error)throw new Error("No se pudo guardar la referencia de iComfly.");
 receipt.icomfly_id=id;
}
export async function confirmReceipt(receipt: Receipt): Promise<void> {
 const {error}=await getDB().from("lead_icomfly_receipts").update({confirmed_at:new Date().toISOString()}).eq("request_id",receipt.request_id).eq("store_id",receipt.store_id);
 if(error)throw new Error("No se pudo guardar la verificación.");
}
