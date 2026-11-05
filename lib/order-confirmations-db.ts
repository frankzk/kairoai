import { getDB } from "./db";
import {
  buildKairoConfirmationIndex,
  type ConfirmationEventRow,
} from "./order-confirmations";

export async function readKairoConfirmationIndex(storeId: number) {
  const events: ConfirmationEventRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await getDB()
      .from("order_events")
      .select("order_name,kind,outcome,staff_id,staff_name,created_at")
      .eq("store_id", storeId)
      .eq("kind", "contacto")
      .eq("outcome", "confirmado")
      .order("id", { ascending: true })
      .range(start, start + 999);
    if (error)
      throw new Error("No se pudieron consultar las confirmaciones de Kairo.");
    events.push(...((data ?? []) as ConfirmationEventRow[]));
    if (!data || data.length < 1000) return buildKairoConfirmationIndex(events);
  }
}
