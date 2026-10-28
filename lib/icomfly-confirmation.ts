import { listOrdersWithAttribution, getIcomflyExternalStoreId } from "@/lib/icomfly";
import { getFinanceStore, type FinanceStoreCode } from "@/lib/store-config";
// Read the independent order listing, never trust the creation acknowledgement alone.
// Bound the scan and network waits; an absent order remains pending, never a false success.
export async function verifyCreatedIcomflyOrder(storeCode: FinanceStoreCode, id: string): Promise<{id:string;orderNumber:string;total:unknown} | null> {
 const expected=getIcomflyExternalStoreId(storeCode);
 if(expected==null)throw new Error("Tienda de iComfly no configurada.");
 for(let page=1;page<=3;page++){
  const result=await listOrdersWithAttribution({storeId:getFinanceStore(storeCode).id,externalStoreId:expected,page,limit:100});
  const row=result.raw.find(r=>String(r.id)===id);
  if(row){
   if(Number(row.store_id)!==expected || !/^MANUAL-/.test(String(row.order_number||"")))return null;
   return {id,orderNumber:String(row.order_number),total:row.total};
  }
  if(!result.hasMore)break;
 }
 return null;
}
