/** Local confirmation evidence, separate from creation or iComfly attribution. */
export interface KairoConfirmation {
  staffId: number;
  staffName: string;
  at: string;
}
export interface ConfirmationActor {
  id: number;
  name: string;
}
export interface ConfirmationEventRow {
  order_name: string;
  kind: string;
  outcome: string;
  staff_id: number | null;
  staff_name: string;
  created_at: string;
}
const reference = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .toUpperCase();
export function buildKairoConfirmationIndex(events: ConfirmationEventRow[]) {
  const byActorAndOrder = new Map<string, KairoConfirmation>();
  const actors = new Map<number, ConfirmationActor>();
  for (const e of events) {
    if (
      e.kind !== "contacto" ||
      e.outcome !== "confirmado" ||
      !e.staff_id ||
      !Number.isSafeInteger(e.staff_id) ||
      e.staff_id <= 0 ||
      !reference(e.order_name) ||
      !Number.isFinite(Date.parse(e.created_at))
    )
      continue;
    const confirmation = {
      staffId: e.staff_id,
      staffName: e.staff_name.trim() || `Asesora ${e.staff_id}`,
      at: e.created_at,
    };
    const key = `${e.staff_id}:${reference(e.order_name)}`;
    const old = byActorAndOrder.get(key);
    if (!old || Date.parse(old.at) < Date.parse(confirmation.at))
      byActorAndOrder.set(key, confirmation);
    actors.set(e.staff_id, { id: e.staff_id, name: confirmation.staffName });
  }
  return {
    byActorAndOrder,
    actors: Array.from(actors.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    ),
  };
}
export function findKairoConfirmation(
  index: ReturnType<typeof buildKairoConfirmationIndex>,
  staffId: number,
  row: { order_name?: string | null; shopify_order_name?: string | null },
): KairoConfirmation | null {
  const matches = [row.order_name, row.shopify_order_name]
    .map((name) => index.byActorAndOrder.get(`${staffId}:${reference(name)}`))
    .filter((c): c is KairoConfirmation => Boolean(c));
  return matches.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}
