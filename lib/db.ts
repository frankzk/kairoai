import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─── Client (lazy singleton) ──────────────────────────────────────────────────

let _db: SupabaseClient | null = null;

function getDB(): SupabaseClient {
  if (!_db) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    _db = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return _db;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CallRecord {
  call_id: string;
  order_id: string;
  phone: string;
  customer_name: string;
  products: string;
  total: string;
  country: string;
  status:
    | "calling"
    | "confirmed"
    | "cancelled"
    | "no_answer"
    | "upsell_accepted"
    | "error";
  upsell_accepted: boolean;
  duration_seconds: number;
  started_at: string;
  ended_at?: string;
  notes?: string;
}

export interface DailyStats {
  total: number;
  confirmed: number;
  cancelled: number;
  no_answer: number;
  upsells: number;
}

// ─── Call Records ─────────────────────────────────────────────────────────────

export async function saveCallRecord(record: CallRecord): Promise<void> {
  const { error } = await getDB().from("calls").insert(record);
  if (error) throw new Error(`saveCallRecord: ${error.message}`);
}

export async function updateCallRecord(
  callId: string,
  updates: Partial<CallRecord>
): Promise<void> {
  const { error } = await getDB()
    .from("calls")
    .update(updates)
    .eq("call_id", callId);
  if (error) throw new Error(`updateCallRecord: ${error.message}`);
}

export async function getRecentCalls(limit = 50): Promise<CallRecord[]> {
  const { data, error } = await getDB()
    .from("calls")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecentCalls: ${error.message}`);
  return (data ?? []) as CallRecord[];
}

// ─── Stats (derivadas de la tabla calls) ──────────────────────────────────────

export async function getTodayStats(): Promise<DailyStats> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await getDB()
    .from("calls")
    .select("status, upsell_accepted")
    .gte("started_at", `${today}T00:00:00Z`)
    .lte("started_at", `${today}T23:59:59Z`);

  if (error) throw new Error(`getTodayStats: ${error.message}`);
  const rows = data ?? [];

  return {
    total: rows.length,
    confirmed: rows.filter(
      (r) => r.status === "confirmed" || r.status === "upsell_accepted"
    ).length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    no_answer: rows.filter((r) => r.status === "no_answer").length,
    upsells: rows.filter((r) => r.upsell_accepted === true).length,
  };
}

// No-op por compatibilidad — stats se derivan de la tabla calls
export async function incrementStat(_field: string): Promise<void> {}

// ─── Deduplicación ────────────────────────────────────────────────────────────

function buildDedupKey(phone: string, orderId: string): string {
  return `${phone}:${orderId}`;
}

/** Devuelve true si ya existe una entrada vigente (dentro de las 24h) */
export async function checkDedup(
  phone: string,
  orderId: string
): Promise<boolean> {
  const { data } = await getDB()
    .from("call_dedup")
    .select("key")
    .eq("key", buildDedupKey(phone, orderId))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data !== null;
}

/** Registra el par phone+order como llamado (TTL 24h) */
export async function setDedup(
  phone: string,
  orderId: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await getDB()
    .from("call_dedup")
    .upsert({ key: buildDedupKey(phone, orderId), expires_at: expiresAt });
  if (error) throw new Error(`setDedup: ${error.message}`);
}

/** Elimina la entrada de dedup (permite reintentar) */
export async function deleteDedup(
  phone: string,
  orderId: string
): Promise<void> {
  await getDB()
    .from("call_dedup")
    .delete()
    .eq("key", buildDedupKey(phone, orderId));
}

// ─── Cola de reintentos ───────────────────────────────────────────────────────

export async function scheduleRetry(
  phone: string,
  orderId: string,
  scheduledAtMs: number
): Promise<void> {
  const { error } = await getDB().from("retry_queue").insert({
    phone,
    order_id: orderId,
    scheduled_at: new Date(scheduledAtMs).toISOString(),
  });
  if (error) throw new Error(`scheduleRetry: ${error.message}`);
}

// ─── Upsell Rules ─────────────────────────────────────────────────────────────

export interface UpsellRuleDB {
  id: number;
  trigger_sku: string;
  upsell_sku: string;
  upsell_name: string;
  upsell_price: number; // ₡ Colones
  pitch: string;
  tier: "S" | "A" | "B";
  active: boolean;
  created_at: string;
}

export async function getUpsellRules(activeOnly = true): Promise<UpsellRuleDB[]> {
  let query = getDB()
    .from("upsell_rules")
    .select("*")
    .order("tier")
    .order("created_at");
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw new Error(`getUpsellRules: ${error.message}`);
  return (data ?? []) as UpsellRuleDB[];
}

export async function createUpsellRule(
  rule: Omit<UpsellRuleDB, "id" | "created_at">
): Promise<UpsellRuleDB> {
  const { data, error } = await getDB()
    .from("upsell_rules")
    .insert(rule)
    .select()
    .single();
  if (error) throw new Error(`createUpsellRule: ${error.message}`);
  return data as UpsellRuleDB;
}

export async function updateUpsellRule(
  id: number,
  updates: Partial<Omit<UpsellRuleDB, "id" | "created_at">>
): Promise<void> {
  const { error } = await getDB()
    .from("upsell_rules")
    .update(updates)
    .eq("id", id);
  if (error) throw new Error(`updateUpsellRule: ${error.message}`);
}

export async function deleteUpsellRule(id: number): Promise<void> {
  const { error } = await getDB().from("upsell_rules").delete().eq("id", id);
  if (error) throw new Error(`deleteUpsellRule: ${error.message}`);
}

/** Finds the best matching upsell rule for a trigger SKU (highest tier = S > A > B) */
export async function findBestUpsellRule(
  triggerSku: string
): Promise<UpsellRuleDB | null> {
  const tierOrder = { S: 0, A: 1, B: 2 };
  const rules = await getUpsellRules(true);
  const matches = rules.filter(
    (r) => r.trigger_sku.toLowerCase() === triggerSku.toLowerCase()
  );
  if (!matches.length) return null;
  return matches.sort(
    (a, b) => tierOrder[a.tier] - tierOrder[b.tier]
  )[0];
}

/** Formats all active rules for injection into the agent system prompt */
export function formatRulesForPrompt(rules: UpsellRuleDB[]): string {
  if (!rules.length) return "No hay reglas de upsell configuradas.";
  const byTier: Record<string, UpsellRuleDB[]> = { S: [], A: [], B: [] };
  for (const r of rules) byTier[r.tier].push(r);
  const label = { S: "ALTA conversión (>20%)", A: "MEDIA (10-20%)", B: "BUENA (5-10%)" };
  return (["S", "A", "B"] as const)
    .filter((t) => byTier[t].length)
    .map(
      (t) =>
        `### Tier ${t} — ${label[t]}\n` +
        byTier[t]
          .map(
            (r) =>
              `- Trigger SKU "${r.trigger_sku}" → ofrecer "${r.upsell_name}" (SKU: ${r.upsell_sku}) a ₡${r.upsell_price.toLocaleString("es-CR")}. Pitch: "${r.pitch}"`
          )
          .join("\n")
    )
    .join("\n\n");
}
