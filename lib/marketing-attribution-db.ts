import { getDB } from "./db";
import type { MarketingOriginRow } from "./marketing-attribution";
import { readIcomflyAdOrigin } from "./icomfly-ad-origin";
import { filtrosPedidoIcomfly } from "./zadarma-calls";

const columns =
  "icomfly_order_id,order_number:payload->>order_number,shopify_display_number:payload->>shopify_display_number,store_web_seq:payload->>store_web_seq,tracking_number:payload->>tracking_number,ad_origin:payload->ad_origin";
export async function listMarketingOrigins(
  storeId: number,
  from: string,
  to: string,
): Promise<MarketingOriginRow[]> {
  const rows: MarketingOriginRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await getDB()
      .from("icomfly_order_payloads")
      .select(columns)
      .eq("store_id", storeId)
      .gte("payload->>created_at", from)
      .lt("payload->>created_at", to)
      .order("icomfly_order_id")
      .range(start, start + 999);
    if (error)
      throw new Error("No se pudieron consultar los UTM de los pedidos.");
    rows.push(...((data ?? []) as unknown as MarketingOriginRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
export async function orderMarketingOrigin(storeId: number, orderName: string) {
  const filter = filtrosPedidoIcomfly(orderName);
  if (!filter) return null;
  const { data, error } = await getDB()
    .from("icomfly_order_payloads")
    .select("ad_origin:payload->ad_origin")
    .eq("store_id", storeId)
    .or(filter)
    .limit(2);
  if (error) throw new Error("No se pudo consultar el origen publicitario.");
  return data?.length === 1 ? readIcomflyAdOrigin(data[0].ad_origin) : null;
}
