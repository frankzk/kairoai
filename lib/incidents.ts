import { getDB } from "@/lib/db";
import { DEFAULT_FINANCE_STORE_ID } from "@/lib/store-config";
import { applyDetection, buildIncidentKey } from "@/lib/incidents-detect";

export * from "./incidents-types";
import type {
  DetectedIncident,
  Incident,
  IncidentCategory,
  IncidentEvent,
  IncidentEventKind,
  IncidentSource,
  IncidentStatus,
} from "./incidents-types";

export interface IncidentFilters {
  storeId?: number; // tienda (stores.id); se aplica siempre que venga
  status?: IncidentStatus;
  category?: IncidentCategory;
  source?: IncidentSource;
  search?: string;
  soloReintento?: boolean; // cola de "fin del dia" (status = sin_contestar)
}

export interface IncidentEventInput {
  kind: IncidentEventKind;
  from_status?: string;
  to_status?: string;
  message?: string;
  result?: "ok" | "error" | "info";
  metadata?: Record<string, unknown>;
}

function escapeOr(value: string): string {
  // PostgREST: comas y parentesis rompen el filtro .or(); se quitan del termino.
  return value.replace(/[,()]/g, " ").trim();
}

export async function listIncidents(filters: IncidentFilters = {}): Promise<Incident[]> {
  let query = getDB().from("incidents").select("*").order("updated_at", { ascending: false });
  if (filters.storeId) query = query.eq("store_id", filters.storeId);
  if (filters.soloReintento) query = query.eq("status", "sin_contestar");
  else if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.source) query = query.eq("source", filters.source);
  const q = escapeOr(filters.search ?? "");
  if (q) {
    query = query.or(
      `order_name.ilike.%${q}%,guide_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%`
    );
  }
  const { data, error } = await query.limit(2000);
  if (error) throw new Error(`listIncidents: ${error.message}`);
  return (data ?? []) as Incident[];
}

// Conjunto de claves existentes, para que la deteccion automatica descarte
// entregas ya confirmadas sin consultar fila por fila.
export async function listIncidentKeys(storeId: number): Promise<Set<string>> {
  const { data, error } = await getDB()
    .from("incidents")
    .select("incident_key")
    .eq("store_id", storeId)
    .limit(10000);
  if (error) throw new Error(`listIncidentKeys: ${error.message}`);
  const keys = new Set<string>();
  for (const row of (data ?? []) as Array<{ incident_key: string }>) keys.add(row.incident_key);
  return keys;
}

export async function getIncident(id: number): Promise<Incident | null> {
  const { data, error } = await getDB().from("incidents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getIncident: ${error.message}`);
  return (data as Incident | null) ?? null;
}

export async function listIncidentEvents(incidentId: number): Promise<IncidentEvent[]> {
  const { data, error } = await getDB()
    .from("incident_events")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listIncidentEvents: ${error.message}`);
  return (data ?? []) as IncidentEvent[];
}

export async function recordIncidentEvent(
  incidentId: number,
  event: IncidentEventInput
): Promise<void> {
  const { error } = await getDB().from("incident_events").insert({
    incident_id: incidentId,
    kind: event.kind,
    from_status: event.from_status ?? "",
    to_status: event.to_status ?? "",
    message: event.message ?? "",
    result: event.result ?? "ok",
    metadata: event.metadata ?? {},
  });
  if (error) throw new Error(`recordIncidentEvent: ${error.message}`);
}

// Alta manual de una novedad. Deriva la clave del envio; si no hay guia ni
// pedido usa una clave con timestamp para no colisionar con otras manuales.
export async function createIncident(input: Partial<Incident>): Promise<Incident> {
  const key =
    (input.incident_key && input.incident_key.trim()) ||
    buildIncidentKey(input.guide_number ?? "", input.order_name ?? "") ||
    `manual:ts:${Date.now()}`;
  const status = (input.status ?? "pendiente") as IncidentStatus;
  const payload = {
    store_id: input.store_id ?? DEFAULT_FINANCE_STORE_ID,
    incident_key: key,
    source: (input.source ?? "manual") as IncidentSource,
    order_name: input.order_name ?? "",
    guide_number: input.guide_number ?? "",
    shopify_order_id: input.shopify_order_id ?? "",
    customer_name: input.customer_name ?? "",
    customer_phone: input.customer_phone ?? "",
    courier: input.courier ?? "",
    cod_amount: Number(input.cod_amount ?? 0),
    category: (input.category ?? "otro") as IncidentCategory,
    status,
    detail: input.detail ?? "",
    notes: input.notes ?? "",
    manual_override: true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getDB().from("incidents").insert(payload).select().single();
  if (error) throw new Error(`createIncident: ${error.message}`);
  const incident = data as Incident;
  await recordIncidentEvent(incident.id, {
    kind: "detectada",
    to_status: status,
    message: "Novedad creada manualmente",
    result: "info",
  });
  return incident;
}

// Actualiza campos de una novedad y registra el evento que corresponda. Marca
// manual_override para que la deteccion automatica no la pise.
export async function patchIncident(
  id: number,
  patch: Partial<Incident>,
  event?: IncidentEventInput
): Promise<Incident> {
  const payload = { ...patch, manual_override: true, updated_at: new Date().toISOString() };
  const { data, error } = await getDB()
    .from("incidents")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`patchIncident: ${error.message}`);
  if (event) await recordIncidentEvent(id, event);
  return data as Incident;
}

// Endpoint PATCH: cambia estado/categoria/notas/telefono y registra el historial.
export async function updateIncident(
  id: number,
  updates: Partial<
    Pick<Incident, "status" | "category" | "notes" | "customer_phone" | "detail" | "reprogramada_para">
  >
): Promise<Incident> {
  const current = await getIncident(id);
  if (!current) throw new Error("updateIncident: novedad no encontrada");

  const updated = await patchIncident(id, updates);

  if (updates.status && updates.status !== current.status) {
    await recordIncidentEvent(id, {
      kind: "estado_cambiado",
      from_status: current.status,
      to_status: updates.status,
      message: "Estado actualizado manualmente",
    });
  }
  if (updates.category && updates.category !== current.category) {
    await recordIncidentEvent(id, {
      kind: "categoria_cambiada",
      message: `Causa: ${current.category} -> ${updates.category}`,
    });
  }
  return updated;
}

// Deteccion automatica idempotente: busca por incident_key y decide insertar,
// actualizar o ignorar via applyDetection (respeta gestion manual y terminales).
export async function upsertDetectedIncident(
  candidate: DetectedIncident
): Promise<{ incident: Incident | null; outcome: "created" | "updated" | "skipped" }> {
  if (!candidate.incident_key) return { incident: null, outcome: "skipped" };
  const db = getDB();
  const { data: existingRow, error: findError } = await db
    .from("incidents")
    .select("*")
    .eq("store_id", candidate.store_id)
    .eq("incident_key", candidate.incident_key)
    .maybeSingle();
  if (findError) throw new Error(`upsertDetectedIncident: ${findError.message}`);
  const existing = (existingRow as Incident | null) ?? null;

  const decision = applyDetection(existing, candidate);
  if (decision.action === "skip") return { incident: existing, outcome: "skipped" };

  const payload = { ...decision.patch, updated_at: new Date().toISOString() };

  if (decision.action === "insert") {
    const { data, error } = await db.from("incidents").insert(payload).select().single();
    if (error) throw new Error(`upsertDetectedIncident: ${error.message}`);
    const incident = data as Incident;
    if (decision.event) await recordIncidentEvent(incident.id, decision.event);
    return { incident, outcome: "created" };
  }

  // update
  const { data, error } = await db
    .from("incidents")
    .update(payload)
    .eq("id", existing!.id)
    .select()
    .single();
  if (error) throw new Error(`upsertDetectedIncident: ${error.message}`);
  if (decision.event) await recordIncidentEvent(existing!.id, decision.event);
  return { incident: data as Incident, outcome: "updated" };
}
