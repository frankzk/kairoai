import { getDB } from "./db";
import type { UpsellCompletado } from "./productividad-despacho";

/** Receipts, not audit entries: retries never add another sale to productivity. */
export async function listUpsellsCompletados(storeId: number, fromIso: string, toIso: string): Promise<UpsellCompletado[]> {
  const rows: UpsellCompletado[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await getDB().from("order_upsell_replacements")
      .select("id,advisor_name,completed_at")
      .eq("store_id", storeId)
      .gte("completed_at", fromIso)
      .lt("completed_at", toIso)
      .order("completed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("No se pudieron consultar los upsells completados.");
    const page = (data ?? []) as UpsellCompletado[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
