import { nombrePedidoIcomfly } from "./icomfly-pedidos";
import type {
  ConfirmationActor,
  ConfirmationEventRow,
} from "./order-confirmations";

export type AdvisorActivity = "both" | "confirmation" | "dispatch";
export type WorkKind =
  | "confirmation"
  | "dispatch_request"
  | "dispatch_authorization";
export interface AdvisorWorkEvidence {
  source: "kairo" | "icomfly";
  kind: WorkKind;
  at: string | null;
}
export interface AdvisorWork {
  staffId: number;
  staffName: string;
  evidence: AdvisorWorkEvidence[];
}
export interface AdvisorIcomflyRow {
  icomfly_order_id: string;
  order_number: string;
  shopify_display_number: string;
  tracking_number: string;
  confirmed_by_staff_id: number | null;
  confirmed_by_name: string;
  confirmed_at: string | null;
  requested_by_staff_id: number | null;
  requested_by_name: string;
  requested_at: string | null;
  web_seq?: string | null;
}
interface WorkOrderRow {
  row_key: string;
  order_name?: string | null;
  shopify_order_name?: string | null;
  guide_number?: string | null;
}
const ref = (v: unknown) =>
  String(v ?? "")
    .trim()
    .replace(/^#/, "")
    .toUpperCase();
const validId = (n: number | null) =>
  n != null && Number.isSafeInteger(n) && n > 0;
const timestamp = (s: string | null) =>
  s && Number.isFinite(Date.parse(s)) ? s : null;
export const workEvidenceLabel = (
  e: Pick<AdvisorWorkEvidence, "kind" | "source">,
) =>
  `${e.kind === "confirmation" ? "Confirmó" : e.kind === "dispatch_request" ? "Solicitó despacho" : "Autorizó despacho"} en ${e.source === "kairo" ? "Kairo" : "iComfly"}`;
export const matchesAdvisorActivity = (
  work: AdvisorWork | undefined,
  activity: AdvisorActivity,
) =>
  !!work &&
  work.evidence.some(
    (e) =>
      activity === "both" ||
      (activity === "confirmation"
        ? e.kind === "confirmation"
        : e.kind !== "confirmation"),
  );

/** Exact references and external IDs first; a guide is a fallback only when unique. */
export function buildAdvisorWorkIndex(
  staffId: number,
  rows: readonly WorkOrderRow[],
  events: readonly ConfirmationEventRow[],
  native: readonly AdvisorIcomflyRow[],
) {
  const byKey = new Map(rows.map((r) => [r.row_key, r]));
  const names = new Map<string, Set<string>>(),
    guides = new Map<string, Set<string>>();
  const addKey = (
    map: Map<string, Set<string>>,
    value: unknown,
    key: string,
  ) => {
    const normalized = ref(value);
    if (!normalized) return;
    const keys = map.get(normalized) ?? new Set<string>();
    keys.add(key);
    map.set(normalized, keys);
  };
  for (const row of rows) {
    addKey(names, row.order_name, row.row_key);
    addKey(names, row.shopify_order_name, row.row_key);
    addKey(guides, row.guide_number, row.row_key);
  }
  const byRow = new Map<string, AdvisorWork>();
  let unmatchedNative = 0;
  const add = (key: string, name: string, evidence: AdvisorWorkEvidence) => {
    const work = byRow.get(key) ?? {
      staffId,
      staffName: String(name ?? "").trim() || `Asesora ${staffId}`,
      evidence: [],
    };
    const old = work.evidence.find(
      (e) => e.source === evidence.source && e.kind === evidence.kind,
    );
    if (!old) work.evidence.push(evidence);
    else if (
      evidence.at &&
      (!old.at || Date.parse(evidence.at) > Date.parse(old.at))
    )
      old.at = evidence.at;
    byRow.set(key, work);
  };
  for (const event of events) {
    if (
      event.staff_id !== staffId ||
      !validId(event.staff_id) ||
      !timestamp(event.created_at)
    )
      continue;
    const kind: WorkKind | null =
      event.kind === "contacto" && event.outcome === "confirmado"
        ? "confirmation"
        : event.kind === "decision" && event.outcome === "autorizar_despacho"
          ? "dispatch_authorization"
          : null;
    if (!kind) continue;
    for (const key of Array.from(names.get(ref(event.order_name)) ?? []))
      add(key, event.staff_name, {
        source: "kairo",
        kind,
        at: event.created_at,
      });
  }
  for (const record of native) {
    const evidence: Array<{ name: string; value: AdvisorWorkEvidence }> = [];
    if (
      record.confirmed_by_staff_id === staffId &&
      validId(record.confirmed_by_staff_id)
    )
      evidence.push({
        name: record.confirmed_by_name,
        value: {
          source: "icomfly",
          kind: "confirmation",
          at: timestamp(record.confirmed_at),
        },
      });
    if (
      record.requested_by_staff_id === staffId &&
      validId(record.requested_by_staff_id)
    )
      evidence.push({
        name: record.requested_by_name,
        value: {
          source: "icomfly",
          kind: "dispatch_request",
          at: timestamp(record.requested_at),
        },
      });
    if (!evidence.length) continue;
    const direct = `shopify-icomfly-${record.icomfly_order_id}`;
    const keys = new Set<string>();
    if (byKey.has(direct)) keys.add(direct);
    else {
      const refs = [
        record.shopify_display_number,
        nombrePedidoIcomfly(
          record.order_number,
          record.icomfly_order_id,
          record.web_seq,
        ),
      ];
      for (const name of refs)
        for (const key of Array.from(names.get(ref(name)) ?? [])) keys.add(key);
      if (!keys.size) {
        const candidates = guides.get(ref(record.tracking_number));
        if (candidates?.size === 1)
          for (const key of Array.from(candidates)) keys.add(key);
      }
    }
    if (!keys.size) unmatchedNative += 1;
    for (const key of Array.from(keys))
      for (const item of evidence) add(key, item.name, item.value);
  }
  return { byRow, unmatchedNative };
}

export function advisorWorkActors(
  events: readonly ConfirmationEventRow[],
  agents: readonly { staff_id: number | null; name: string }[],
): ConfirmationActor[] {
  const actors = new Map<number, ConfirmationActor>();
  for (const agent of agents)
    if (validId(agent.staff_id))
      actors.set(agent.staff_id!, {
        id: agent.staff_id!,
        name: String(agent.name ?? "").trim() || `Asesora ${agent.staff_id}`,
      });
  for (const event of events)
    if (validId(event.staff_id))
      actors.set(event.staff_id!, {
        id: event.staff_id!,
        name:
          String(event.staff_name ?? "").trim() ||
          actors.get(event.staff_id!)?.name ||
          `Asesora ${event.staff_id}`,
      });
  return Array.from(actors.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  );
}
