import { getDB } from "@/lib/db";

export type ExpenseType = "ads" | "payroll" | "misc";
export type InternalOrderStatus =
  | "delivered"
  | "not_delivered"
  | "returned"
  | "annulled"
  | "pending"
  | "unmatched";

export interface ProductCost {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  effective_from: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductCostVersion {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  effective_from: string;
  created_at: string;
}

export interface BusinessExpense {
  id: number;
  type: ExpenseType;
  expense_date: string;
  month: string;
  platform: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SettlementImport {
  id: number;
  file_name: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  total_collected: number;
  total_to_liquidate: number;
  status_summary: Record<string, { count: number; amount_to_liquidate: number }>;
  created_at: string;
}

export interface SettlementOrderItem {
  sku: string;
  title: string;
  quantity: number;
  price: number;
}

export interface SettlementRow {
  id: number;
  import_id: number;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  card_commission: number;
  delivery_cost: number;
  pick_pack_cost: number;
  packaging_cost: number;
  amount_to_liquidate: number;
  settlement_status: string;
  internal_status: InternalOrderStatus;
  match_status: "matched" | "unmatched";
  shopify_order_id: string;
  shopify_order_name: string;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_total: number;
  shopify_created_at: string | null;
  order_items: SettlementOrderItem[];
  // Guardado al importar; las lecturas lo omiten para no inflar la respuesta.
  raw_row?: Record<string, unknown>;
  created_at: string;
}

export interface LogisticsPackageItem {
  title: string;
  quantity: number;
  price: number;
}

export interface LogisticsImport {
  id: number;
  file_name: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  status_summary: Record<string, { count: number }>;
  created_at: string;
}

export interface LogisticsRow {
  id: number;
  import_id: number;
  guide_number: string;
  order_name: string;
  store_order_number: string;
  customer_name: string;
  customer_phone: string;
  created_on: string | null;
  courier: string;
  boxful_status: string;
  internal_status: InternalOrderStatus;
  match_status: "matched" | "unmatched";
  service_type: string;
  cod_amount: number;
  cod_commission: number;
  delivery_cost: number;
  total_cost: number;
  liquidated_on: string | null;
  finalized_on: string | null;
  label_url: string;
  package_items: LogisticsPackageItem[];
  shopify_order_id: string;
  shopify_order_name: string;
  shopify_order_number: number | null;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_cancelled_at: string | null;
  shopify_total: number;
  shopify_created_at: string | null;
  // Guardado al importar; las lecturas lo omiten para no inflar la respuesta.
  raw_row?: Record<string, unknown>;
  created_at: string;
}

export interface PersistedShopifyOrder {
  id: number;
  shopify_order_id: string;
  order_number: number | null;
  name: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  financial_status: string;
  fulfillment_status: string;
  cancelled_at: string | null;
  total_price: number;
  currency: string;
  line_items: Array<{ sku: string; title: string; quantity: number; price: number }>;
  raw_order: Record<string, unknown>;
  shopify_created_at: string | null;
  shopify_updated_at: string | null;
  synced_at: string;
}

export interface FinanceClaim {
  id: number;
  anomaly_key: string;
  order_name: string;
  guide_number: string;
  type: string;
  status: "pendiente" | "reclamado" | "resuelto" | "descartado";
  amount: number;
  source_file: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface BoxfulFileControl {
  id: number;
  file_name: string;
  file_type: "logistica" | "liquidacion";
  cutoff_date: string | null;
  status: "esperado" | "importado" | "faltante" | "ignorado";
  import_id: number | null;
  notes: string;
  imported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfitabilitySummary {
  cod_collected: number;
  cod_commission: number;
  card_commission: number;
  delivery_cost: number;
  pick_pack_cost: number;
  settlement_packaging_cost: number;
  settlement_charged_costs: number;
  settlement_total: number;
  product_costs: number;
  ads: number;
  payroll: number;
  misc: number;
  net_profit: number;
  delivered_orders: number;
  not_delivered_orders: number;
  unmatched_orders: number;
  matched_orders: number;
  missing_cost_skus: string[];
}

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

  const { data, error } = await getDB()
    .from("product_costs")
    .upsert(payload, { onConflict: "sku" })
    .select()
    .single();
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

const SETTLEMENT_ROW_COLUMNS =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, service_type, cod_amount, cod_commission, card_commission, delivery_cost, pick_pack_cost, packaging_cost, amount_to_liquidate, settlement_status, internal_status, match_status, shopify_order_id, shopify_order_name, shopify_financial_status, shopify_fulfillment_status, shopify_total, shopify_created_at, order_items, created_at";

export async function listSettlementRows(importId?: number): Promise<SettlementRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() para devolver todas las filas.
  const pageSize = 1000;
  const all: SettlementRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    let query = getDB()
      .from("settlement_rows")
      .select(SETTLEMENT_ROW_COLUMNS)
      .order("created_on", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (importId) query = query.eq("import_id", importId);
    const { data, error } = await query;
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

const LOGISTICS_ROW_COLUMNS =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, boxful_status, internal_status, match_status, service_type, cod_amount, cod_commission, delivery_cost, total_cost, liquidated_on, finalized_on, label_url, package_items, shopify_order_id, shopify_order_name, shopify_order_number, shopify_financial_status, shopify_fulfillment_status, shopify_cancelled_at, shopify_total, shopify_created_at, created_at";

export async function listLogisticsRows(importId?: number): Promise<LogisticsRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() para devolver todas las filas.
  const pageSize = 1000;
  const all: LogisticsRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    let query = getDB()
      .from("logistics_rows")
      .select(LOGISTICS_ROW_COLUMNS)
      .order("created_on", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (importId) query = query.eq("import_id", importId);
    const { data, error } = await query;
    if (error) throw new Error(`listLogisticsRows: ${error.message}`);
    const page = (data ?? []) as unknown as LogisticsRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

// Sin raw_order completo: las lineas y notas se resuelven aca para que la
// respuesta con miles de pedidos no se dispare de tamano.
const PERSISTED_ORDER_SUMMARY_COLUMNS =
  "id, shopify_order_id, order_number, name, customer_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note:raw_order->>note, note_attributes:raw_order->note_attributes, raw_line_items:raw_order->line_items";

export interface PersistedShopifyOrderSummary
  extends Omit<PersistedShopifyOrder, "raw_order"> {
  note: string;
  note_attributes: Array<{ name?: string | null; value?: string | null }>;
}

export async function listPersistedShopifyOrders(limit = 1000): Promise<PersistedShopifyOrderSummary[]> {
  type RawSummary = PersistedShopifyOrderSummary & {
    raw_line_items: Array<Record<string, unknown>> | null;
  };
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range() hasta el limite pedido.
  const pageSize = 1000;
  const rows: RawSummary[] = [];
  for (let from = 0; from < limit; from += pageSize) {
    const { data, error } = await getDB()
      .from("shopify_orders")
      .select(PERSISTED_ORDER_SUMMARY_COLUMNS)
      .order("shopify_created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, Math.min(from + pageSize, limit) - 1);
    if (error) throw new Error(`listPersistedShopifyOrders: ${error.message}`);
    const page = (data ?? []) as unknown as RawSummary[];
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
  const { error } = await getDB()
    .from("shopify_orders")
    .upsert(payload, { onConflict: "shopify_order_id" });
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

  const costBySku = new Map(
    costs
      .filter((cost) => cost.active)
      .map((cost) => [cost.sku.toLowerCase(), cost])
  );
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
      const sku = (item.sku || "").toLowerCase();
      if (!sku) continue;
      const cost = costBySku.get(sku);
      if (!cost) {
        missingCostSkus.add(sku);
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
