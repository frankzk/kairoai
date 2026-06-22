import { getDB } from "@/lib/db";
import { normalizeMatchKey } from "./order-matching";

export * from "./finance-types";
import type {
  BoxfulFileControl,
  PayrollStaff,
  BusinessExpense,
  ExpenseType,
  FinanceClaim,
  IcomflyAgentRecord,
  IcomflyOrderRecord,
  LogisticsImport,
  LogisticsRow,
  MoovinTrackingRow,
  PersistedShopifyOrder,
  ProductCost,
  ProductCostVersion,
  ProfitabilitySummary,
  SettlementImport,
  SettlementRow,
} from "./finance-types";

export async function listProductCosts(): Promise<ProductCost[]> {
  const { data, error } = await getDB()
    .from("product_costs")
    .select("*")
    .order("active", { ascending: false })
    .order("sku");
  if (error) throw new Error(`listProductCosts: ${error.message}`);
  return (data ?? []) as ProductCost[];
}

export async function listProductCostVersions(sku?: string): Promise<ProductCostVersion[]> {
  let query = getDB()
    .from("product_cost_versions")
    .select("*")
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (sku) query = query.eq("sku", sku.trim().toLowerCase());
  const { data, error } = await query;
  if (error) throw new Error(`listProductCostVersions: ${error.message}`);
  return (data ?? []) as ProductCostVersion[];
}

export async function upsertProductCost(
  input: Partial<ProductCost> & { sku: string }
): Promise<ProductCost> {
  const payload = {
    sku: input.sku.trim().toLowerCase(),
    product_name: input.product_name?.trim() ?? "",
    unit_cost: Number(input.unit_cost ?? 0),
    packaging_cost: Number(input.packaging_cost ?? 0),
    currency: input.currency ?? "CRC",
    effective_from: input.effective_from ?? new Date().toISOString().slice(0, 10),
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };

  // Upsert manual por sku: no depende de una restriccion UNIQUE en la tabla.
  // Algunas instancias se crearon sin ella (la tabla ya existia cuando 0002
  // declaro el UNIQUE), lo que rompia el ON CONFLICT (sku). Buscar-y-actualizar
  // funciona con o sin el indice unico.
  const db = getDB();
  const { data: existing, error: findError } = await db
    .from("product_costs")
    .select("id")
    .eq("sku", payload.sku)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) throw new Error(`upsertProductCost: ${findError.message}`);

  const writer = existing
    ? db
        .from("product_costs")
        .update(payload)
        .eq("id", (existing as { id: number }).id)
    : db.from("product_costs").insert(payload);
  const { data, error } = await writer.select().single();
  if (error) throw new Error(`upsertProductCost: ${error.message}`);

  const { error: versionError } = await getDB()
    .from("product_cost_versions")
    .insert({
      sku: payload.sku,
      product_name: payload.product_name,
      unit_cost: payload.unit_cost,
      packaging_cost: payload.packaging_cost,
      currency: payload.currency,
      effective_from: payload.effective_from,
    });
  if (versionError) {
    console.warn(`insertProductCostVersion: ${versionError.message}`);
  }

  return data as ProductCost;
}

export async function deleteProductCost(id: number): Promise<void> {
  const { error } = await getDB().from("product_costs").delete().eq("id", id);
  if (error) throw new Error(`deleteProductCost: ${error.message}`);
}

export async function listExpenses(type?: ExpenseType): Promise<BusinessExpense[]> {
  let query = getDB()
    .from("business_expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) throw new Error(`listExpenses: ${error.message}`);
  return (data ?? []) as BusinessExpense[];
}

export async function createExpense(
  input: Omit<BusinessExpense, "id" | "created_at" | "updated_at">
): Promise<BusinessExpense> {
  const payload = {
    ...input,
    amount: Number(input.amount ?? 0),
    currency: input.currency || "CRC",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getDB()
    .from("business_expenses")
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`createExpense: ${error.message}`);
  return data as BusinessExpense;
}

export async function updateExpense(
  id: number,
  updates: Partial<BusinessExpense>
): Promise<void> {
  const { error } = await getDB()
    .from("business_expenses")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`updateExpense: ${error.message}`);
}

export async function deleteExpense(id: number): Promise<void> {
  const { error } = await getDB().from("business_expenses").delete().eq("id", id);
  if (error) throw new Error(`deleteExpense: ${error.message}`);
}

export async function listSettlementImports(): Promise<SettlementImport[]> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listSettlementImports: ${error.message}`);
  return (data ?? []) as SettlementImport[];
}

export async function deleteSettlementImport(id: number): Promise<void> {
  const { error } = await getDB().from("settlement_imports").delete().eq("id", id);
  if (error) throw new Error(`deleteSettlementImport: ${error.message}`);
}

export async function createSettlementImport(
  input: Omit<SettlementImport, "id" | "created_at">
): Promise<SettlementImport> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(`createSettlementImport: ${error.message}`);
  return data as SettlementImport;
}

export async function insertSettlementRows(
  rows: Omit<SettlementRow, "id" | "created_at">[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await getDB().from("settlement_rows").insert(rows);
  if (error) throw new Error(`insertSettlementRows: ${error.message}`);
}

const SETTLEMENT_ROW_COLUMNS_BASE =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, service_type, cod_amount, cod_commission, card_commission, delivery_cost, pick_pack_cost, packaging_cost, amount_to_liquidate, settlement_status, internal_status, match_status, shopify_order_id, shopify_order_name, shopify_financial_status, shopify_fulfillment_status, shopify_total, shopify_created_at, order_items, created_at";
// first_name/last_name requieren la migracion 0005; si falta, se reintenta
// sin ellas.
let settlementNameColumnsMissing = false;

export async function listSettlementRows(importId?: number): Promise<SettlementRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() para devolver todas las filas.
  const pageSize = 1000;
  const all: SettlementRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const fetchPage = (withNames: boolean) => {
      let query = getDB()
        .from("settlement_rows")
        .select(withNames ? `${SETTLEMENT_ROW_COLUMNS_BASE}, first_name, last_name` : SETTLEMENT_ROW_COLUMNS_BASE)
        .order("created_on", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);
      if (importId) query = query.eq("import_id", importId);
      return query;
    };
    let { data, error } = await fetchPage(!settlementNameColumnsMissing);
    if (error && !settlementNameColumnsMissing && isMissingColumnError(error.message)) {
      settlementNameColumnsMissing = true;
      ({ data, error } = await fetchPage(false));
    }
    if (error) throw new Error(`listSettlementRows: ${error.message}`);
    const page = (data ?? []) as unknown as SettlementRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function listLogisticsImports(): Promise<LogisticsImport[]> {
  const { data, error } = await getDB()
    .from("logistics_imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listLogisticsImports: ${error.message}`);
  return (data ?? []) as LogisticsImport[];
}

export async function createLogisticsImport(
  input: Omit<LogisticsImport, "id" | "created_at">
): Promise<LogisticsImport> {
  const { data, error } = await getDB()
    .from("logistics_imports")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(`createLogisticsImport: ${error.message}`);
  return data as LogisticsImport;
}

export async function deleteLogisticsImport(id: number): Promise<void> {
  const { error } = await getDB().from("logistics_imports").delete().eq("id", id);
  if (error) throw new Error(`deleteLogisticsImport: ${error.message}`);
}

export async function insertLogisticsRows(
  rows: Omit<LogisticsRow, "id" | "created_at">[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await getDB().from("logistics_rows").insert(rows);
  if (error) throw new Error(`insertLogisticsRows: ${error.message}`);
}

const LOGISTICS_ROW_COLUMNS_BASE =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, boxful_status, internal_status, match_status, service_type, cod_amount, cod_commission, delivery_cost, total_cost, liquidated_on, finalized_on, label_url, package_items, shopify_order_id, shopify_order_name, shopify_order_number, shopify_financial_status, shopify_fulfillment_status, shopify_cancelled_at, shopify_total, shopify_created_at, created_at";
let logisticsNameColumnsMissing = false;

export async function listLogisticsRows(importId?: number): Promise<LogisticsRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() para devolver todas las filas.
  const pageSize = 1000;
  const all: LogisticsRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const fetchPage = (withNames: boolean) => {
      let query = getDB()
        .from("logistics_rows")
        .select(withNames ? `${LOGISTICS_ROW_COLUMNS_BASE}, first_name, last_name` : LOGISTICS_ROW_COLUMNS_BASE)
        .order("created_on", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);
      if (importId) query = query.eq("import_id", importId);
      return query;
    };
    let { data, error } = await fetchPage(!logisticsNameColumnsMissing);
    if (error && !logisticsNameColumnsMissing && isMissingColumnError(error.message)) {
      logisticsNameColumnsMissing = true;
      ({ data, error } = await fetchPage(false));
    }
    if (error) throw new Error(`listLogisticsRows: ${error.message}`);
    const page = (data ?? []) as unknown as LogisticsRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

// Sin raw_order completo: las lineas y notas se resuelven aca para que la
// respuesta con miles de pedidos no se dispare de tamano.
// Camino rapido: columnas planas (requiere la migracion 0003). Extraer campos
// de raw_order detoastea el JSONB completo por fila y revienta el statement
// timeout de Postgres con 10k+ pedidos, asi que solo se usa como fallback
// mientras la migracion no este aplicada.
// Tier 0: columnas planas con nombre/apellido (requiere migraciones 0003 y 0005).
const PERSISTED_NAMES_BASE =
  "id, shopify_order_id, order_number, name, customer_name, first_name, last_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note, note_attributes";

// Tier 0: todo plano, incluye tracking del fulfillment (requiere 0007).
const PERSISTED_ORDER_SUMMARY_COLUMNS_FAST = `${PERSISTED_NAMES_BASE}, tracking_number, tracking_company`;

// Tier 1: nombres pero sin tracking (0005 si, 0007 no). Sigue siendo rapido.
const PERSISTED_ORDER_SUMMARY_COLUMNS_NAMES = PERSISTED_NAMES_BASE;

// Tier 2: nota plana sin nombres ni tracking (0003 si, 0005 no).
const PERSISTED_ORDER_SUMMARY_COLUMNS_NOTE_ONLY =
  "id, shopify_order_id, order_number, name, customer_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note, note_attributes";

// Tier 3: extraccion de raw_order (pre-0003). Lento; solo como ultimo recurso.
const PERSISTED_ORDER_SUMMARY_COLUMNS_LEGACY =
  "id, shopify_order_id, order_number, name, customer_name, first_name:raw_order->'customer'->>first_name, last_name:raw_order->'customer'->>last_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note:raw_order->>note, note_attributes:raw_order->note_attributes, raw_line_items:raw_order->line_items";

const PERSISTED_TIERS = [
  PERSISTED_ORDER_SUMMARY_COLUMNS_FAST,
  PERSISTED_ORDER_SUMMARY_COLUMNS_NAMES,
  PERSISTED_ORDER_SUMMARY_COLUMNS_NOTE_ONLY,
  PERSISTED_ORDER_SUMMARY_COLUMNS_LEGACY,
];
let persistedTier = 0;

function isMissingColumnError(message: string): boolean {
  return /does not exist|42703/.test(message);
}

export interface PersistedShopifyOrderSummary
  extends Omit<PersistedShopifyOrder, "raw_order"> {
  note: string;
  note_attributes: Array<{ name?: string | null; value?: string | null }>;
}

export async function listPersistedShopifyOrders(limit = 1000, offset = 0): Promise<PersistedShopifyOrderSummary[]> {
  type RawSummary = PersistedShopifyOrderSummary & {
    raw_line_items: Array<Record<string, unknown>> | null;
  };
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() hasta el limite pedido.
  const pageSize = 1000;
  const rows: RawSummary[] = [];
  const safeLimit = Math.max(Math.floor(limit), 0);
  const safeOffset = Math.max(Math.floor(offset), 0);
  for (let fetched = 0; fetched < safeLimit; fetched += pageSize) {
    const from = safeOffset + fetched;
    const to = safeOffset + Math.min(fetched + pageSize, safeLimit) - 1;
    const fetchPage = (columns: string) =>
      getDB()
        .from("shopify_orders")
        .select(columns)
        .order("shopify_created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .range(from, to);

    let result = await fetchPage(PERSISTED_TIERS[persistedTier]);
    // Si falta una columna de una migracion no aplicada, baja al siguiente
    // tier (sigue siendo rapido hasta el ultimo, que ya extrae de raw_order).
    while (result.error && isMissingColumnError(result.error.message) && persistedTier < PERSISTED_TIERS.length - 1) {
      persistedTier += 1;
      result = await fetchPage(PERSISTED_TIERS[persistedTier]);
    }
    if (result.error) throw new Error(`listPersistedShopifyOrders: ${result.error.message}`);
    const page = (result.data ?? []) as unknown as RawSummary[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(({ raw_line_items, ...order }) => ({
    ...order,
    note: order.note ?? "",
    note_attributes: order.note_attributes ?? [],
    // Filas sincronizadas antes de que existiera la columna line_items la
    // tienen vacia; el pedido crudo siempre trae las lineas.
    line_items: order.line_items?.length
      ? order.line_items
      : (raw_line_items ?? []).map((item) => ({
          sku: String(item.sku ?? ""),
          title: String(item.title ?? ""),
          quantity: Number(item.quantity ?? 0),
          price: Number(item.price ?? 0),
        })),
  }));
}

export interface PersistedShopifyCoverage {
  count: number;
  oldest: string | null;
  newest: string | null;
}

export async function getPersistedShopifyCoverage(): Promise<PersistedShopifyCoverage> {
  const db = getDB();
  const [countRes, oldestRes, newestRes] = await Promise.all([
    db.from("shopify_orders").select("id", { count: "exact", head: true }),
    db
      .from("shopify_orders")
      .select("shopify_created_at")
      .not("shopify_created_at", "is", null)
      .order("shopify_created_at", { ascending: true })
      .limit(1),
    db
      .from("shopify_orders")
      .select("shopify_created_at")
      .not("shopify_created_at", "is", null)
      .order("shopify_created_at", { ascending: false })
      .limit(1),
  ]);
  if (countRes.error) throw new Error(`getPersistedShopifyCoverage: ${countRes.error.message}`);
  return {
    count: countRes.count ?? 0,
    oldest: (oldestRes.data?.[0]?.shopify_created_at as string | undefined) ?? null,
    newest: (newestRes.data?.[0]?.shopify_created_at as string | undefined) ?? null,
  };
}

export async function upsertPersistedShopifyOrders(
  orders: Omit<PersistedShopifyOrder, "id" | "synced_at">[]
): Promise<void> {
  if (!orders.length) return;
  const payload = orders.map((order) => ({
    ...order,
    synced_at: new Date().toISOString(),
  }));
  let { error } = await getDB()
    .from("shopify_orders")
    .upsert(payload, { onConflict: "shopify_order_id" });
  if (error && isMissingColumnError(error.message)) {
    // Migraciones 0003/0005 no aplicadas aun: quita las columnas opcionales
    // (note/note_attributes/first_name/last_name) y reintenta.
    const legacyPayload = payload.map(
      ({
        note: _note,
        note_attributes: _attrs,
        first_name: _fn,
        last_name: _ln,
        tracking_number: _tn,
        tracking_company: _tc,
        ...rest
      }) => rest
    );
    ({ error } = await getDB()
      .from("shopify_orders")
      .upsert(legacyPayload, { onConflict: "shopify_order_id" }));
  }
  if (error) throw new Error(`upsertPersistedShopifyOrders: ${error.message}`);
}

export async function listFinanceClaims(): Promise<FinanceClaim[]> {
  const { data, error } = await getDB()
    .from("finance_claims")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listFinanceClaims: ${error.message}`);
  return (data ?? []) as FinanceClaim[];
}

export async function upsertFinanceClaim(
  input: Partial<FinanceClaim> & { anomaly_key: string }
): Promise<FinanceClaim> {
  const payload = {
    anomaly_key: input.anomaly_key,
    order_name: input.order_name ?? "",
    guide_number: input.guide_number ?? "",
    type: input.type ?? "",
    status: input.status ?? "pendiente",
    amount: Number(input.amount ?? 0),
    source_file: input.source_file ?? "",
    notes: input.notes ?? "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getDB()
    .from("finance_claims")
    .upsert(payload, { onConflict: "anomaly_key" })
    .select()
    .single();
  if (error) throw new Error(`upsertFinanceClaim: ${error.message}`);
  return data as FinanceClaim;
}

export async function listBoxfulFileControls(): Promise<BoxfulFileControl[]> {
  const { data, error } = await getDB()
    .from("boxful_file_controls")
    .select("*")
    .order("cutoff_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBoxfulFileControls: ${error.message}`);
  return (data ?? []) as BoxfulFileControl[];
}

export async function upsertBoxfulFileControl(
  input: Partial<BoxfulFileControl> & { file_name: string; file_type: "logistica" | "liquidacion" }
): Promise<BoxfulFileControl> {
  const payload = {
    file_name: input.file_name,
    file_type: input.file_type,
    cutoff_date: input.cutoff_date ?? null,
    status: input.status ?? "importado",
    import_id: input.import_id ?? null,
    notes: input.notes ?? "",
    imported_at: input.imported_at ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getDB()
    .from("boxful_file_controls")
    .upsert(payload, { onConflict: "file_name" })
    .select()
    .single();
  if (error) throw new Error(`upsertBoxfulFileControl: ${error.message}`);
  return data as BoxfulFileControl;
}

export async function getProfitabilitySummary(): Promise<ProfitabilitySummary> {
  const [rows, costs, expenses] = await Promise.all([
    listSettlementRows(),
    listProductCosts(),
    listExpenses(),
  ]);

  const costBySku = new Map<string, ProductCost>();
  for (const cost of costs.filter((item) => item.active)) {
    costBySku.set(cost.sku.toLowerCase(), cost);
    const titleKey = getProductCostKey({ title: cost.product_name });
    if (titleKey && !costBySku.has(titleKey)) costBySku.set(titleKey, cost);
  }
  const missingCostSkus = new Set<string>();

  const codCollected = sum(rows.map((row) => row.cod_amount));
  const codCommission = sum(rows.map((row) => row.cod_commission));
  const cardCommission = sum(rows.map((row) => row.card_commission));
  const deliveryCost = sum(rows.map((row) => row.delivery_cost));
  const pickPackCost = sum(rows.map((row) => row.pick_pack_cost));
  const settlementPackagingCost = sum(rows.map((row) => row.packaging_cost));
  const settlementChargedCosts =
    codCommission + deliveryCost + pickPackCost + settlementPackagingCost;
  const settlementTotal = sum(rows.map((row) => row.amount_to_liquidate));
  let productCosts = 0;

  for (const row of rows) {
    if (row.internal_status !== "delivered") continue;
    for (const item of row.order_items ?? []) {
      const costKey = getProductCostKey(item);
      if (!costKey) continue;
      const cost = costBySku.get(costKey);
      if (!cost) {
        missingCostSkus.add(costKey);
        continue;
      }
      productCosts += (cost.unit_cost + cost.packaging_cost) * Number(item.quantity || 0);
    }
  }

  const ads = sum(expenses.filter((e) => e.type === "ads").map((e) => e.amount));
  const payroll = sum(expenses.filter((e) => e.type === "payroll").map((e) => e.amount));
  const misc = sum(expenses.filter((e) => e.type === "misc").map((e) => e.amount));

  return {
    cod_collected: roundMoney(codCollected),
    cod_commission: roundMoney(codCommission),
    card_commission: roundMoney(cardCommission),
    delivery_cost: roundMoney(deliveryCost),
    pick_pack_cost: roundMoney(pickPackCost),
    settlement_packaging_cost: roundMoney(settlementPackagingCost),
    settlement_charged_costs: roundMoney(settlementChargedCosts),
    settlement_total: roundMoney(settlementTotal),
    product_costs: roundMoney(productCosts),
    ads: roundMoney(ads),
    payroll: roundMoney(payroll),
    misc: roundMoney(misc),
    net_profit: roundMoney(settlementTotal - productCosts - ads - payroll - misc),
    delivered_orders: rows.filter((r) => r.internal_status === "delivered").length,
    not_delivered_orders: rows.filter((r) => r.internal_status === "not_delivered" || r.internal_status === "returned").length,
    unmatched_orders: rows.filter((r) => r.match_status === "unmatched").length,
    matched_orders: rows.filter((r) => r.match_status === "matched").length,
    missing_cost_skus: Array.from(missingCostSkus).slice(0, 100),
  };
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getProductCostKey(item: { sku?: string | null; title?: string | null }): string {
  const sku = String(item.sku || "").trim().toLowerCase();
  if (sku) return sku;

  const cleanTitle = String(item.title || "")
    .replace(/^\s*\d+\s*x\s*/i, "")
    .trim();
  if (!cleanTitle || cleanTitle === "Producto sin registrar") return "";

  const slug = cleanTitle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug ? `producto:${slug}` : "";
}

export async function listPayrollStaff(): Promise<PayrollStaff[]> {
  const { data, error } = await getDB()
    .from("payroll_staff")
    .select("*")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`listPayrollStaff: ${error.message}`);
  return (data ?? []) as PayrollStaff[];
}

export async function createPayrollStaff(input: { name: string; role: string }): Promise<PayrollStaff> {
  const { data, error } = await getDB()
    .from("payroll_staff")
    .insert({ name: input.name, role: input.role, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw new Error(`createPayrollStaff: ${error.message}`);
  return data as PayrollStaff;
}

export async function deletePayrollStaff(id: number): Promise<void> {
  const { error } = await getDB().from("payroll_staff").delete().eq("id", id);
  if (error) throw new Error(`deletePayrollStaff: ${error.message}`);
}

// Enriquecer el enlace de una persona de la planilla con su identidad de iComfly.
export async function updatePayrollStaffIcomfly(
  id: number,
  patch: { email?: string | null; icomfly_user_id?: number | null }
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.icomfly_user_id !== undefined) payload.icomfly_user_id = patch.icomfly_user_id;
  const { error } = await getDB().from("payroll_staff").update(payload).eq("id", id);
  if (error) throw new Error(`updatePayrollStaffIcomfly: ${error.message}`);
}

// ─── iComfly: pedidos con estado de despacho (migracion 0010) ────────────────

export async function listIcomflyOrders(
  opts: { storeId?: number; limit?: number } = {}
): Promise<IcomflyOrderRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 50000);
  const pageSize = 1000;
  const all: IcomflyOrderRecord[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    let query = getDB()
      .from("icomfly_orders")
      .select("*")
      .order("requested_at", { ascending: false, nullsFirst: false })
      .range(from, Math.min(from + pageSize, limit) - 1);
    if (opts.storeId != null) query = query.eq("store_id", opts.storeId);
    const { data, error } = await query;
    if (error) throw new Error(`listIcomflyOrders: ${error.message}`);
    const page = (data ?? []) as IcomflyOrderRecord[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function upsertIcomflyOrders(
  rows: Array<Omit<IcomflyOrderRecord, "synced_at">>
): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((row) => ({ ...row, synced_at: new Date().toISOString() }));
  const { error } = await getDB()
    .from("icomfly_orders")
    .upsert(payload, { onConflict: "store_id,icomfly_order_id" });
  if (error) throw new Error(`upsertIcomflyOrders: ${error.message}`);
}

export async function listIcomflyAgents(storeId?: number): Promise<IcomflyAgentRecord[]> {
  let query = getDB().from("icomfly_agents").select("*").order("name");
  if (storeId != null) query = query.eq("store_id", storeId);
  const { data, error } = await query;
  if (error) throw new Error(`listIcomflyAgents: ${error.message}`);
  return (data ?? []) as IcomflyAgentRecord[];
}

export async function upsertIcomflyAgents(
  rows: Array<Omit<IcomflyAgentRecord, "synced_at">>
): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((row) => ({ ...row, synced_at: new Date().toISOString() }));
  const { error } = await getDB()
    .from("icomfly_agents")
    .upsert(payload, { onConflict: "store_id,user_id" });
  if (error) throw new Error(`upsertIcomflyAgents: ${error.message}`);
}

// Claves de pedido (normalizeMatchKey) que ya tienen guia en la data de Boxful
// importada (logistics_rows con guide_number). Senal de respaldo de guia final.
export async function getDispatchedBoxfulKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await getDB()
      .from("logistics_rows")
      .select("order_name, guide_number")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getDispatchedBoxfulKeys: ${error.message}`);
    const page = (data ?? []) as Array<{ order_name: string | null; guide_number: string | null }>;
    for (const row of page) {
      if (!row.guide_number) continue;
      const key = normalizeMatchKey(row.order_name ?? "");
      if (key) keys.add(key);
    }
    if (page.length < pageSize) break;
  }
  return keys;
}

export async function listMoovinTracking(): Promise<MoovinTrackingRow[]> {
  const pageSize = 1000;
  const all: MoovinTrackingRow[] = [];
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await getDB()
      .from("moovin_tracking")
      .select("*")
      .order("checked_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`listMoovinTracking: ${error.message}`);
    const page = (data ?? []) as MoovinTrackingRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function upsertMoovinTracking(
  rows: Omit<MoovinTrackingRow, "checked_at">[]
): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((row) => ({ ...row, checked_at: new Date().toISOString() }));
  const { error } = await getDB()
    .from("moovin_tracking")
    .upsert(payload, { onConflict: "id_package" });
  if (error) throw new Error(`upsertMoovinTracking: ${error.message}`);
}

// Guias ya consultadas dentro de la ventana fresca (no hace falta reconsultar).
export async function getRecentlyCheckedMoovinPackages(maxAgeMinutes: number): Promise<Set<string>> {
  const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
  const fresh = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await getDB()
      .from("moovin_tracking")
      .select("id_package")
      .gte("checked_at", since)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getRecentlyCheckedMoovinPackages: ${error.message}`);
    const page = (data ?? []) as Array<{ id_package: string }>;
    for (const row of page) fresh.add(row.id_package);
    if (page.length < pageSize) break;
  }
  return fresh;
}

// Candidatos a sincronizar con Moovin desde el servidor (para el cron): guias
// Moovin que aun no estan en estado terminal (entregado/devuelto) en la cache
// y que no se consultaron dentro de la ventana fresca.
export async function listMoovinSyncCandidates(
  limit: number,
  freshWindowMinutes: number
): Promise<Array<{ idPackage: string; lastName: string }>> {
  // 1) Guias Moovin con guia, desde logistics_rows.
  const byGuide = new Map<string, string>();
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await getDB()
      .from("logistics_rows")
      .select("guide_number, last_name, courier")
      .ilike("courier", "%moovin%")
      .neq("guide_number", "")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`listMoovinSyncCandidates: ${error.message}`);
    const page = (data ?? []) as Array<{ guide_number: string; last_name: string | null }>;
    for (const row of page) {
      if (row.guide_number && !byGuide.has(row.guide_number)) {
        byGuide.set(row.guide_number, row.last_name ?? "");
      }
    }
    if (page.length < pageSize) break;
  }

  // 2) Excluir terminales en cache (entregado/devuelto) y los frescos.
  const terminal = new Set<string>();
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await getDB()
      .from("moovin_tracking")
      .select("id_package, latest_group, checked_at")
      .in("latest_group", ["delivered", "returned"])
      .range(from, from + pageSize - 1);
    if (error) break;
    const page = (data ?? []) as Array<{ id_package: string }>;
    for (const row of page) terminal.add(row.id_package);
    if (page.length < pageSize) break;
  }
  const fresh = await getRecentlyCheckedMoovinPackages(freshWindowMinutes);

  const candidates: Array<{ idPackage: string; lastName: string }> = [];
  for (const [guide, lastName] of Array.from(byGuide.entries())) {
    if (terminal.has(guide) || fresh.has(guide)) continue;
    candidates.push({ idPackage: guide, lastName });
    if (candidates.length >= limit) break;
  }
  return candidates;
}
