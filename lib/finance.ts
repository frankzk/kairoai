import { getDB } from "@/lib/db";
import { DEFAULT_FINANCE_STORE_ID } from "./store-config";
import { normalizeForzaGuide } from "./forza";

export * from "./finance-types";
import type {
  BoxfulFileControl,
  PayrollStaff,
  BusinessExpense,
  ExpenseType,
  FinanceClaim,
  ForzaTrackingRow,
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

export async function listProductCosts(storeId = DEFAULT_FINANCE_STORE_ID): Promise<ProductCost[]> {
  const { data, error } = await getDB()
    .from("product_costs")
    .select("*")
    .eq("store_id", storeId)
    .order("active", { ascending: false })
    .order("sku");
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyProductCosts();
  if (error) throw new Error(`listProductCosts: ${error.message}`);
  return (data ?? []) as ProductCost[];
}

export async function listProductCostVersions(
  sku?: string,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<ProductCostVersion[]> {
  let query = getDB()
    .from("product_cost_versions")
    .select("*")
    .eq("store_id", storeId)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (sku) query = query.eq("sku", sku.trim().toLowerCase());
  const { data, error } = await query;
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyProductCostVersions(sku);
  if (error) throw new Error(`listProductCostVersions: ${error.message}`);
  return (data ?? []) as ProductCostVersion[];
}

export async function upsertProductCost(
  input: Partial<ProductCost> & { sku: string },
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<ProductCost> {
  const payload = {
    store_id: storeId,
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
    .eq("store_id", storeId)
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
      store_id: storeId,
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

export async function deleteProductCost(
  id: number,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  const { error } = await getDB()
    .from("product_costs")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`deleteProductCost: ${error.message}`);
}

export async function listExpenses(
  type?: ExpenseType,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<BusinessExpense[]> {
  let query = getDB()
    .from("business_expenses")
    .select("*")
    .eq("store_id", storeId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyExpenses(type);
  if (error) throw new Error(`listExpenses: ${error.message}`);
  return (data ?? []) as BusinessExpense[];
}

export async function createExpense(
  input: Omit<BusinessExpense, "id" | "created_at" | "updated_at" | "store_id">,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<BusinessExpense> {
  const payload = {
    ...input,
    store_id: storeId,
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
  updates: Partial<BusinessExpense>,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  const { error } = await getDB()
    .from("business_expenses")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`updateExpense: ${error.message}`);
}

export async function deleteExpense(
  id: number,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  const { error } = await getDB()
    .from("business_expenses")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`deleteExpense: ${error.message}`);
}

export async function listSettlementImports(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<SettlementImport[]> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacySettlementImports();
  if (error) throw new Error(`listSettlementImports: ${error.message}`);
  return (data ?? []) as SettlementImport[];
}

export async function deleteSettlementImport(
  id: number,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  const { error } = await getDB()
    .from("settlement_imports")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`deleteSettlementImport: ${error.message}`);
}

export async function createSettlementImport(
  input: Omit<SettlementImport, "id" | "created_at" | "store_id">,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<SettlementImport> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .insert({ ...input, store_id: storeId })
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

// Re-emparejado: actualiza filas existentes por id. Se omite raw_row del payload
// a proposito (columna con DEFAULT '{}') para no pisar el original guardado al
// importar; el upsert solo toca las columnas presentes en cada fila.
export async function upsertSettlementRows(rows: SettlementRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await getDB()
    .from("settlement_rows")
    .upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`upsertSettlementRows: ${error.message}`);
}

export async function updateSettlementImportMatchCounts(
  id: number,
  storeId: number,
  matchedRows: number,
  unmatchedRows: number
): Promise<void> {
  const { error } = await getDB()
    .from("settlement_imports")
    .update({ matched_rows: matchedRows, unmatched_rows: unmatchedRows })
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`updateSettlementImportMatchCounts: ${error.message}`);
}

const SETTLEMENT_ROW_COLUMNS_BASE =
  "id, store_id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, service_type, cod_amount, cod_commission, card_commission, delivery_cost, pick_pack_cost, packaging_cost, amount_to_liquidate, settlement_status, internal_status, match_status, shopify_order_id, shopify_order_name, shopify_financial_status, shopify_fulfillment_status, shopify_total, shopify_created_at, order_items, created_at";
// first_name/last_name requieren la migracion 0005; si falta, se reintenta
// sin ellas.
let settlementNameColumnsMissing = false;
const LEGACY_SETTLEMENT_ROW_COLUMNS =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, service_type, cod_amount, cod_commission, card_commission, delivery_cost, pick_pack_cost, packaging_cost, amount_to_liquidate, settlement_status, internal_status, match_status, shopify_order_id, shopify_order_name, shopify_financial_status, shopify_fulfillment_status, shopify_total, shopify_created_at, order_items, created_at";

export async function listSettlementRows(
  importId?: number,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<SettlementRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se pagina con range(). La primera pagina va en serie (detecta
  // columnas faltantes / fallback legacy) y el resto va en lotes concurrentes
  // para no encadenar hasta 20 viajes a Supabase en una sola carga.
  const pageSize = 1000;
  const concurrency = 5;
  const maxRows = 20000;
  const fetchPage = (from: number, withNames: boolean) => {
    let query = getDB()
      .from("settlement_rows")
      .select(withNames ? `${SETTLEMENT_ROW_COLUMNS_BASE}, first_name, last_name` : SETTLEMENT_ROW_COLUMNS_BASE)
      .eq("store_id", storeId)
      .order("created_on", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (importId) query = query.eq("import_id", importId);
    return query;
  };

  let first = await fetchPage(0, !settlementNameColumnsMissing);
  if (shouldFallbackToLegacyStore(first.error, storeId)) return listLegacySettlementRows(importId);
  if (first.error && !settlementNameColumnsMissing && isMissingColumnError(first.error.message)) {
    settlementNameColumnsMissing = true;
    first = await fetchPage(0, false);
  }
  if (shouldFallbackToLegacyStore(first.error, storeId)) return listLegacySettlementRows(importId);
  if (first.error) throw new Error(`listSettlementRows: ${first.error.message}`);

  const withNames = !settlementNameColumnsMissing;
  const all: SettlementRow[] = [...((first.data ?? []) as unknown as SettlementRow[])];
  let done = (first.data?.length ?? 0) < pageSize;

  for (let base = pageSize; base < maxRows && !done; base += pageSize * concurrency) {
    const froms: number[] = [];
    for (let i = 0; i < concurrency; i++) {
      const from = base + i * pageSize;
      if (from >= maxRows) break;
      froms.push(from);
    }
    const results = await Promise.all(froms.map((from) => fetchPage(from, withNames)));
    for (const { data, error } of results) {
      if (error) throw new Error(`listSettlementRows: ${error.message}`);
      const page = (data ?? []) as unknown as SettlementRow[];
      all.push(...page);
      if (page.length < pageSize) done = true;
    }
  }
  return all;
}

export async function listLogisticsImports(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<LogisticsImport[]> {
  const { data, error } = await getDB()
    .from("logistics_imports")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyLogisticsImports();
  if (error) throw new Error(`listLogisticsImports: ${error.message}`);
  return (data ?? []) as LogisticsImport[];
}

export async function createLogisticsImport(
  input: Omit<LogisticsImport, "id" | "created_at" | "store_id">,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<LogisticsImport> {
  const { data, error } = await getDB()
    .from("logistics_imports")
    .insert({ ...input, store_id: storeId })
    .select()
    .single();
  if (error) throw new Error(`createLogisticsImport: ${error.message}`);
  return data as LogisticsImport;
}

export async function deleteLogisticsImport(
  id: number,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  const { error } = await getDB()
    .from("logistics_imports")
    .delete()
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`deleteLogisticsImport: ${error.message}`);
}

export async function insertLogisticsRows(
  rows: Omit<LogisticsRow, "id" | "created_at">[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await getDB().from("logistics_rows").insert(rows);
  if (error) throw new Error(`insertLogisticsRows: ${error.message}`);
}

// Re-emparejado: ver nota en upsertSettlementRows. raw_row se omite a proposito.
export async function upsertLogisticsRows(rows: LogisticsRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await getDB()
    .from("logistics_rows")
    .upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`upsertLogisticsRows: ${error.message}`);
}

export async function updateLogisticsImportMatchCounts(
  id: number,
  storeId: number,
  matchedRows: number,
  unmatchedRows: number
): Promise<void> {
  const { error } = await getDB()
    .from("logistics_imports")
    .update({ matched_rows: matchedRows, unmatched_rows: unmatchedRows })
    .eq("id", id)
    .eq("store_id", storeId);
  if (error) throw new Error(`updateLogisticsImportMatchCounts: ${error.message}`);
}

const LOGISTICS_ROW_COLUMNS_BASE =
  "id, store_id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, boxful_status, internal_status, match_status, service_type, cod_amount, cod_commission, delivery_cost, total_cost, liquidated_on, finalized_on, label_url, package_items, shopify_order_id, shopify_order_name, shopify_order_number, shopify_financial_status, shopify_fulfillment_status, shopify_cancelled_at, shopify_total, shopify_created_at, created_at";
// Variante liviana para la descarga masiva del cliente: sin package_items (el
// array mas pesado) para que cada pagina sea chica y no se corte la carga; las
// filas con match toman los items del pedido de Shopify igual.
const LOGISTICS_ROW_COLUMNS_SLIM =
  "id, store_id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, boxful_status, internal_status, match_status, service_type, cod_amount, cod_commission, delivery_cost, total_cost, liquidated_on, finalized_on, label_url, shopify_order_id, shopify_order_name, shopify_order_number, shopify_financial_status, shopify_fulfillment_status, shopify_cancelled_at, shopify_total, shopify_created_at, created_at";
let logisticsNameColumnsMissing = false;
const LEGACY_LOGISTICS_ROW_COLUMNS =
  "id, import_id, guide_number, order_name, store_order_number, customer_name, customer_phone, created_on, courier, boxful_status, internal_status, match_status, service_type, cod_amount, cod_commission, delivery_cost, total_cost, liquidated_on, finalized_on, label_url, package_items, shopify_order_id, shopify_order_name, shopify_order_number, shopify_financial_status, shopify_fulfillment_status, shopify_cancelled_at, shopify_total, shopify_created_at, created_at";

export async function listLogisticsRows(
  importId?: number,
  storeId = DEFAULT_FINANCE_STORE_ID,
  options: { slim?: boolean } = {}
): Promise<LogisticsRow[]> {
  // PostgREST recorta cada respuesta a max-rows (1000); se pagina con range().
  // La primera pagina va en serie (detecta columnas faltantes / fallback legacy)
  // y el resto en lotes concurrentes para no encadenar viajes a Supabase.
  const pageSize = 1000;
  const concurrency = 5;
  const maxRows = 20000;
  const baseColumns = options.slim ? LOGISTICS_ROW_COLUMNS_SLIM : LOGISTICS_ROW_COLUMNS_BASE;
  const fetchPage = (from: number, withNames: boolean) => {
    let query = getDB()
      .from("logistics_rows")
      .select(withNames ? `${baseColumns}, first_name, last_name` : baseColumns)
      .eq("store_id", storeId)
      .order("created_on", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (importId) query = query.eq("import_id", importId);
    return query;
  };

  let first = await fetchPage(0, !logisticsNameColumnsMissing);
  if (shouldFallbackToLegacyStore(first.error, storeId)) return listLegacyLogisticsRows(importId);
  if (first.error && !logisticsNameColumnsMissing && isMissingColumnError(first.error.message)) {
    logisticsNameColumnsMissing = true;
    first = await fetchPage(0, false);
  }
  if (shouldFallbackToLegacyStore(first.error, storeId)) return listLegacyLogisticsRows(importId);
  if (first.error) throw new Error(`listLogisticsRows: ${first.error.message}`);

  const withNames = !logisticsNameColumnsMissing;
  const all: LogisticsRow[] = [...((first.data ?? []) as unknown as LogisticsRow[])];
  let done = (first.data?.length ?? 0) < pageSize;

  for (let base = pageSize; base < maxRows && !done; base += pageSize * concurrency) {
    const froms: number[] = [];
    for (let i = 0; i < concurrency; i++) {
      const from = base + i * pageSize;
      if (from >= maxRows) break;
      froms.push(from);
    }
    const results = await Promise.all(froms.map((from) => fetchPage(from, withNames)));
    for (const { data, error } of results) {
      if (error) throw new Error(`listLogisticsRows: ${error.message}`);
      const page = (data ?? []) as unknown as LogisticsRow[];
      all.push(...page);
      if (page.length < pageSize) done = true;
    }
  }
  return all;
}

export async function listLogisticsRowsPage(
  options: {
    importId?: number;
    storeId?: number;
    limit?: number;
    offset?: number;
    slim?: boolean;
  } = {}
): Promise<{ rows: LogisticsRow[]; hasMore: boolean; nextOffset: number | null }> {
  const importId = options.importId;
  const storeId = options.storeId ?? DEFAULT_FINANCE_STORE_ID;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 1000), 1), 1000);
  const offset = Math.max(Math.floor(options.offset ?? 0), 0);
  const baseColumns = options.slim ? LOGISTICS_ROW_COLUMNS_SLIM : LOGISTICS_ROW_COLUMNS_BASE;

  const fetchPage = (withNames: boolean) => {
    let query = getDB()
      .from("logistics_rows")
      .select(withNames ? `${baseColumns}, first_name, last_name` : baseColumns)
      .eq("store_id", storeId)
      .order("created_on", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit);
    if (importId) query = query.eq("import_id", importId);
    return query;
  };

  let { data, error } = await fetchPage(!logisticsNameColumnsMissing);
  if (shouldFallbackToLegacyStore(error, storeId)) {
    const rows = (await listLegacyLogisticsRows(importId)).slice(offset, offset + limit);
    return {
      rows,
      hasMore: rows.length === limit,
      nextOffset: rows.length === limit ? offset + limit : null,
    };
  }
  if (error && !logisticsNameColumnsMissing && isMissingColumnError(error.message)) {
    logisticsNameColumnsMissing = true;
    ({ data, error } = await fetchPage(false));
  }
  if (shouldFallbackToLegacyStore(error, storeId)) {
    const rows = (await listLegacyLogisticsRows(importId)).slice(offset, offset + limit);
    return {
      rows,
      hasMore: rows.length === limit,
      nextOffset: rows.length === limit ? offset + limit : null,
    };
  }
  if (error) throw new Error(`listLogisticsRowsPage: ${error.message}`);

  const page = (data ?? []) as unknown as LogisticsRow[];
  const rows = page.slice(0, limit);
  const hasMore = page.length > limit;
  return {
    rows,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

// Sin raw_order completo: las lineas y notas se resuelven aca para que la
// respuesta con miles de pedidos no se dispare de tamano.
// Camino rapido: columnas planas (requiere la migracion 0003). Extraer campos
// de raw_order detoastea el JSONB completo por fila y revienta el statement
// timeout de Postgres con 10k+ pedidos, asi que solo se usa como fallback
// mientras la migracion no este aplicada.
// Tier 0: columnas planas con nombre/apellido (requiere migraciones 0003 y 0005).
const PERSISTED_NAMES_BASE =
  "id, store_id, shopify_order_id, order_number, name, customer_name, first_name, last_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note, note_attributes";

// Tier 0: todo plano, incluye tracking del fulfillment (requiere 0007).
const PERSISTED_ORDER_SUMMARY_COLUMNS_FAST = `${PERSISTED_NAMES_BASE}, tracking_number, tracking_company`;

// Tier 1: nombres pero sin tracking (0005 si, 0007 no). Sigue siendo rapido.
const PERSISTED_ORDER_SUMMARY_COLUMNS_NAMES = PERSISTED_NAMES_BASE;

// Tier 2: nota plana sin nombres ni tracking (0003 si, 0005 no).
const PERSISTED_ORDER_SUMMARY_COLUMNS_NOTE_ONLY =
  "id, store_id, shopify_order_id, order_number, name, customer_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note, note_attributes";

// Tier 3: extraccion de raw_order (pre-0003). Lento; solo como ultimo recurso.
const PERSISTED_ORDER_SUMMARY_COLUMNS_LEGACY =
  "id, store_id, shopify_order_id, order_number, name, customer_name, first_name:raw_order->'customer'->>first_name, last_name:raw_order->'customer'->>last_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note:raw_order->>note, note_attributes:raw_order->note_attributes, raw_line_items:raw_order->line_items";

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
const LEGACY_PERSISTED_ORDER_SUMMARY_COLUMNS =
  "id, shopify_order_id, order_number, name, customer_name, phone, email, financial_status, fulfillment_status, cancelled_at, total_price, currency, line_items, shopify_created_at, shopify_updated_at, synced_at, note:raw_order->>note, note_attributes:raw_order->note_attributes, raw_line_items:raw_order->line_items";

export interface PersistedShopifyOrderSummary
  extends Omit<PersistedShopifyOrder, "raw_order"> {
  note: string;
  note_attributes: Array<{ name?: string | null; value?: string | null }>;
}

export async function listPersistedShopifyOrders(
  limit = 1000,
  offset = 0,
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<PersistedShopifyOrderSummary[]> {
  type RawSummary = PersistedShopifyOrderSummary & {
    raw_line_items: Array<Record<string, unknown>> | null;
  };
  // PostgREST recorta cada respuesta a max-rows (1000 en Supabase por
  // defecto); se piden bloques de ese tamano hasta el limite pedido.
  const pageSize = 1000;
  const rows: RawSummary[] = [];
  const safeLimit = Math.max(Math.floor(limit), 0);
  const safeOffset = Math.max(Math.floor(offset), 0);
  // Lectura desde el principio (offset 0): paginacion por keyset sobre el id
  // (PK). Es el camino del rebuild del dataset (hasta 20k filas) y de la
  // cobertura. Un OFFSET profundo obliga a Postgres a reordenar toda la tabla
  // (arrastrando el JSONB de cada fila) y descartar miles de filas por pagina,
  // lo que reventaba el statement timeout -> FUNCTION_INVOCATION_TIMEOUT en
  // /api/finance/orders con la cache fria. El consumidor reordena por fecha, asi
  // que ordenar por id alcanza. Para offset>0 (uso puntual y acotado del GET de
  // shopify-sync) se mantiene range().
  const useKeyset = safeOffset === 0;
  let lastId: number | null = null;
  for (let fetched = 0; fetched < safeLimit; fetched += pageSize) {
    const batchSize = Math.min(pageSize, safeLimit - fetched);
    const fetchPage = (columns: string) => {
      let query = getDB().from("shopify_orders").select(columns).eq("store_id", storeId);
      if (useKeyset) {
        query = query.order("id", { ascending: false }).limit(batchSize);
        if (lastId !== null) query = query.lt("id", lastId);
      } else {
        const from = safeOffset + fetched;
        const to = safeOffset + Math.min(fetched + pageSize, safeLimit) - 1;
        query = query
          .order("shopify_created_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .range(from, to);
      }
      return query;
    };

    let result = await fetchPage(PERSISTED_TIERS[persistedTier]);
    if (shouldFallbackToLegacyStore(result.error, storeId)) {
      return listLegacyPersistedShopifyOrders(limit, offset);
    }
    // Si falta una columna de una migracion no aplicada, baja al siguiente
    // tier (sigue siendo rapido hasta el ultimo, que ya extrae de raw_order).
    while (result.error && isMissingColumnError(result.error.message) && persistedTier < PERSISTED_TIERS.length - 1) {
      persistedTier += 1;
      result = await fetchPage(PERSISTED_TIERS[persistedTier]);
      if (shouldFallbackToLegacyStore(result.error, storeId)) {
        return listLegacyPersistedShopifyOrders(limit, offset);
      }
    }
    if (result.error) throw new Error(`listPersistedShopifyOrders: ${result.error.message}`);
    const page = (result.data ?? []) as unknown as RawSummary[];
    if (!page.length) break;
    rows.push(...page);
    lastId = Number((page[page.length - 1] as unknown as { id: number }).id);
    if (page.length < batchSize) break;
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

export async function getPersistedShopifyCoverage(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<PersistedShopifyCoverage> {
  const db = getDB();
  const [countRes, oldestRes, newestRes] = await Promise.all([
    db.from("shopify_orders").select("id", { count: "estimated", head: true }).eq("store_id", storeId),
    db
      .from("shopify_orders")
      .select("shopify_created_at")
      .eq("store_id", storeId)
      .not("shopify_created_at", "is", null)
      .order("shopify_created_at", { ascending: true })
      .limit(1),
    db
      .from("shopify_orders")
      .select("shopify_created_at")
      .eq("store_id", storeId)
      .not("shopify_created_at", "is", null)
      .order("shopify_created_at", { ascending: false })
      .limit(1),
  ]);
  if (shouldFallbackToLegacyStore(countRes.error, storeId)) return getLegacyPersistedShopifyCoverage();
  if (countRes.error) throw new Error(`getPersistedShopifyCoverage: ${countRes.error.message}`);
  return {
    count: countRes.count ?? 0,
    oldest: (oldestRes.data?.[0]?.shopify_created_at as string | undefined) ?? null,
    newest: (newestRes.data?.[0]?.shopify_created_at as string | undefined) ?? null,
  };
}

export async function upsertPersistedShopifyOrders(
  orders: Omit<PersistedShopifyOrder, "id" | "synced_at" | "store_id">[],
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  if (!orders.length) return;
  const payload = orders.map((order) => ({
    ...order,
    store_id: storeId,
    synced_at: new Date().toISOString(),
  }));
  let { error } = await getDB()
    .from("shopify_orders")
    .upsert(payload, { onConflict: "store_id,shopify_order_id" });
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
      .upsert(legacyPayload, { onConflict: "store_id,shopify_order_id" }));
  }
  if (error) throw new Error(`upsertPersistedShopifyOrders: ${error.message}`);
}

export async function listFinanceClaims(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<FinanceClaim[]> {
  const { data, error } = await getDB()
    .from("finance_claims")
    .select("*")
    .eq("store_id", storeId)
    .order("updated_at", { ascending: false });
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyFinanceClaims();
  if (error) throw new Error(`listFinanceClaims: ${error.message}`);
  return (data ?? []) as FinanceClaim[];
}

export async function upsertFinanceClaim(
  input: Partial<FinanceClaim> & { anomaly_key: string },
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<FinanceClaim> {
  const payload = {
    store_id: storeId,
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
    .upsert(payload, { onConflict: "store_id,anomaly_key" })
    .select()
    .single();
  if (error) throw new Error(`upsertFinanceClaim: ${error.message}`);
  return data as FinanceClaim;
}

export async function listBoxfulFileControls(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<BoxfulFileControl[]> {
  const { data, error } = await getDB()
    .from("boxful_file_controls")
    .select("*")
    .eq("store_id", storeId)
    .order("cutoff_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (shouldFallbackToLegacyStore(error, storeId)) return listLegacyBoxfulFileControls();
  if (error) throw new Error(`listBoxfulFileControls: ${error.message}`);
  return (data ?? []) as BoxfulFileControl[];
}

export async function upsertBoxfulFileControl(
  input: Partial<BoxfulFileControl> & { file_name: string; file_type: "logistica" | "liquidacion" },
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<BoxfulFileControl> {
  const payload = {
    store_id: storeId,
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
    .upsert(payload, { onConflict: "store_id,file_name,file_type" })
    .select()
    .single();
  if (error) throw new Error(`upsertBoxfulFileControl: ${error.message}`);
  return data as BoxfulFileControl;
}

export async function getProfitabilitySummary(
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<ProfitabilitySummary> {
  const [rows, costs, expenses] = await Promise.all([
    listSettlementRows(undefined, storeId),
    listProductCosts(storeId),
    listExpenses(undefined, storeId),
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

type StorePartitionError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null;

function shouldFallbackToLegacyStore(error: StorePartitionError, storeId: number): boolean {
  if (!error || storeId !== DEFAULT_FINANCE_STORE_ID) return false;
  const text = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes("store_id") || text.includes("store id");
}

async function listLegacyProductCosts(): Promise<ProductCost[]> {
  const { data, error } = await getDB()
    .from("product_costs")
    .select("*")
    .order("active", { ascending: false })
    .order("sku");
  if (error) throw new Error(`listProductCosts: ${error.message}`);
  return (data ?? []) as ProductCost[];
}

async function listLegacyProductCostVersions(sku?: string): Promise<ProductCostVersion[]> {
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

async function listLegacyExpenses(type?: ExpenseType): Promise<BusinessExpense[]> {
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

async function listLegacySettlementImports(): Promise<SettlementImport[]> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listSettlementImports: ${error.message}`);
  return (data ?? []) as SettlementImport[];
}

async function listLegacySettlementRows(importId?: number): Promise<SettlementRow[]> {
  const pageSize = 1000;
  const all: SettlementRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    let query = getDB()
      .from("settlement_rows")
      .select(LEGACY_SETTLEMENT_ROW_COLUMNS)
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

async function listLegacyLogisticsImports(): Promise<LogisticsImport[]> {
  const { data, error } = await getDB()
    .from("logistics_imports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listLogisticsImports: ${error.message}`);
  return (data ?? []) as LogisticsImport[];
}

async function listLegacyLogisticsRows(importId?: number): Promise<LogisticsRow[]> {
  const pageSize = 1000;
  const all: LogisticsRow[] = [];
  for (let from = 0; from < 20000; from += pageSize) {
    let query = getDB()
      .from("logistics_rows")
      .select(LEGACY_LOGISTICS_ROW_COLUMNS)
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

async function listLegacyPersistedShopifyOrders(
  limit = 1000,
  offset = 0
): Promise<PersistedShopifyOrderSummary[]> {
  type RawSummary = PersistedShopifyOrderSummary & {
    raw_line_items: Array<Record<string, unknown>> | null;
  };
  const pageSize = 1000;
  const rows: RawSummary[] = [];
  const safeLimit = Math.max(Math.floor(limit), 0);
  const safeOffset = Math.max(Math.floor(offset), 0);
  for (let fetched = 0; fetched < safeLimit; fetched += pageSize) {
    const from = safeOffset + fetched;
    const to = safeOffset + Math.min(fetched + pageSize, safeLimit) - 1;
    const { data, error } = await getDB()
      .from("shopify_orders")
      .select(LEGACY_PERSISTED_ORDER_SUMMARY_COLUMNS)
      .order("shopify_created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`listPersistedShopifyOrders: ${error.message}`);
    const page = (data ?? []) as unknown as RawSummary[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.map(({ raw_line_items, ...order }) => ({
    ...order,
    note: order.note ?? "",
    note_attributes: order.note_attributes ?? [],
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

async function getLegacyPersistedShopifyCoverage(): Promise<PersistedShopifyCoverage> {
  const db = getDB();
  const [countRes, oldestRes, newestRes] = await Promise.all([
    db.from("shopify_orders").select("id", { count: "estimated", head: true }),
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

async function listLegacyFinanceClaims(): Promise<FinanceClaim[]> {
  const { data, error } = await getDB()
    .from("finance_claims")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`listFinanceClaims: ${error.message}`);
  return (data ?? []) as FinanceClaim[];
}

async function listLegacyBoxfulFileControls(): Promise<BoxfulFileControl[]> {
  const { data, error } = await getDB()
    .from("boxful_file_controls")
    .select("*")
    .order("cutoff_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listBoxfulFileControls: ${error.message}`);
  return (data ?? []) as BoxfulFileControl[];
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

export async function listMoovinTracking(
  opts: { since?: string | null } = {}
): Promise<MoovinTrackingRow[]> {
  const pageSize = 1000;
  const concurrency = 5;
  const maxRows = 50000;
  const all: MoovinTrackingRow[] = [];
  let done = false;
  // Lee las paginas en lotes concurrentes (en vez de una por una en serie) para
  // no encadenar hasta 50 viajes a Supabase. Con `since` solo trae el tracking
  // re-chequeado despues de esa marca (modo incremental del cron de novedades).
  for (let base = 0; base < maxRows && !done; base += pageSize * concurrency) {
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < concurrency; i++) {
      const from = base + i * pageSize;
      if (from >= maxRows) break;
      ranges.push([from, from + pageSize - 1]);
    }
    const results = await Promise.all(
      ranges.map(([from, to]) => {
        let query = getDB()
          .from("moovin_tracking")
          .select("*")
          .order("checked_at", { ascending: false })
          .range(from, to);
        if (opts.since) query = query.gt("checked_at", opts.since);
        return query;
      })
    );
    for (const { data, error } of results) {
      if (error) throw new Error(`listMoovinTracking: ${error.message}`);
      const page = (data ?? []) as MoovinTrackingRow[];
      all.push(...page);
      if (page.length < pageSize) done = true;
    }
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

// Una fila de tracking de Moovin por su id_package (= la guia de la novedad).
// Para el detalle de una novedad: trae el historial completo (columna events).
export async function getMoovinTrackingByPackage(
  idPackage: string
): Promise<MoovinTrackingRow | null> {
  if (!idPackage) return null;
  const { data, error } = await getDB()
    .from("moovin_tracking")
    .select("*")
    .eq("id_package", idPackage)
    .limit(1);
  if (error) throw new Error(`getMoovinTrackingByPackage: ${error.message}`);
  return ((data ?? []) as MoovinTrackingRow[])[0] ?? null;
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

export async function listForzaTracking(
  storeId = DEFAULT_FINANCE_STORE_ID,
  opts: { since?: string | null } = {}
): Promise<ForzaTrackingRow[]> {
  const pageSize = 1000;
  const all: ForzaTrackingRow[] = [];
  for (let from = 0; from < 50000; from += pageSize) {
    let query = getDB()
      .from("forza_tracking")
      .select("*")
      .eq("store_id", storeId)
      .order("checked_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (opts.since) query = query.gt("checked_at", opts.since);
    const { data, error } = await query;
    if (error) throw new Error(`listForzaTracking: ${error.message}`);
    const page = (data ?? []) as ForzaTrackingRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function upsertForzaTracking(
  rows: Omit<ForzaTrackingRow, "checked_at" | "store_id">[],
  storeId = DEFAULT_FINANCE_STORE_ID
): Promise<void> {
  if (!rows.length) return;
  const payload = rows.map((row) => ({ ...row, store_id: storeId, checked_at: new Date().toISOString() }));
  const { error } = await getDB()
    .from("forza_tracking")
    .upsert(payload, { onConflict: "store_id,guide_number" });
  if (error) throw new Error(`upsertForzaTracking: ${error.message}`);
}

// Una fila de tracking de Forza por (store_id, guide_number). Para el detalle de
// una novedad: trae el historial completo (columna events).
export async function getForzaTrackingByGuide(
  storeId: number,
  guideNumber: string
): Promise<ForzaTrackingRow | null> {
  if (!guideNumber) return null;
  const { data, error } = await getDB()
    .from("forza_tracking")
    .select("*")
    .eq("store_id", storeId)
    .eq("guide_number", guideNumber)
    .limit(1);
  if (error) throw new Error(`getForzaTrackingByGuide: ${error.message}`);
  return ((data ?? []) as ForzaTrackingRow[])[0] ?? null;
}

export async function getRecentlyCheckedForzaGuides(
  storeId: number,
  maxAgeMinutes: number
): Promise<Set<string>> {
  const since = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
  const fresh = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await getDB()
      .from("forza_tracking")
      .select("guide_number")
      .eq("store_id", storeId)
      .gte("checked_at", since)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getRecentlyCheckedForzaGuides: ${error.message}`);
    const page = (data ?? []) as Array<{ guide_number: string }>;
    for (const row of page) {
      const normalized = normalizeForzaGuide(row.guide_number);
      if (!normalized) continue;
      fresh.add(normalized);
      fresh.add(normalized.replace(/^FD/i, ""));
    }
    if (page.length < pageSize) break;
  }
  return fresh;
}
