// Formas de datos del modulo financiero, compartidas entre el servidor
// (lib/finance.ts, rutas) y el cliente (page de finanzas). Sin imports.

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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
  store_id: number;
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
