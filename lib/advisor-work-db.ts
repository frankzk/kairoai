import { getDB } from "./db";
import { advisorWorkActors, type AdvisorIcomflyRow } from "./advisor-work";
import type { ConfirmationEventRow } from "./order-confirmations";

async function readWorkEvents(
  storeId: number,
  staffId?: number,
): Promise<ConfirmationEventRow[]> {
  const rows: ConfirmationEventRow[] = [];
  for (let start = 0; ; start += 1000) {
    let q = getDB()
      .from("order_events")
      .select("order_name,kind,outcome,staff_id,staff_name,created_at")
      .eq("store_id", storeId)
      .or(
        "and(kind.eq.contacto,outcome.eq.confirmado),and(kind.eq.decision,outcome.eq.autorizar_despacho)",
      )
      .order("id", { ascending: true });
    if (staffId != null) q = q.eq("staff_id", staffId);
    const { data, error } = await q.range(start, start + 999);
    if (error)
      throw new Error("No se pudo consultar el trabajo registrado en Kairo.");
    rows.push(...((data ?? []) as ConfirmationEventRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

export async function readAdvisorWorkActors(storeId: number) {
  const [events, agents] = await Promise.all([
    readWorkEvents(storeId),
    getDB()
      .from("icomfly_agents")
      .select("staff_id,name")
      .eq("store_id", storeId),
  ]);
  if (agents.error)
    throw new Error("No se pudieron consultar las asesoras de iComfly.");
  return advisorWorkActors(events, agents.data ?? []);
}

export async function readAdvisorWorkData(storeId: number, staffId: number) {
  const eventsPromise = readWorkEvents(storeId, staffId);
  const native: AdvisorIcomflyRow[] = [];
  // Both independent reads settle even if one fails; partial work is never served.
  const nativePromise = (async () => {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await getDB()
        .from("icomfly_orders")
        .select(
          "icomfly_order_id,order_number,shopify_display_number,tracking_number,confirmed_by_staff_id,confirmed_by_name,confirmed_at,requested_by_staff_id,requested_by_name,requested_at",
        )
        .eq("store_id", storeId)
        .or(
          `confirmed_by_staff_id.eq.${staffId},requested_by_staff_id.eq.${staffId}`,
        )
        .order("icomfly_order_id", { ascending: true })
        .range(start, start + 999);
      if (error)
        throw new Error("No se pudo consultar la atribución de iComfly.");
      native.push(...((data ?? []) as AdvisorIcomflyRow[]));
      if (!data || data.length < 1000) return;
    }
  })();
  const [events] = await Promise.all([eventsPromise, nativePromise]);
  const seqs = new Map<string, string>();
  for (let start = 0; start < native.length; start += 100) {
    const { data, error } = await getDB()
      .from("icomfly_order_payloads")
      .select("icomfly_order_id,web_seq:payload->>store_web_seq")
      .eq("store_id", storeId)
      .in(
        "icomfly_order_id",
        native.slice(start, start + 100).map((r) => r.icomfly_order_id),
      );
    if (error)
      throw new Error("No se pudieron cruzar los correlativos de iComfly.");
    for (const row of data ?? [])
      if (row.web_seq) seqs.set(String(row.icomfly_order_id), row.web_seq);
  }
  return {
    events,
    native: native.map((r) => ({
      ...r,
      web_seq: seqs.get(String(r.icomfly_order_id)) ?? null,
    })),
  };
}
