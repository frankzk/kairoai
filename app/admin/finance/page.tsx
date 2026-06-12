"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "orders" | "products" | "notes" | "settlements" | "expenses" | "monthly" | "files";
type ExpenseType = "ads" | "payroll" | "misc";
type FinancialAnomalySeverity = "high" | "medium" | "low";
type OrderTrackingFilter = "all" | "pending" | "annulled" | "delivered" | "not_delivered";
type ProductAnalysisFilter =
  | "all"
  | "no_cost"
  | "unknown_product"
  | "pending"
  | "annulled"
  | "delivered"
  | "not_delivered";
type OrderSettlementFilter = "all" | "settled" | "unsettled" | "to_claim" | "duplicate";
type OrderPeriodMode = "all" | "month" | "range";
type MonthlyOrderFilter =
  | "all"
  | "pending"
  | "delivered"
  | "not_delivered"
  | "annulled"
  | "settled"
  | "unsettled"
  | "to_claim"
  | "duplicate";
type SettlementImportSort = "recent" | "oldest";
type SettlementShopifyFilter = "all" | "matched" | "unmatched";
type ProductLineItem = { sku?: string; title: string; quantity: number; price: number };
type ImportResult = { ok: boolean; error?: string };

interface SettlementImport {
  id: number;
  file_name: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  total_to_liquidate: number;
  created_at: string;
}

interface SettlementRow {
  id: number;
  import_id: number;
  order_name: string;
  guide_number: string;
  customer_name: string;
  courier: string;
  settlement_status: string;
  internal_status: string;
  match_status: string;
  cod_amount: number;
  cod_commission: number;
  card_commission: number;
  delivery_cost: number;
  pick_pack_cost: number;
  packaging_cost: number;
  amount_to_liquidate: number;
  shopify_order_name: string;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_created_at?: string | null;
  order_items: ProductLineItem[];
}

interface SettlementTrace {
  file_name: string;
  amount_to_liquidate: number;
  settlement_status: string;
  internal_status: string;
}

interface DoubleSettlementAnomaly {
  key: string;
  kind: "order" | "guide";
  traces: SettlementTrace[];
}

interface LogisticsImport {
  id: number;
  file_name: string;
  period_label: string;
  period_start: string | null;
  period_end: string | null;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  created_at: string;
}

interface LogisticsRow {
  id: number;
  guide_number: string;
  order_name: string;
  customer_name: string;
  courier: string;
  boxful_status: string;
  internal_status: string;
  match_status: string;
  cod_amount: number;
  delivery_cost: number;
  shopify_order_name: string;
  shopify_order_number: number | null;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_cancelled_at: string | null;
  shopify_created_at: string | null;
  package_items: Array<{ title: string; quantity: number; price: number }>;
}

interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  phone: string | null;
  products: string;
  total: string;
  total_price: number;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  note?: string;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
  created_at: string;
  line_items: ProductLineItem[];
}

interface ShopifyNoteAliasRow {
  row_key: string;
  shopify_order_name: string;
  note_order_number: string;
  note: string;
  created_at: string;
}

interface TrackableOrderRow {
  id?: number;
  row_key: string;
  source: "boxful" | "shopify" | "liquidacion";
  guide_number: string;
  order_name: string;
  customer_name: string;
  boxful_status: string;
  internal_status: string;
  match_status: string;
  cod_amount: number;
  shopify_order_name: string;
  shopify_order_number: number | null;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_cancelled_at: string | null;
  shopify_note?: string;
  shopify_created_at: string | null;
  created_on?: string | null;
  created_at?: string | null;
  finalized_on?: string | null;
  package_items: ProductLineItem[];
}

interface ProductCost {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  effective_from: string;
  active: boolean;
}

interface ProductCostVersion {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  effective_from: string;
  created_at: string;
}

type ProductCostSaveInput = {
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  effective_from?: string;
};

interface FinanceClaim {
  id: number;
  anomaly_key: string;
  order_name: string;
  guide_number: string;
  type: string;
  status: "pendiente" | "reclamado" | "resuelto" | "descartado";
  amount: number;
  source_file: string;
  notes: string;
}

interface BoxfulFileControl {
  id: number;
  file_name: string;
  file_type: "logistica" | "liquidacion";
  cutoff_date: string | null;
  status: "esperado" | "importado" | "faltante" | "ignorado";
  import_id: number | null;
  notes: string;
  imported_at: string | null;
}

interface ShopifyProductOption {
  variant_id: number;
  product_id: number;
  product_title: string;
  variant_title: string;
  display_name: string;
  sku: string;
  price: number;
  image_url?: string;
}

interface BusinessExpense {
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
}

interface ProfitabilitySummary {
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

interface OrderProfitabilityRow {
  order_key: string;
  order_name: string;
  guide_number: string;
  customer_name: string;
  source: "shopify" | "boxful" | "liquidacion";
  shopify_cancelled_at: string | null;
  shopify_financial_status: string;
  tracking_status: string;
  tracking_label: string;
  settlement_status: string;
  settlement_files: string[];
  settlement_count: number;
  settlement_charged_costs: number;
  settlement_cod_commission: number;
  settlement_card_commission: number;
  settlement_delivery_cost: number;
  settlement_pick_pack_cost: number;
  settlement_packaging_cost: number;
  amount_to_liquidate: number;
  expected_cod: number;
  product_cost: number;
  contribution_margin: number;
  missing_cost_skus: string[];
  items: ProductLineItem[];
  items_summary: string;
  cash_status: "cobrado" | "por_cobrar" | "sin_caja";
  issue_count: number;
  created_at: string | null;
  days_since_order: number | null;
  delivered_on: string | null;
}

interface ProductAnalysisRow {
  key: string;
  product_name: string;
  sku: string;
  sample_orders: string[];
  orders: number;
  units: number;
  dispatched: number;
  dispatch_rate: number;
  delivery_effectiveness: number;
  delivered: number;
  not_delivered: number;
  annulled: number;
  pending: number;
}

interface FinancialAnomaly {
  id: string;
  severity: FinancialAnomalySeverity;
  type: string;
  order_name: string;
  guide_number: string;
  amount: number;
  source_file: string;
  message: string;
  action: string;
}

interface FinanceControlCenter {
  orders: OrderProfitabilityRow[];
  anomalies: FinancialAnomaly[];
  cash_received: number;
  cash_pending: number;
  contribution_margin: number;
  missing_cost_count: number;
}

interface MonthlyCloseRow {
  month: string;
  orders: number;
  delivered: number;
  not_delivered: number;
  annulled: number;
  pending: number;
  settled: number;
  unsettled: number;
  to_claim: number;
  duplicate_settlements: number;
  boxful_costs: number;
  boxful_cod_commission: number;
  boxful_card_commission: number;
  boxful_delivery_cost: number;
  boxful_pick_pack_cost: number;
  boxful_packaging_cost: number;
  cash_received: number;
  cash_pending: number;
  product_costs: number;
  ads: number;
  payroll: number;
  misc: number;
  contribution_margin: number;
  net_profit: number;
  misc_software: number;
  misc_other: number;
}

const emptyExpense = {
  type: "ads" as ExpenseType,
  expense_date: new Date().toISOString().slice(0, 10),
  month: new Date().toISOString().slice(0, 7),
  platform: "",
  category: "",
  description: "",
  amount: "",
  currency: "CRC",
  exchange_rate: "",
  notes: "",
};
type ExpensePayload = {
  type: ExpenseType;
  expense_date: string;
  month: string;
  platform: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  notes: string;
};
const EXPENSE_ORIGINAL_CURRENCIES = ["CRC", "USD", "PEN"] as const;
type ExpenseOriginalCurrency = (typeof EXPENSE_ORIGINAL_CURRENCIES)[number];

const ORDER_TRACKING_FILTERS: Array<{ value: OrderTrackingFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "annulled", label: "Anulados" },
  { value: "delivered", label: "Entregados" },
  { value: "not_delivered", label: "No entregados" },
];

const PRODUCT_ANALYSIS_FILTERS: Array<{ value: ProductAnalysisFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "no_cost", label: "Sin costo" },
  { value: "unknown_product", label: "Sin producto" },
  { value: "pending", label: "Pendientes" },
  { value: "annulled", label: "Anulados" },
  { value: "delivered", label: "Entregados" },
  { value: "not_delivered", label: "No entregados" },
];
const UNKNOWN_PRODUCT_LABEL = "Producto sin registrar";

const ORDER_SETTLEMENT_FILTERS: Array<{ value: OrderSettlementFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "settled", label: "Liquidados" },
  { value: "unsettled", label: "Sin liquidacion" },
  { value: "to_claim", label: "Pend. liquidacion" },
  { value: "duplicate", label: "Duplicados" },
];

const ORDER_PERIOD_MODES: Array<{ value: OrderPeriodMode; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "month", label: "Mes" },
  { value: "range", label: "Rango" },
];

const MONTHLY_ORDER_FILTERS: Array<{ value: MonthlyOrderFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "delivered", label: "Entregados" },
  { value: "not_delivered", label: "No entregados" },
  { value: "annulled", label: "Anulados" },
  { value: "settled", label: "Liquidados" },
  { value: "unsettled", label: "Sin liquidacion" },
  { value: "to_claim", label: "Pend. liquidacion" },
  { value: "duplicate", label: "Duplicados" },
];

const SETTLEMENT_IMPORT_SORTS: Array<{ value: SettlementImportSort; label: string }> = [
  { value: "recent", label: "Recientes" },
  { value: "oldest", label: "Antiguas" },
];

const SETTLEMENT_SHOPIFY_FILTERS: Array<{ value: SettlementShopifyFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "matched", label: "Con match" },
  { value: "unmatched", label: "Sin match" },
];

const EXPENSE_VIEW_CONFIG: Array<{
  type: ExpenseType;
  label: string;
  tableTitle: string;
  buttonLabel: string;
  modalTitle: string;
  emptyLabel: string;
  platformPlaceholder: string;
  categoryPlaceholder: string;
  descriptionPlaceholder: string;
}> = [
  {
    type: "ads",
    label: "Ads",
    tableTitle: "Gastos Ads",
    buttonLabel: "Registrar Gasto Ads",
    modalTitle: "Registrar Gasto Ads",
    emptyLabel: "No hay gastos Ads registrados.",
    platformPlaceholder: "Plataforma / canal",
    categoryPlaceholder: "Campana / categoria",
    descriptionPlaceholder: "Descripcion",
  },
  {
    type: "payroll",
    label: "Planilla",
    tableTitle: "Planilla",
    buttonLabel: "Registrar Planilla",
    modalTitle: "Registrar Planilla",
    emptyLabel: "No hay planilla registrada.",
    platformPlaceholder: "Persona",
    categoryPlaceholder: "Tipo de pago: fijo, comision, bono",
    descriptionPlaceholder: "Funcion / detalle",
  },
  {
    type: "misc",
    label: "Varios",
    tableTitle: "Gastos Varios",
    buttonLabel: "Registrar Gastos Varios",
    modalTitle: "Registrar Gastos Varios",
    emptyLabel: "No hay gastos varios registrados.",
    platformPlaceholder: "Proveedor",
    categoryPlaceholder: "Categoria",
    descriptionPlaceholder: "Descripcion",
  },
];

const FINANCE_SHOPIFY_CREATED_AT_MIN = "2025-09-16T00:00:00-06:00";
const FINANCE_SHOPIFY_ORDERS_URL =
  `/api/shopify/orders?status=any&limit=250&created_at_min=${encodeURIComponent(FINANCE_SHOPIFY_CREATED_AT_MIN)}`;
const FINANCE_SHOPIFY_NOTES_LOOKBACK_DAYS = 90;

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [imports, setImports] = useState<SettlementImport[]>([]);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [logisticsImports, setLogisticsImports] = useState<LogisticsImport[]>([]);
  const [logisticsRows, setLogisticsRows] = useState<LogisticsRow[]>([]);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderSummary[]>([]);
  const [shopifyCoverage, setShopifyCoverage] = useState<{
    count: number;
    oldest: string | null;
    newest: string | null;
  } | null>(null);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [costVersions, setCostVersions] = useState<ProductCostVersion[]>([]);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductOption[]>([]);
  const [claims, setClaims] = useState<FinanceClaim[]>([]);
  const [boxfulFiles, setBoxfulFiles] = useState<BoxfulFileControl[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingLogistics, setImportingLogistics] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const latestLogisticsImport = logisticsImports[0];
  const liquidationAlertRows = useMemo(
    () => getDeliveredWithoutSettlement(logisticsRows, rows),
    [logisticsRows, rows]
  );
  const matchedSettlementRows = useMemo(
    () => enrichSettlementRowsWithShopify(rows, shopifyOrders),
    [rows, shopifyOrders]
  );
  const settlementTraceByKey = useMemo(
    () => buildSettlementTraceByKey(matchedSettlementRows, imports),
    [matchedSettlementRows, imports]
  );
  const visibleOrderRows = useMemo(
    () => buildVisibleOrderRows(logisticsRows, shopifyOrders),
    [logisticsRows, shopifyOrders]
  );
  const doubleSettlementAnomalies = useMemo(
    () => getDoubleSettlementAnomalies(settlementTraceByKey),
    [settlementTraceByKey]
  );
  const financeControl = useMemo(
    () => buildFinanceControlCenter(visibleOrderRows, matchedSettlementRows, imports, costs, costVersions, settlementTraceByKey),
    [visibleOrderRows, matchedSettlementRows, imports, costs, costVersions, settlementTraceByKey]
  );
  const productAnalysisRows = useMemo(
    () => buildProductAnalysisRows(financeControl.orders),
    [financeControl.orders]
  );
  const claimByAnomalyKey = useMemo(
    () => new Map(claims.map((claim) => [claim.anomaly_key, claim])),
    [claims]
  );
  const monthlyCloseRows = useMemo(
    () => buildMonthlyCloseRows(financeControl.orders, expenses),
    [financeControl.orders, expenses]
  );

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [settlementsRes, logisticsRes, costsRes, expensesRes, summaryRes] =
        await Promise.all([
          fetch("/api/finance/settlements", { cache: "no-store" }),
          fetch("/api/finance/logistics", { cache: "no-store" }),
          fetch("/api/finance/product-costs", { cache: "no-store" }),
          fetch("/api/finance/expenses", { cache: "no-store" }),
          fetch("/api/finance/summary", { cache: "no-store" }),
        ]);

      const settlementsJson = await readApiJson(settlementsRes);
      const logisticsJson = await readApiJson(logisticsRes);
      const costsJson = await readApiJson(costsRes);
      const expensesJson = await readApiJson(expensesRes);
      const summaryJson = await readApiJson(summaryRes);
      let shopifyOrdersJson: Record<string, unknown> = {};
      let shopifyNoteOrdersJson: Record<string, unknown> = {};
      let persistedShopifyJson: Record<string, unknown> = {};
      let claimsJson: Record<string, unknown> = {};
      let boxfulFilesJson: Record<string, unknown> = {};
      try {
        const shopifyOrdersRes = await fetch(FINANCE_SHOPIFY_ORDERS_URL, { cache: "no-store" });
        shopifyOrdersJson = await readApiJson(shopifyOrdersRes);
      } catch {
        shopifyOrdersJson = {};
      }
      try {
        const shopifyNoteOrdersRes = await fetch(
          `/api/shopify/note-orders?created_at_min=${encodeURIComponent(getShopifyNotesCreatedAtMin())}&max_pages=30`,
          { cache: "no-store" }
        );
        shopifyNoteOrdersJson = await readApiJson(shopifyNoteOrdersRes);
      } catch {
        shopifyNoteOrdersJson = {};
      }
      try {
        const persistedShopifyRes = await fetch("/api/finance/shopify-sync?limit=20000", { cache: "no-store" });
        persistedShopifyJson = await readApiJson(persistedShopifyRes);
      } catch {
        persistedShopifyJson = {};
      }
      try {
        const claimsRes = await fetch("/api/finance/claims", { cache: "no-store" });
        claimsJson = await readApiJson(claimsRes);
      } catch {
        claimsJson = {};
      }
      try {
        const boxfulFilesRes = await fetch("/api/finance/boxful-files", { cache: "no-store" });
        boxfulFilesJson = await readApiJson(boxfulFilesRes);
      } catch {
        boxfulFilesJson = {};
      }

      setImports(settlementsJson.imports ?? []);
      setRows(settlementsJson.rows ?? []);
      setLogisticsImports(logisticsJson.imports ?? []);
      setLogisticsRows(logisticsJson.rows ?? []);
      const liveShopifyOrders = Array.isArray(shopifyOrdersJson.orders) ? shopifyOrdersJson.orders as ShopifyOrderSummary[] : [];
      const noteShopifyOrders = Array.isArray(shopifyNoteOrdersJson.orders)
        ? shopifyNoteOrdersJson.orders as ShopifyOrderSummary[]
        : [];
      const persistedShopifyOrders = Array.isArray(persistedShopifyJson.orders)
        ? (persistedShopifyJson.orders as Array<Record<string, unknown>>).map(persistedOrderToSummary)
        : [];
      // Orden de fusion: lo sincronizado primero y las lecturas en vivo despues,
      // para que una nota recien editada en Shopify pise la copia vieja de la base.
      setShopifyOrders(mergeShopifyOrderSummaries(persistedShopifyOrders, noteShopifyOrders, liveShopifyOrders));
      setShopifyCoverage(
        (persistedShopifyJson.coverage as { count: number; oldest: string | null; newest: string | null } | null) ??
          null
      );
      setCosts(costsJson.costs ?? []);
      setCostVersions(Array.isArray(costsJson.versions) ? costsJson.versions as ProductCostVersion[] : []);
      setExpenses(expensesJson.expenses ?? []);
      setClaims(Array.isArray(claimsJson.claims) ? claimsJson.claims as FinanceClaim[] : []);
      setBoxfulFiles(Array.isArray(boxfulFilesJson.files) ? boxfulFilesJson.files as BoxfulFileControl[] : []);
      setSummary(summaryJson.summary ?? null);

      const firstError =
        settlementsJson.error ??
        logisticsJson.error ??
        costsJson.error ??
        expensesJson.error ??
        summaryJson.error;
      if (firstError) setError(firstError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando gestion financiera");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    loadShopifyProducts();
  }, []);

  async function loadShopifyProducts() {
    setProductsLoading(true);
    setProductsError("");
    try {
      const res = await fetch("/api/shopify/products", { cache: "no-store" });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar productos Shopify");
      setShopifyProducts(json.products ?? []);
    } catch (err) {
      setProductsError(err instanceof Error ? err.message : "No se pudieron cargar productos Shopify");
    } finally {
      setProductsLoading(false);
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/finance/settlements", {
        method: "POST",
        body: data,
      });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudo importar");
      form.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar");
    } finally {
      setImporting(false);
    }
  }

  async function deleteSettlementImport(id: number) {
    const res = await fetch(`/api/finance/settlements?id=${id}`, { method: "DELETE" });
    const json = await readApiJson(res);
    if (!res.ok) {
      setError(json.error ?? "No se pudo eliminar liquidacion");
      return;
    }
    await refresh();
  }

  async function handleLogisticsImport(event: FormEvent<HTMLFormElement>): Promise<ImportResult> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setImportingLogistics(true);
    setError("");
    try {
      const res = await fetch("/api/finance/logistics", {
        method: "POST",
        body: data,
      });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudo importar logistica");
      form.reset();
      await refresh();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo importar logistica";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setImportingLogistics(false);
    }
  }

  async function saveProductCost(input: ProductCostSaveInput) {
    const res = await fetch("/api/finance/product-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await readApiJson(res);
    if (!res.ok) {
      const message = json.error ?? "No se pudo guardar costo";
      setError(message);
      throw new Error(message);
    }
    const savedCost = json.cost as ProductCost;
    setCosts((current) => {
      const withoutSku = current.filter(
        (cost) => cost.sku.toLowerCase() !== savedCost.sku.toLowerCase()
      );
      return [...withoutSku, savedCost].sort((a, b) => a.sku.localeCompare(b.sku));
    });
    setCostVersions((current) => [
      {
        id: Date.now(),
        sku: savedCost.sku,
        product_name: savedCost.product_name,
        unit_cost: savedCost.unit_cost,
        packaging_cost: savedCost.packaging_cost,
        currency: savedCost.currency,
        effective_from: savedCost.effective_from ?? new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
      },
      ...current,
    ]);
    const summaryRes = await fetch("/api/finance/summary", { cache: "no-store" });
    const summaryJson = await readApiJson(summaryRes);
    if (summaryRes.ok) setSummary(summaryJson.summary ?? null);
  }

  async function syncShopifyHistory() {
    setSyncingShopify(true);
    setSyncMessage("Sincronizando Shopify...");
    setError("");
    let totalSynced = 0;

    // Fase 1: pedidos recientes (de lo mas nuevo hacia atras con cursor).
    try {
      let nextUrl: string | null = null;
      for (let batch = 0; batch < 40; batch++) {
        const res = await fetch("/api/finance/shopify-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            created_at_min: FINANCE_SHOPIFY_CREATED_AT_MIN,
            max_pages: 8,
            next_url: nextUrl,
          }),
        });
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo sincronizar Shopify");
        totalSynced += Number(json.synced ?? 0);
        nextUrl = typeof json.next_url === "string" ? json.next_url : null;
        setSyncMessage(`Sincronizando pedidos recientes: ${totalSynced}...`);
        if (!nextUrl) break;
      }
    } catch (err) {
      // El historico hacia atras puede continuar aunque esta fase falle.
      setSyncMessage(
        err instanceof Error ? `${err.message} - continuando con el historico...` : "Continuando con el historico..."
      );
    }

    // Fase 2: backfill hacia atras desde el pedido mas viejo sincronizado,
    // reanudable: cada llamada parte de donde quedo la base.
    try {
      let oldestReached: string | null = null;
      for (let batch = 0; batch < 80; batch++) {
        const res = await fetch("/api/finance/shopify-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            created_at_min: FINANCE_SHOPIFY_CREATED_AT_MIN,
            max_pages: 8,
            mode: "backfill",
          }),
        });
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo completar el historico");
        const synced = Number(json.synced ?? 0);
        totalSynced += synced;
        if (typeof json.oldest === "string" && json.oldest) oldestReached = json.oldest;
        if (json.done || !synced) break;
        setSyncMessage(
          `Completando historico: ${totalSynced} pedidos${
            oldestReached ? `, base desde ${formatDate(oldestReached.slice(0, 10))}` : ""
          }...`
        );
      }
      setSyncMessage(
        `Sync listo: ${totalSynced} pedidos procesados${
          oldestReached ? `. Base desde ${formatDate(oldestReached.slice(0, 10))}` : ""
        }.`
      );
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo sincronizar Shopify";
      setError(message);
      setSyncMessage(message);
    } finally {
      setSyncingShopify(false);
    }
  }

  async function saveClaim(anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes = "") {
    const res = await fetch("/api/finance/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anomaly_key: anomaly.id,
        order_name: anomaly.order_name,
        guide_number: anomaly.guide_number,
        type: anomaly.type,
        amount: anomaly.amount,
        source_file: anomaly.source_file,
        status,
        notes,
      }),
    });
    const json = await readApiJson(res);
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar reclamo");
      return;
    }
    const savedClaim = json.claim as FinanceClaim;
    setClaims((current) => [
      savedClaim,
      ...current.filter((claim) => claim.anomaly_key !== savedClaim.anomaly_key),
    ]);
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    const expensePayload = buildExpensePayload(expenseForm);
    if (!expensePayload.ok) {
      setError(expensePayload.error);
      return false;
    }

    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expensePayload.expense),
    });
    const json = await readApiJson(res);
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar gasto");
      return false;
    }
    setExpenseForm({ ...emptyExpense, type: expenseForm.type });
    await refresh();
    return true;
  }

  async function deleteExpense(id: number) {
    await fetch(`/api/finance/expenses?id=${id}`, { method: "DELETE" });
    await refresh();
  }

  const orderStats = useMemo(() => {
    const effectiveStatuses = visibleOrderRows.map((row) =>
      getEffectiveTrackingStatus(row, getSettlementTracesForLogisticsRow(row, settlementTraceByKey))
    );
    return {
      delivered: effectiveStatuses.filter((status) => status === "delivered").length,
      notDelivered: effectiveStatuses.filter(
        (status) => status === "not_delivered" || status === "returned"
      ).length,
      annulled: effectiveStatuses.filter((status) => status === "annulled").length,
      liquidationAlerts: liquidationAlertRows.length,
      anomalies: liquidationAlertRows.length + doubleSettlementAnomalies.length,
      pending: effectiveStatuses.filter((status) => status === "pending" || status === "unmatched").length,
      unmatched: logisticsRows.filter((row) => row.match_status === "unmatched").length,
      total: money(rows.reduce((acc, row) => acc + Number(row.amount_to_liquidate || 0), 0)),
    };
  }, [
    doubleSettlementAnomalies.length,
    logisticsRows,
    liquidationAlertRows.length,
    rows,
    settlementTraceByKey,
    visibleOrderRows,
  ]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-card/70 backdrop-blur">
        <div className="container mx-auto flex items-center gap-4 px-4 py-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">Gestion de pedidos y rentabilidad</h1>
            <p className="text-xs text-muted-foreground">
              Liquidaciones, costos por SKU, gastos y utilidad neta
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refresh();
              loadShopifyProducts();
            }}
            className="ml-auto gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </Button>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-4 py-6">
        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-200">
            {error.includes("Could not find the table") || error.includes("schema cache")
              ? "Faltan tablas financieras en Supabase. Ejecuta supabase/finance_schema.sql en SQL Editor."
              : error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <MetricCard label="Entregados" value={String(orderStats.delivered)} />
          <MetricCard label="No entregados" value={String(orderStats.notDelivered)} />
          <MetricCard label="Anulados" value={String(orderStats.annulled)} />
          <MetricCard label="Pendientes" value={String(orderStats.pending)} />
          <MetricCard label="Por reclamar" value={String(orderStats.liquidationAlerts)} warning />
              <MetricCard label="Anomalias" value={String(financeControl.anomalies.length)} warning />
          <MetricCard label="Utilidad neta" value={currency(summary?.net_profit ?? 0)} accent />
        </section>

        <div className="flex gap-2 overflow-x-auto border-b border-border">
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")} icon={<FileSpreadsheet />}>
            Pedidos
          </TabButton>
          <TabButton active={tab === "products"} onClick={() => setTab("products")} icon={<BarChart3 />}>
            Productos
          </TabButton>
          <TabButton active={tab === "notes"} onClick={() => setTab("notes")} icon={<StickyNote />}>
            Notas Shopify
          </TabButton>
          <TabButton active={tab === "settlements"} onClick={() => setTab("settlements")} icon={<ReceiptText />}>
            Liquidaciones
          </TabButton>
          <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")} icon={<ReceiptText />}>
            Gastos
          </TabButton>
          <TabButton active={tab === "monthly"} onClick={() => setTab("monthly")} icon={<FileSpreadsheet />}>
            Cierre mensual
          </TabButton>
          <TabButton active={tab === "files"} onClick={() => setTab("files")} icon={<Database />}>
            Logistica Boxful
          </TabButton>
        </div>

        {loading ? (
          <div className="h-80 animate-pulse border border-border bg-card" />
        ) : (
          <>
            {tab === "orders" && (
              <OrdersTab
                logisticsImports={logisticsImports}
                rows={visibleOrderRows}
                latestLogisticsImport={latestLogisticsImport}
                settlementTraceByKey={settlementTraceByKey}
                shopifyOrderCount={shopifyOrders.length}
                shopifyCoverage={shopifyCoverage}
                syncingShopify={syncingShopify}
                syncMessage={syncMessage}
                onSyncShopify={syncShopifyHistory}
                importingLogistics={importingLogistics}
                onLogisticsImport={handleLogisticsImport}
              />
            )}
            {tab === "products" && (
              <ProductAnalysisTab
                rows={productAnalysisRows}
                costs={costs}
                costVersions={costVersions}
                products={shopifyProducts}
                productsLoading={productsLoading}
                productsError={productsError}
                onSaveProductCost={saveProductCost}
              />
            )}
            {tab === "notes" && (
              <ShopifyNotesTab orders={shopifyOrders} />
            )}
            {tab === "settlements" && (
              <SettlementsTab
                imports={imports}
                rows={matchedSettlementRows}
                shopifyOrders={shopifyOrders}
                liquidationAlertRows={liquidationAlertRows}
                doubleSettlementAnomalies={doubleSettlementAnomalies}
                importing={importing}
                onImport={handleImport}
                onDeleteImport={deleteSettlementImport}
              />
            )}
            {tab === "expenses" && (
              <ExpensesTab
                expenses={expenses}
                form={expenseForm}
                setForm={setExpenseForm}
                onSave={saveExpense}
                onDelete={deleteExpense}
              />
            )}
            {tab === "monthly" && (
              <MonthlyCloseTab
                rows={monthlyCloseRows}
                control={financeControl}
                summary={summary}
                costs={costs}
                onSaveProductCost={saveProductCost}
                claimByAnomalyKey={claimByAnomalyKey}
                onSaveClaim={saveClaim}
              />
            )}
            {tab === "files" && (
              <BoxfulFilesTab
                files={boxfulFiles}
                logisticsImports={logisticsImports}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function OrdersTab({
  logisticsImports,
  rows,
  latestLogisticsImport,
  settlementTraceByKey,
  shopifyOrderCount,
  shopifyCoverage,
  syncingShopify,
  syncMessage,
  onSyncShopify,
  importingLogistics,
  onLogisticsImport,
}: {
  logisticsImports: LogisticsImport[];
  rows: TrackableOrderRow[];
  latestLogisticsImport?: LogisticsImport;
  settlementTraceByKey: Map<string, SettlementTrace[]>;
  shopifyOrderCount: number;
  shopifyCoverage: { count: number; oldest: string | null; newest: string | null } | null;
  syncingShopify: boolean;
  syncMessage: string;
  onSyncShopify: () => void;
  importingLogistics: boolean;
  onLogisticsImport: (event: FormEvent<HTMLFormElement>) => Promise<ImportResult>;
}) {
  const [isLogisticsModalOpen, setIsLogisticsModalOpen] = useState(false);
  const [logisticsModalError, setLogisticsModalError] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [periodMode, setPeriodMode] = useState<OrderPeriodMode>("all");
  const [selectedOrderMonth, setSelectedOrderMonth] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [trackingFilter, setTrackingFilter] = useState<OrderTrackingFilter>("all");
  const [settlementFilter, setSettlementFilter] = useState<OrderSettlementFilter>("all");
  const orderMonthOptions = useMemo(
    () =>
      uniqueKeys(rows.map((row) => getMonthKey(row.shopify_created_at)).filter(Boolean))
        .sort((a, b) => b.localeCompare(a)),
    [rows]
  );
  const periodFilteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesOrderPeriod(row, periodMode, selectedOrderMonth, rangeStart, rangeEnd)
      ),
    [periodMode, rangeEnd, rangeStart, rows, selectedOrderMonth]
  );
  const searchedRows = useMemo(
    () => periodFilteredRows.filter((row) => matchesOrderSearch(row, orderSearch)),
    [periodFilteredRows, orderSearch]
  );
  const trackingCounts = useMemo(() => {
    const counts: Record<OrderTrackingFilter, number> = {
      all: searchedRows.length,
      pending: 0,
      annulled: 0,
      delivered: 0,
      not_delivered: 0,
    };

    for (const row of searchedRows) {
      const status = getEffectiveTrackingStatus(row, getSettlementTracesForLogisticsRow(row, settlementTraceByKey));
      counts[getTrackingFilterFromStatus(status)] += 1;
    }

    return counts;
  }, [searchedRows, settlementTraceByKey]);
  const trackingFilteredRows = useMemo(
    () =>
      searchedRows.filter((row) => {
        if (trackingFilter === "all") return true;
        const status = getEffectiveTrackingStatus(row, getSettlementTracesForLogisticsRow(row, settlementTraceByKey));
        return getTrackingFilterFromStatus(status) === trackingFilter;
      }),
    [searchedRows, settlementTraceByKey, trackingFilter]
  );
  const settlementCounts = useMemo(() => {
    const counts: Record<OrderSettlementFilter, number> = {
      all: trackingFilteredRows.length,
      settled: 0,
      unsettled: 0,
      to_claim: 0,
      duplicate: 0,
    };

    for (const row of trackingFilteredRows) {
      const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
      const trackingStatus = getEffectiveTrackingStatus(row, traces);
      if (traces.length === 1) counts.settled += 1;
      if (traces.length === 0) counts.unsettled += 1;
      if (traces.length === 0 && trackingStatus === "delivered") counts.to_claim += 1;
      if (traces.length > 1) counts.duplicate += 1;
    }

    return counts;
  }, [settlementTraceByKey, trackingFilteredRows]);
  const filteredRows = useMemo(
    () =>
      trackingFilteredRows.filter((row) => {
        if (settlementFilter === "all") return true;
        const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
        const trackingStatus = getEffectiveTrackingStatus(row, traces);
        if (settlementFilter === "settled") return traces.length === 1;
        if (settlementFilter === "unsettled") return traces.length === 0;
        if (settlementFilter === "to_claim") return traces.length === 0 && trackingStatus === "delivered";
        return traces.length > 1;
      }),
    [settlementFilter, settlementTraceByKey, trackingFilteredRows]
  );
  const activeTrackingLabel =
    ORDER_TRACKING_FILTERS.find((filter) => filter.value === trackingFilter)?.label ?? "pedidos";
  const activeSettlementLabel =
    ORDER_SETTLEMENT_FILTERS.find((filter) => filter.value === settlementFilter)?.label ?? "liquidacion";

  useEffect(() => {
    if (!orderMonthOptions.length) {
      setSelectedOrderMonth("");
      return;
    }
    if (!selectedOrderMonth || !orderMonthOptions.includes(selectedOrderMonth)) {
      setSelectedOrderMonth(orderMonthOptions[0]);
    }
  }, [orderMonthOptions, selectedOrderMonth]);

  async function handleModalLogisticsImport(event: FormEvent<HTMLFormElement>) {
    setLogisticsModalError("");
    const result = await onLogisticsImport(event);
    if (result.ok) {
      setIsLogisticsModalOpen(false);
      return;
    }
    setLogisticsModalError(result.error ?? "No se pudo importar el archivo Boxful.");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Seguimiento de pedidos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Shopify es la base; Boxful y liquidaciones actualizan seguimiento y cobros.
            </p>
            {syncMessage && <p className="text-xs text-muted-foreground">{syncMessage}</p>}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={syncingShopify} onClick={onSyncShopify} className="gap-2">
              <Database className="h-4 w-4" />
              {syncingShopify ? "Sincronizando..." : "Sync Shopify"}
            </Button>
            <Button
              type="button"
              disabled={importingLogistics}
              onClick={() => {
                setLogisticsModalError("");
                setIsLogisticsModalOpen(true);
              }}
              className="gap-2"
            >
              {importingLogistics ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importingLogistics ? "Importando..." : "Importar Boxful"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Periodo</span>
            <div className="inline-flex divide-x divide-border border border-border">
              {ORDER_PERIOD_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setPeriodMode(mode.value)}
                  className={`px-3 py-1 text-sm transition-colors ${
                    periodMode === mode.value
                      ? "bg-primary/10 text-primary"
                      : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {periodMode === "month" && (
              <select
                value={selectedOrderMonth}
                onChange={(event) => setSelectedOrderMonth(event.target.value)}
                className="h-8 border border-input bg-background px-2 text-sm outline-none"
                aria-label="Mes"
              >
                {orderMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {formatMonthLabel(month)}
                  </option>
                ))}
              </select>
            )}
            {periodMode === "range" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="h-8 w-[150px]"
                  aria-label="Desde"
                />
                <span className="text-xs text-muted-foreground">a</span>
                <Input
                  type="date"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="h-8 w-[150px]"
                  aria-label="Hasta"
                />
              </div>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              Vista actual{" "}
              <span className="font-mono text-sm font-semibold text-foreground">{periodFilteredRows.length}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Estado</span>
            {ORDER_TRACKING_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setTrackingFilter(filter.value)}
                className={`border px-2.5 py-1 text-sm transition-colors ${
                  trackingFilter === filter.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {filter.label}{" "}
                <span className="ml-1 font-mono text-xs text-foreground">{trackingCounts[filter.value]}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Liquidacion</span>
            {ORDER_SETTLEMENT_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSettlementFilter(filter.value)}
                className={`border px-2.5 py-1 text-sm transition-colors ${
                  settlementFilter === filter.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {filter.label}{" "}
                <span className="ml-1 font-mono text-xs text-foreground">{settlementCounts[filter.value]}</span>
              </button>
            ))}
            {settlementFilter !== "all" && (
              <button
                type="button"
                onClick={() => setSettlementFilter("all")}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Limpiar filtro
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex w-full items-center gap-2 border border-input bg-background px-3 sm:max-w-md">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={orderSearch}
                onChange={(event) => setOrderSearch(event.target.value)}
                placeholder="Buscar pedido: #MCRC11566, 11566, guia o cliente"
                className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {orderSearch && (
                <button
                  type="button"
                  aria-label="Limpiar busqueda"
                  onClick={() => setOrderSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {orderSearch
                ? `${filteredRows.length} de ${searchedRows.length} pedidos encontrados`
                : `Base Shopify: ${shopifyCoverage?.count ?? shopifyOrderCount} pedidos${
                    shopifyCoverage?.oldest ? ` desde ${formatDate(shopifyCoverage.oldest.slice(0, 10))}` : ""
                  }${
                    latestLogisticsImport
                      ? ` - Boxful: ${latestLogisticsImport.total_rows} filas, ${latestLogisticsImport.matched_rows} match, ${latestLogisticsImport.unmatched_rows} sin match`
                      : " - Sin Boxful importado"
                  }`}
            </p>
          </div>
          <OrdersTable
            rows={filteredRows}
            settlementTraceByKey={settlementTraceByKey}
            emptyLabel={
              orderSearch
                ? "No encontramos pedidos con ese codigo y estado."
                : trackingFilter === "all" && settlementFilter === "all"
                  ? "No hay pedidos para mostrar."
                  : trackingFilter === "all"
                  ? `No hay pedidos en ${activeSettlementLabel.toLowerCase()}.`
                  : settlementFilter === "all"
                    ? `No hay pedidos en ${activeTrackingLabel.toLowerCase()}.`
                  : `No hay pedidos en ${activeTrackingLabel.toLowerCase()} con ${activeSettlementLabel.toLowerCase()}.`
            }
          />
          {logisticsImports.length > 1 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Historial de Boxful</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {logisticsImports.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex justify-between gap-3">
                    <span>Boxful: {item.file_name}</span>
                    <span>{item.total_rows} filas</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isLogisticsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logistics-import-title"
        >
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 id="logistics-import-title" className="text-base font-semibold">
                  Importar Boxful logistico
                </h3>
                <p className="text-xs text-muted-foreground">
                  Sube el Excel logistico para actualizar entregados, no entregados y matches Shopify.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={importingLogistics}
                aria-label="Cerrar importacion Boxful"
                onClick={() => {
                  setLogisticsModalError("");
                  setIsLogisticsModalOpen(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={handleModalLogisticsImport} className="space-y-3">
              {logisticsModalError && (
                <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
                  {logisticsModalError}
                </div>
              )}
              <Input name="file" type="file" accept=".xlsx,.xls" required />
              <Input name="period_label" placeholder="Periodo, ej: 13 marzo - 10 junio" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="period_start" type="date" />
                <Input name="period_end" type="date" />
              </div>
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={importingLogistics}
                  onClick={() => {
                    setLogisticsModalError("");
                    setIsLogisticsModalOpen(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={importingLogistics} className="gap-2">
                  {importingLogistics ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {importingLogistics ? "Importando..." : "Subir Boxful"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersTable({
  rows,
  settlementTraceByKey,
  emptyLabel = "No hay pedidos para mostrar.",
}: {
  rows: TrackableOrderRow[];
  settlementTraceByKey: Map<string, SettlementTrace[]>;
  emptyLabel?: string;
}) {
  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1340px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Origen</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Estado seguimiento</th>
            <th className="px-3 py-2">Shopify</th>
            <th className="px-3 py-2">Estado liquidacion</th>
            <th className="px-3 py-2">Archivo liquidacion</th>
            <th className="px-3 py-2 text-right">A liquidar</th>
            <th className="px-3 py-2">Items</th>
            <th className="px-3 py-2 text-right">COD</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row) => {
            const traces = getSettlementTracesForLogisticsRow(row, settlementTraceByKey);
            const trackingStatus = getEffectiveTrackingStatus(row, traces);
            return (
              <tr key={row.row_key} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono text-xs">{row.order_name}</td>
                <td className="px-3 py-2">
                  <Badge variant={row.source === "boxful" ? "success" : row.source === "liquidacion" ? "warning" : "muted"}>
                    {row.source === "boxful" ? "Boxful" : row.source === "liquidacion" ? "Liquidacion" : "Shopify"}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{row.guide_number || "-"}</td>
                <td className="px-3 py-2">{row.customer_name || "Sin nombre"}</td>
                <td className="px-3 py-2">
                  <StatusBadge
                    status={trackingStatus}
                    label={getTrackingStatusLabel(row, traces, trackingStatus)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Badge variant={row.match_status === "matched" ? "success" : "warning"}>
                    {row.match_status === "matched" ? row.shopify_order_name : "sin match"}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <SettlementStatusBadge traces={traces} />
                </td>
                <td className="px-3 py-2">
                  <SettlementFileBadge traces={traces} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {traces.length ? currency(sum(traces.map((trace) => trace.amount_to_liquidate))) : "-"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {(row.package_items ?? []).slice(0, 2).map((item) => item.title).join(", ") || "-"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {currency(row.cod_amount)}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type ProductColumnKey = "product_name" | "cost" | "orders" | "dispatch_rate" | "delivery_effectiveness";

function ProductAnalysisTab({
  rows,
  costs,
  costVersions,
  products,
  productsLoading,
  productsError,
  onSaveProductCost,
}: {
  rows: ProductAnalysisRow[];
  costs: ProductCost[];
  costVersions: ProductCostVersion[];
  products: ShopifyProductOption[];
  productsLoading: boolean;
  productsError: string;
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductAnalysisFilter>("all");
  const [sort, setSort] = useState<{ key: ProductColumnKey; dir: "asc" | "desc" } | null>(null);
  const [editingCostSku, setEditingCostSku] = useState("");
  const [historyCostSku, setHistoryCostSku] = useState("");
  const costBySku = useMemo(
    () => new Map(costs.map((cost) => [cost.sku.toLowerCase(), cost])),
    [costs]
  );
  const versionsBySku = useMemo(() => {
    const grouped = new Map<string, ProductCostVersion[]>();
    for (const version of costVersions) {
      const key = version.sku.toLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), version]);
    }
    for (const [key, list] of Array.from(grouped.entries())) {
      grouped.set(
        key,
        [...list].sort(
          (a, b) =>
            b.effective_from.localeCompare(a.effective_from) ||
            b.created_at.localeCompare(a.created_at)
        )
      );
    }
    return grouped;
  }, [costVersions]);
  const displayRows = useMemo(
    () => mergeProductAnalysisWithCatalog(rows, products),
    [rows, products]
  );
  const filteredRows = useMemo(
    () =>
      displayRows.filter((row) => {
        const haystack = `${row.product_name} ${row.sku} ${row.sample_orders.join(" ")}`.toLowerCase();
        const matchesSearch = haystack.includes(search.trim().toLowerCase());
        return matchesSearch && matchesProductAnalysisFilter(row, statusFilter, costBySku);
      }),
    [displayRows, search, statusFilter, costBySku]
  );
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    const valueOf = (row: ProductAnalysisRow): number | string => {
      if (key === "cost") {
        const cost = getProductCostForAnalysisRow(row, costBySku);
        return cost ? cost.unit_cost + cost.packaging_cost : -1;
      }
      const value = row[key];
      return Array.isArray(value) ? value.join(", ") : value;
    };
    return [...filteredRows].sort((a, b) => {
      const aValue = valueOf(a);
      const bValue = valueOf(b);
      if (typeof aValue === "number" && typeof bValue === "number") {
        return (aValue - bValue) * factor;
      }
      return (
        String(aValue ?? "").localeCompare(String(bValue ?? ""), "es", { sensitivity: "base" }) *
        factor
      );
    });
  }, [filteredRows, sort, costBySku]);
  const summary = useMemo(() => summarizeProductAnalysisRows(filteredRows), [filteredRows]);
  const filterCounts = useMemo(
    () => getProductAnalysisFilterCounts(displayRows, costBySku),
    [displayRows, costBySku]
  );
  const editingRow = editingCostSku
    ? displayRows.find((row) => getProductAnalysisCostKey(row) === editingCostSku.toLowerCase())
    : undefined;
  const historyVersions = historyCostSku
    ? versionsBySku.get(historyCostSku.toLowerCase()) ?? []
    : [];
  const historyRow = historyCostSku
    ? displayRows.find((row) => getProductAnalysisCostLookupKeys(row).includes(historyCostSku.toLowerCase()))
    : undefined;
  const unknownProductRow = useMemo(
    () => displayRows.find((row) => row.product_name === UNKNOWN_PRODUCT_LABEL),
    [displayRows]
  );

  function toggleSort(key: ProductColumnKey, numeric: boolean) {
    setSort((current) => {
      if (current?.key === key) {
        return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      // Numericas arrancan de mayor a menor; texto arranca A-Z.
      return { key, dir: numeric ? "desc" : "asc" };
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="text-base">Analisis por producto</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Productos, costos y tasas en una sola vista. Despacho = con guia / pedidos Shopify.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() =>
              exportCsv(
                "analisis-productos.csv",
                filteredRows.map((row) => ({
                  producto: row.product_name,
                  sku: row.sku,
                  pedidos_ejemplo: row.sample_orders.join(", "),
                  costo_guardado: getProductCostForAnalysisRow(row, costBySku)?.unit_cost ?? "",
                  pedidos: row.orders,
                  unidades: row.units,
                  con_guia: row.dispatched,
                  tasa_despacho: formatPercent(row.dispatch_rate),
                  efectividad_entrega: formatPercent(row.delivery_effectiveness),
                  entregados: row.delivered,
                  no_entregados: row.not_delivered,
                  anulados: row.annulled,
                  pendientes: row.pending,
                }))
              )
            }
          >
            <Download className="h-4 w-4" /> Exportar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {productsError && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
            {productsError}
          </div>
        )}
        <ProductFunnelStats
          productsVisible={filteredRows.length}
          productsLoading={productsLoading}
          summary={summary}
        />
        {unknownProductRow && (
          <div className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Producto sin registrar agrupa {unknownProductRow.orders} pedidos donde no llego detalle de lineas
            Shopify ni resumen de items. Revisa sus pedidos ejemplo en la tabla para ubicar si falta sincronizar
            line_items o si el pedido entro solo desde Boxful/liquidacion.
          </div>
        )}

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative xl:w-[420px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por producto o SKU"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {PRODUCT_ANALYSIS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatusFilter(filter.value)}
                className={`border px-3 py-2 text-sm transition-colors ${
                  statusFilter === filter.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter.label} {filterCounts[filter.value]}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[640px] overflow-y-auto border border-border">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[20%]" />
              <col className="w-[22%]" />
              <col className="w-[12%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <ProductSortableHeader label="Producto" columnKey="product_name" sort={sort} onSort={toggleSort} />
                <ProductSortableHeader label="Costo SKU" columnKey="cost" sort={sort} onSort={toggleSort} numeric />
                <ProductSortableHeader label="Funnel" columnKey="orders" sort={sort} onSort={toggleSort} numeric />
                <ProductSortableHeader
                  label="Despacho"
                  columnKey="dispatch_rate"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                  className="text-cyan-300"
                />
                <ProductSortableHeader
                  label="Entrega"
                  columnKey="delivery_effectiveness"
                  sort={sort}
                  onSort={toggleSort}
                  numeric
                  className="text-emerald-300"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.slice(0, 800).map((row) => (
                <tr key={row.key} className="border-t border-border/50">
                  <td className="px-3 py-3 align-top">
                    <p className="truncate font-medium" title={row.product_name}>{row.product_name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {row.sku ? (
                        <span className="font-mono">SKU {row.sku}</span>
                      ) : row.product_name === UNKNOWN_PRODUCT_LABEL ? (
                        <Badge variant="warning">Sin producto</Badge>
                      ) : (
                        <span>Sin SKU Shopify</span>
                      )}
                      {row.sample_orders.length > 0 && (
                        <span className="truncate font-mono" title={row.sample_orders.join(", ")}>
                          Ej: {row.sample_orders.slice(0, 2).join(", ")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top">
                    {getProductAnalysisCostKey(row) ? (
                      <ProductCostCell
                        cost={getProductCostForAnalysisRow(row, costBySku)}
                        versionCount={getProductVersionsForAnalysisRow(row, versionsBySku).length}
                        onEdit={() => setEditingCostSku(getProductAnalysisCostKey(row))}
                        onHistory={() =>
                          setHistoryCostSku(
                            getProductVersionKeyForAnalysisRow(row, versionsBySku) || getProductAnalysisCostKey(row)
                          )
                        }
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">Falta detalle de producto</span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <ProductFunnelCell row={row} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <RateMeter value={row.dispatch_rate} tone="cyan" detail={`${row.dispatched}/${row.orders}`} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    <RateMeter
                      value={row.delivery_effectiveness}
                      tone="emerald"
                      detail={`${row.delivered}/${row.dispatched}`}
                    />
                  </td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No hay productos para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {sortedRows.length > 800 && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Mostrando 800 de {sortedRows.length} productos.
            </div>
          )}
        </div>
      </CardContent>
      {editingRow && (
        <ProductCostQuickEditModal
          sku={getProductAnalysisCostKey(editingRow)}
          productName={editingRow.product_name}
          referenceLabel={editingRow.sku ? `SKU ${editingRow.sku}` : "Clave interna por producto sin SKU"}
          savedCost={getProductCostForAnalysisRow(editingRow, costBySku)}
          onClose={() => setEditingCostSku("")}
          onSave={onSaveProductCost}
        />
      )}
      {historyCostSku && (
        <CostHistoryModal
          productName={historyRow?.product_name ?? historyVersions[0]?.product_name ?? "Producto"}
          sku={historyCostSku}
          versions={historyVersions}
          onClose={() => setHistoryCostSku("")}
        />
      )}
    </Card>
  );
}

function ProductSortableHeader({
  label,
  columnKey,
  sort,
  onSort,
  numeric = false,
  className = "",
}: {
  label: string;
  columnKey: ProductColumnKey;
  sort: { key: ProductColumnKey; dir: "asc" | "desc" } | null;
  onSort: (key: ProductColumnKey, numeric: boolean) => void;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={() => onSort(columnKey, numeric)}
        className={`inline-flex w-full items-center gap-1 transition-colors hover:text-foreground ${className}`}
        title="Ordenar por esta columna"
      >
        {label}
        {sort?.key === columnKey &&
          (sort.dir === "asc" ? (
            <ArrowUp className="h-3 w-3 shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 shrink-0" />
          ))}
      </button>
    </th>
  );
}

function ProductFunnelStats({
  productsVisible,
  productsLoading,
  summary,
}: {
  productsVisible: number;
  productsLoading: boolean;
  summary: Pick<
    ProductAnalysisRow,
    "orders" | "dispatched" | "delivered" | "not_delivered" | "annulled" | "pending" | "dispatch_rate" | "delivery_effectiveness"
  >;
}) {
  const stats = [
    { label: "Productos", value: productsLoading ? "..." : productsVisible },
    { label: "Pedidos", value: summary.orders },
    { label: "Despachados", value: summary.dispatched },
    { label: "Anulados", value: summary.annulled },
    { label: "Entregados", value: summary.delivered },
    { label: "No entregados", value: summary.not_delivered },
    { label: "Pendientes", value: summary.pending },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {stats.map((stat) => (
        <div key={stat.label} className="border border-border bg-background px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{stat.label}</p>
          <p className="mt-1 font-mono text-lg font-semibold">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}

function ProductFunnelCell({ row }: { row: ProductAnalysisRow }) {
  const items = [
    ["Ped", row.orders],
    ["Desp", row.dispatched],
    ["Anul", row.annulled],
    ["Ent", row.delivered],
    ["No", row.not_delivered],
    ["Pend", row.pending],
  ];
  return (
    <div className="grid grid-cols-3 gap-1 text-[11px]">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-1 border border-border/60 px-1.5 py-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ProductCostCell({
  cost,
  versionCount,
  onEdit,
  onHistory,
}: {
  cost?: ProductCost;
  versionCount: number;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const totalCost = cost ? Number(cost.unit_cost || 0) + Number(cost.packaging_cost || 0) : 0;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        {cost && totalCost > 0 ? (
          <>
            <p className="font-mono text-xs">{currency(totalCost)}</p>
            <p className="text-[11px] text-muted-foreground">
              Unitario {currency(cost.unit_cost)} + empaque {currency(cost.packaging_cost)}
            </p>
          </>
        ) : (
          <span className="text-xs font-medium text-amber-300">Sin costo</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          title="Editar costo"
          aria-label="Editar costo"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {versionCount > 1 && (
          <button
            type="button"
            onClick={onHistory}
            title={`Historial (${versionCount} versiones)`}
            aria-label="Historial de costos"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function ProductCostQuickEditModal({
  sku,
  productName,
  referenceLabel,
  savedCost,
  onClose,
  onSave,
}: {
  sku: string;
  productName: string;
  referenceLabel?: string;
  savedCost?: ProductCost;
  onClose: () => void;
  onSave: (input: ProductCostSaveInput) => Promise<void>;
}) {
  const [unitCost, setUnitCost] = useState(String(savedCost?.unit_cost || ""));
  const [packagingCost, setPackagingCost] = useState(String(savedCost?.packaging_cost || ""));
  const [effectiveFrom, setEffectiveFrom] = useState(
    savedCost?.effective_from || new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  async function handleSave() {
    const parsedUnitCost = Number(unitCost);
    const parsedPackagingCost = Number(packagingCost || 0);
    if (!Number.isFinite(parsedUnitCost) || parsedUnitCost <= 0) {
      setValidationMessage("El costo unitario debe ser mayor que cero.");
      return;
    }
    if (!Number.isFinite(parsedPackagingCost) || parsedPackagingCost < 0) {
      setValidationMessage("El empaque propio no puede ser negativo.");
      return;
    }
    if (!effectiveFrom) {
      setValidationMessage("Selecciona la fecha desde la que aplica este costo.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        sku,
        product_name: productName,
        unit_cost: parsedUnitCost,
        packaging_cost: parsedPackagingCost,
        effective_from: effectiveFrom,
      });
      onClose();
    } catch {
      setValidationMessage("No se pudo guardar el costo. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-cost-edit-title"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 id="product-cost-edit-title" className="text-base font-semibold">
              Costo del producto
            </h3>
            <p className="truncate text-sm text-muted-foreground" title={productName}>
              {productName}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{referenceLabel ?? `SKU ${sku}`}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Costo unitario
            <Input
              type="number"
              min="0"
              step="any"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Empaque propio (por unidad)
            <Input
              type="number"
              min="0"
              step="any"
              value={packagingCost}
              onChange={(event) => setPackagingCost(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Vigente desde
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          {validationMessage && (
            <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
              {validationMessage}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={handleSave} className="gap-2">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Guardando..." : "Guardar costo"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RateMeter({
  value,
  tone,
  detail,
}: {
  value: number;
  tone: "cyan" | "emerald";
  detail?: string;
}) {
  const clampedValue = Math.max(0, Math.min(100, Number(value || 0)));
  const barClass = tone === "emerald" ? "bg-emerald-400" : "bg-cyan-400";
  const textClass = tone === "emerald" ? "text-emerald-300" : "text-cyan-300";

  // El % va antes de la barra y en su mismo color para que no se confunda
  // con la barra de la columna vecina.
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`w-10 shrink-0 text-right font-mono text-xs font-semibold ${textClass}`}>
          {formatPercent(clampedValue)}
        </span>
        <div className="h-2 flex-1 overflow-hidden bg-muted">
          <div className={`h-full ${barClass}`} style={{ width: `${clampedValue}%` }} />
        </div>
      </div>
      {detail && <p className="text-right font-mono text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function ShopifyNotesTab({ orders }: { orders: ShopifyOrderSummary[] }) {
  const [noteSearch, setNoteSearch] = useState("");
  const [onlyRowsWithCode, setOnlyRowsWithCode] = useState(true);
  const noteAliasRows = useMemo(() => buildShopifyNoteAliasRows(orders), [orders]);
  const filteredRows = useMemo(
    () =>
      noteAliasRows.filter(
        (row) =>
          (!onlyRowsWithCode || Boolean(row.note_order_number)) &&
          matchesShopifyNoteAliasSearch(row, noteSearch)
      ),
    [noteAliasRows, noteSearch, onlyRowsWithCode]
  );
  const noteOrderCount = useMemo(
    () => new Set(noteAliasRows.map((row) => row.shopify_order_name)).size,
    [noteAliasRows]
  );
  const rowsWithCode = noteAliasRows.filter((row) => row.note_order_number).length;

  function exportAliases() {
    exportCsv(
      `shopify-notas-alias-${new Date().toISOString().slice(0, 10)}.csv`,
      filteredRows.map((row) => ({
        codigo_pedido_shopify: row.shopify_order_name,
        numero_pedido_en_nota: row.note_order_number || "Sin codigo",
      }))
    );
  }

  return (
    <Card>
      <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Notas Shopify</CardTitle>
          <p className="text-xs text-muted-foreground">
            Alias de notas Shopify de los ultimos {FINANCE_SHOPIFY_NOTES_LOOKBACK_DAYS} dias para cruzar codigos del bot.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={exportAliases} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar alias
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Pedidos Shopify" value={orders.length} />
          <MiniStat label="Pedidos con nota" value={noteOrderCount} />
          <MiniStat label="Alias extraidos" value={rowsWithCode} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex w-full items-center gap-2 border border-input bg-background px-3 lg:max-w-xl">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={noteSearch}
                onChange={(event) => setNoteSearch(event.target.value)}
                placeholder="Buscar por #MCRC10269 o por codigo de nota 3685"
                className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {noteSearch && (
                <button
                  type="button"
                  aria-label="Limpiar busqueda"
                  onClick={() => setNoteSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setOnlyRowsWithCode(true)}
                className={`border px-3 py-2 text-xs transition-colors ${
                  onlyRowsWithCode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Con codigo {rowsWithCode}
              </button>
              <button
                type="button"
                onClick={() => setOnlyRowsWithCode(false)}
                className={`border px-3 py-2 text-xs transition-colors ${
                  !onlyRowsWithCode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Todas {noteAliasRows.length}
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {filteredRows.length} de {noteAliasRows.length} notas
          </p>
        </div>

        <div className="max-h-[620px] overflow-auto border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2">Codigo del pedido</th>
                <th className="px-3 py-2">Numero de pedido en la nota</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 1000).map((row) => (
                <tr key={row.row_key} className="border-b border-border/50">
                  <td className="px-3 py-2 font-mono text-xs">{row.shopify_order_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.note_order_number ? (
                      row.note_order_number
                    ) : (
                      <Badge variant="warning">Sin codigo</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={2} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No hay notas Shopify con ese codigo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function SettlementsTab({
  imports,
  rows,
  shopifyOrders,
  liquidationAlertRows,
  doubleSettlementAnomalies,
  importing,
  onImport,
  onDeleteImport,
}: {
  imports: SettlementImport[];
  rows: SettlementRow[];
  shopifyOrders: ShopifyOrderSummary[];
  liquidationAlertRows: LogisticsRow[];
  doubleSettlementAnomalies: DoubleSettlementAnomaly[];
  importing: boolean;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteImport: (id: number) => Promise<void>;
}) {
  const [selectedImportId, setSelectedImportId] = useState<number | null>(imports[0]?.id ?? null);
  const [importSort, setImportSort] = useState<SettlementImportSort>("recent");
  const [shopifyFilter, setShopifyFilter] = useState<SettlementShopifyFilter>("all");
  const [deletingImportId, setDeletingImportId] = useState<number | null>(null);
  const [showClaimList, setShowClaimList] = useState(false);
  const [showDoubleList, setShowDoubleList] = useState(false);
  const fileByImportId = useMemo(
    () => new Map(imports.map((item) => [item.id, item.file_name])),
    [imports]
  );
  const enrichedRows = useMemo(
    () => enrichSettlementRowsWithShopify(rows, shopifyOrders),
    [rows, shopifyOrders]
  );
  const sortedImports = useMemo(() => {
    return [...imports].sort((a, b) => {
      const aDate = a.period_end || a.created_at || "";
      const bDate = b.period_end || b.created_at || "";
      const dateSort = bDate.localeCompare(aDate) || b.created_at.localeCompare(a.created_at);
      return importSort === "recent" ? dateSort : -dateSort;
    });
  }, [importSort, imports]);
  const selectedImport =
    imports.find((item) => item.id === selectedImportId) ?? sortedImports[0] ?? null;
  const activeSettlementImportId = selectedImport?.id ?? null;
  const selectedRows = useMemo(
    () =>
      activeSettlementImportId
        ? enrichedRows.filter((row) => row.import_id === activeSettlementImportId)
        : [],
    [activeSettlementImportId, enrichedRows]
  );
  const settlementMatchCounts = useMemo(
    () => ({
      all: selectedRows.length,
      matched: selectedRows.filter((row) => row.match_status === "matched").length,
      unmatched: selectedRows.filter((row) => row.match_status !== "matched").length,
    }),
    [selectedRows]
  );
  const visibleSettlementRows = useMemo(
    () =>
      selectedRows.filter((row) => {
        if (shopifyFilter === "all") return true;
        if (shopifyFilter === "matched") return row.match_status === "matched";
        return row.match_status !== "matched";
      }),
    [selectedRows, shopifyFilter]
  );

  useEffect(() => {
    if (!imports.length) {
      setSelectedImportId(null);
      return;
    }
    if (!imports.some((item) => item.id === selectedImportId)) {
      setSelectedImportId(sortedImports[0]?.id ?? imports[0].id);
    }
  }, [imports, selectedImportId, sortedImports]);

  async function handleDeleteImport(item: SettlementImport) {
    const ok = window.confirm(`Eliminar la liquidacion "${item.file_name}" y sus filas importadas?`);
    if (!ok) return;
    setDeletingImportId(item.id);
    try {
      await onDeleteImport(item.id);
    } finally {
      setDeletingImportId(null);
    }
  }

  const claimAlertTotal = sum(liquidationAlertRows.map((row) => Number(row.cod_amount || 0)));

  return (
    <div className="space-y-4">
      {(liquidationAlertRows.length > 0 || doubleSettlementAnomalies.length > 0) && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-base">Alertas de cobro</CardTitle>
            <p className="text-xs text-muted-foreground">
              Globales sobre todas las liquidaciones importadas; no dependen del archivo seleccionado.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {liquidationAlertRows.length > 0 && (
              <div className="border border-amber-500/40 bg-amber-500/10">
                <button
                  type="button"
                  onClick={() => setShowClaimList((value) => !value)}
                  aria-expanded={showClaimList}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                >
                  <span className="flex items-center gap-2 text-amber-100">
                    {showClaimList ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-semibold">Entregados sin liquidacion</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-amber-100">{currency(claimAlertTotal)}</span>
                    <Badge variant="warning">{liquidationAlertRows.length} por reclamar</Badge>
                  </span>
                </button>
                {showClaimList && (
                  <div className="border-t border-amber-500/30 p-3">
                    <ClaimAlertsTable rows={liquidationAlertRows} />
                  </div>
                )}
              </div>
            )}
            {doubleSettlementAnomalies.length > 0 && (
              <div className="border border-red-500/40 bg-red-500/10">
                <button
                  type="button"
                  onClick={() => setShowDoubleList((value) => !value)}
                  aria-expanded={showDoubleList}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left"
                >
                  <span className="flex items-center gap-2 text-red-100">
                    {showDoubleList ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-semibold">Doble liquidacion detectada</span>
                  </span>
                  <Badge variant="destructive">{doubleSettlementAnomalies.length} anomalias</Badge>
                </button>
                {showDoubleList && (
                  <div className="border-t border-red-500/30 p-3">
                    <DoubleSettlementTable anomalies={doubleSettlementAnomalies} />
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar liquidacion</CardTitle>
          <p className="text-xs text-muted-foreground">
            El nombre del Excel se guarda como identificador Boxful.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onImport} className="space-y-3">
            <Input name="file" type="file" accept=".xlsx,.xls" required />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Fecha de corte</span>
              <Input name="period_end" type="date" required />
            </label>
            <Button type="submit" disabled={importing} className="w-full gap-2">
              {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Importando..." : "Subir liquidacion"}
            </Button>
          </form>
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">Liquidaciones importadas</p>
              <div className="flex gap-1">
                {SETTLEMENT_IMPORT_SORTS.map((sort) => (
                  <button
                    key={sort.value}
                    type="button"
                    onClick={() => setImportSort(sort.value)}
                    className={`border px-2 py-1 text-xs transition-colors ${
                      importSort === sort.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {sort.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
              {sortedImports.map((item) => {
                const active = selectedImport?.id === item.id;
                const deleting = deletingImportId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`grid grid-cols-[1fr_auto] gap-2 border p-2 transition-colors ${
                      active ? "border-primary bg-primary/10" : "border-border bg-background"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedImportId(item.id)}
                      className="min-w-0 text-left"
                    >
                      <span className={`block truncate text-xs font-semibold ${active ? "text-primary" : "text-foreground"}`} title={item.file_name}>
                        {item.file_name}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.period_end ? formatDate(item.period_end) : "Sin corte"} - {item.total_rows} filas - {currency(item.total_to_liquidate)}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Eliminar liquidacion"
                      aria-label={`Eliminar ${item.file_name}`}
                      disabled={deleting}
                      onClick={() => handleDeleteImport(item)}
                      className="self-start text-muted-foreground transition-colors hover:text-red-300 disabled:opacity-50"
                    >
                      {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                );
              })}
              {!sortedImports.length && (
                <p className="border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                  Aun no hay liquidaciones importadas.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedImport ? selectedImport.file_name : "Sin liquidaciones importadas"}
          </CardTitle>
          {selectedImport?.file_name && (
            <p className="text-xs text-muted-foreground">
              Archivo registrado en Boxful: {selectedImport.file_name}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <MiniStat label="Corte" value={selectedImport?.period_end ? formatDate(selectedImport.period_end) : "-"} />
            <MiniStat label="Filas" value={selectedImport?.total_rows ?? 0} />
            <MiniStat label="Match Shopify" value={settlementMatchCounts.matched} />
            <MiniStat label="Sin match" value={settlementMatchCounts.unmatched} />
            <MiniStat label="A liquidar" value={currency(selectedImport?.total_to_liquidate ?? 0)} />
          </div>
          <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Mostrando {visibleSettlementRows.length} de {selectedRows.length} filas de esta liquidacion.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Shopify</span>
              {SETTLEMENT_SHOPIFY_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setShopifyFilter(filter.value)}
                  className={`border px-3 py-1.5 text-xs transition-colors ${
                    shopifyFilter === filter.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {filter.label} ({settlementMatchCounts[filter.value]})
                </button>
              ))}
            </div>
          </div>
          <SettlementRowsTable
            rows={visibleSettlementRows}
            fileByImportId={fileByImportId}
            emptyLabel={
              selectedImport
                ? "No hay filas con ese filtro de Shopify."
                : "Selecciona o importa una liquidacion para ver sus filas."
            }
          />
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function SettlementRowsTable({
  rows,
  fileByImportId,
  emptyLabel = "No hay filas para mostrar.",
}: {
  rows: SettlementRow[];
  fileByImportId: Map<number, string>;
  emptyLabel?: string;
}) {
  return (
    <div className="max-h-[560px] overflow-auto border border-border">
      <table className="w-full min-w-[1040px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Archivo</th>
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Estado liquidacion</th>
            <th className="px-3 py-2">Shopify</th>
            <th className="px-3 py-2 text-right">A liquidar</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row) => (
            <tr key={row.id} className="border-b border-border/50">
              <td className="max-w-[260px] truncate px-3 py-2 text-xs" title={fileByImportId.get(row.import_id)}>
                {fileByImportId.get(row.import_id) || `Import #${row.import_id}`}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.order_name}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.guide_number}</td>
              <td className="px-3 py-2">{row.customer_name || "Sin nombre"}</td>
              <td className="px-3 py-2">
                <StatusBadge status={row.internal_status} label={row.settlement_status} />
              </td>
              <td className="px-3 py-2">
                <Badge variant={row.match_status === "matched" ? "success" : "warning"}>
                  {row.match_status === "matched" ? row.shopify_order_name : "sin match"}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.amount_to_liquidate)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SettlementStatusBadge({ traces }: { traces: SettlementTrace[] }) {
  if (!traces.length) {
    return <Badge variant="muted">Sin liquidacion</Badge>;
  }
  if (traces.length > 1) {
    return <Badge variant="warning">Doble liquidacion</Badge>;
  }

  return <Badge variant="success">Liquidada</Badge>;
}

function SettlementFileBadge({ traces }: { traces: SettlementTrace[] }) {
  if (!traces.length) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  const [firstTrace, ...extraTraces] = traces;
  return (
    <div className="flex max-w-[260px] items-center gap-2">
      <span className="truncate text-xs font-medium" title={firstTrace.file_name}>
        {firstTrace.file_name}
      </span>
      {extraTraces.length > 0 && <Badge variant="warning">+{extraTraces.length}</Badge>}
    </div>
  );
}

function ClaimAlertsTable({ rows }: { rows: LogisticsRow[] }) {
  return (
    <div className="max-h-72 overflow-auto border border-amber-500/30 bg-background/70">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Courier</th>
            <th className="px-3 py-2 text-right">COD esperado</th>
            <th className="px-3 py-2">Accion</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 80).map((row) => (
            <tr key={row.id} className="border-b border-border/50">
              <td className="px-3 py-2 font-mono text-xs">{row.order_name}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.guide_number}</td>
              <td className="px-3 py-2">{row.customer_name || "Sin nombre"}</td>
              <td className="px-3 py-2">{row.courier || "-"}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.cod_amount)}</td>
              <td className="px-3 py-2">
                <Badge variant="warning">Reclamar liquidacion</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 80 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Mostrando 80 de {rows.length} alertas.
        </div>
      )}
    </div>
  );
}

function DoubleSettlementTable({ anomalies }: { anomalies: DoubleSettlementAnomaly[] }) {
  return (
    <div className="max-h-72 overflow-auto border border-red-500/30 bg-background/70">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Llave</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2">Archivos</th>
            <th className="px-3 py-2 text-right">Liquidaciones</th>
            <th className="px-3 py-2 text-right">Total A liquidar</th>
            <th className="px-3 py-2">Accion</th>
          </tr>
        </thead>
        <tbody>
          {anomalies.slice(0, 80).map((anomaly) => {
            const total = anomaly.traces.reduce(
              (acc, trace) => acc + Number(trace.amount_to_liquidate || 0),
              0
            );
            return (
              <tr key={`${anomaly.kind}-${anomaly.key}`} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono text-xs">{anomaly.key}</td>
                <td className="px-3 py-2">
                  <Badge variant="warning">{anomaly.kind === "order" ? "Orden" : "Guia"}</Badge>
                </td>
                <td className="px-3 py-2 text-xs">
                  {anomaly.traces.slice(0, 3).map((trace) => (
                    <div key={`${trace.file_name}-${trace.amount_to_liquidate}`} className="max-w-[320px] truncate" title={trace.file_name}>
                      {trace.file_name} - {trace.settlement_status || "sin estado"} - {currency(trace.amount_to_liquidate)}
                    </div>
                  ))}
                  {anomaly.traces.length > 3 && (
                    <div className="text-muted-foreground">+{anomaly.traces.length - 3} mas</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{anomaly.traces.length}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{currency(total)}</td>
                <td className="px-3 py-2">
                  <Badge variant="destructive">Revisar cobro duplicado</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anomalies.length > 80 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Mostrando 80 de {anomalies.length} anomalias.
        </div>
      )}
    </div>
  );
}

function CostsTab({
  costs,
  products,
  productsLoading,
  productsError,
  productSearch,
  setProductSearch,
  versions,
  onSaveProductCost,
}: {
  costs: ProductCost[];
  products: ShopifyProductOption[];
  productsLoading: boolean;
  productsError: string;
  productSearch: string;
  setProductSearch: (value: string) => void;
  versions: ProductCostVersion[];
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
}) {
  const [activeCostView, setActiveCostView] = useState<"missing" | "saved">("missing");
  const [editingSku, setEditingSku] = useState("");
  const [historySku, setHistorySku] = useState("");
  const costBySku = useMemo(
    () => new Map(costs.map((cost) => [cost.sku.toLowerCase(), cost])),
    [costs]
  );
  const versionsBySku = useMemo(() => {
    const grouped = new Map<string, ProductCostVersion[]>();
    for (const version of versions) {
      const key = version.sku.toLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), version]);
    }
    for (const [key, rows] of Array.from(grouped.entries())) {
      grouped.set(
        key,
        [...rows].sort(
          (a, b) =>
            b.effective_from.localeCompare(a.effective_from) ||
            b.created_at.localeCompare(a.created_at)
        )
      );
    }
    return grouped;
  }, [versions]);
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.display_name.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query)
    );
  }, [productSearch, products]);
  const productRows = useMemo(
    () =>
      filteredProducts.map((product) => {
        const savedCost = product.sku ? costBySku.get(product.sku.toLowerCase()) : undefined;
        const hasSavedCost = Boolean(product.sku && savedCost && Number(savedCost.unit_cost || 0) > 0);
        return { product, savedCost, hasSavedCost };
      }),
    [costBySku, filteredProducts]
  );
  const missingCostCount = productRows.filter((row) => !row.hasSavedCost).length;
  const savedCostCount = productRows.filter((row) => row.hasSavedCost).length;
  const visibleProductRows = productRows.filter((row) =>
    activeCostView === "saved" ? row.hasSavedCost : !row.hasSavedCost
  );
  const historyVersions = historySku ? versionsBySku.get(historySku.toLowerCase()) ?? [] : [];
  const historyProduct = historySku
    ? productRows.find((row) => row.product.sku.toLowerCase() === historySku.toLowerCase())?.product
    : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Productos Shopify</CardTitle>
            <p className="text-xs text-muted-foreground">
              Edita una fila, define costo unitario y fecha efectiva, y guarda para validar. Empaque propio
              es tu costo interno de empaque por unidad, separado del empaque cobrado por Boxful.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 border border-input bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Buscar por producto o SKU"
                className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {productsError && (
              <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
                {productsError}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-b border-border">
              <button
                type="button"
                onClick={() => setActiveCostView("missing")}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeCostView === "missing"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Sin costo ({missingCostCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveCostView("saved")}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeCostView === "saved"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Con costo ({savedCostCount})
              </button>
            </div>
            <div className="max-h-[360px] overflow-auto border border-border">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Precio Shopify</th>
                    <th className="px-3 py-2 text-right">Costo unitario</th>
                    <th className="px-3 py-2 text-right">Empaque propio</th>
                    <th className="px-3 py-2">Vigente desde</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2 text-right">Historial</th>
                    <th className="px-3 py-2 text-right">Accion</th>
                  </tr>
                </thead>
                <tbody>
                  {productsLoading ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Cargando productos Shopify...
                      </td>
                    </tr>
                  ) : visibleProductRows.length ? (
                    visibleProductRows.slice(0, 250).map(({ product, savedCost, hasSavedCost }) => (
                      <ProductCostRow
                        key={product.variant_id}
                        product={product}
                        savedCost={savedCost}
                        hasSavedCost={hasSavedCost}
                        costVersions={product.sku ? versionsBySku.get(product.sku.toLowerCase()) ?? [] : []}
                        isEditing={Boolean(product.sku && editingSku === product.sku)}
                        onEdit={() => product.sku && setEditingSku(product.sku)}
                        onOpenHistory={() => product.sku && setHistorySku(product.sku)}
                        onSaved={() => setEditingSku("")}
                        onSave={onSaveProductCost}
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {activeCostView === "saved"
                          ? "No hay SKUs con costo guardado en esta busqueda."
                          : "No hay SKUs pendientes de costo en esta busqueda."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

      </div>
      {historySku && (
        <CostHistoryModal
          productName={historyProduct?.display_name ?? historyVersions[0]?.product_name ?? "Producto"}
          sku={historySku}
          versions={historyVersions}
          onClose={() => setHistorySku("")}
        />
      )}
    </div>
  );
}

function CostHistoryModal({
  productName,
  sku,
  versions,
  onClose,
}: {
  productName: string;
  sku: string;
  versions: ProductCostVersion[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cost-history-title"
    >
      <div className="w-full max-w-3xl rounded-lg border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h3 id="cost-history-title" className="text-base font-semibold">
              Historial de costos
            </h3>
            <p className="truncate text-sm text-muted-foreground" title={productName}>
              {productName}
            </p>
            <p className="font-mono text-xs text-muted-foreground">SKU {sku}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar historial" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[460px] overflow-auto border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2">Fecha efectiva</th>
                <th className="px-3 py-2">Registrado</th>
                <th className="px-3 py-2 text-right">Costo unitario</th>
                <th className="px-3 py-2 text-right">Empaque propio</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version, index) => (
                <tr key={`${version.id}-${version.created_at}`} className="border-t border-border/50">
                  <td className="px-3 py-2">
                    {index === 0 ? <Badge variant="success">Actual</Badge> : <Badge variant="muted">Anterior</Badge>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(version.effective_from)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{formatDate(version.created_at)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{currency(version.unit_cost)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{currency(version.packaging_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProductCostRow({
  product,
  savedCost,
  hasSavedCost,
  costVersions,
  isEditing,
  onEdit,
  onOpenHistory,
  onSaved,
  onSave,
}: {
  product: ShopifyProductOption;
  savedCost?: ProductCost;
  hasSavedCost: boolean;
  costVersions: ProductCostVersion[];
  isEditing: boolean;
  onEdit: () => void;
  onOpenHistory: () => void;
  onSaved: () => void;
  onSave: (input: ProductCostSaveInput) => Promise<void>;
}) {
  const [unitCost, setUnitCost] = useState(String(savedCost?.unit_cost || ""));
  const [packagingCost, setPackagingCost] = useState(String(savedCost?.packaging_cost || ""));
  const [effectiveFrom, setEffectiveFrom] = useState(
    savedCost?.effective_from || new Date().toISOString().slice(0, 10)
  );
  const [saving, setSaving] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const hasHistory = costVersions.length > 1;

  useEffect(() => {
    if (!isEditing) return;
    setUnitCost(String(savedCost?.unit_cost || ""));
    setPackagingCost(String(savedCost?.packaging_cost || ""));
    setEffectiveFrom(savedCost?.effective_from || new Date().toISOString().slice(0, 10));
    setValidationMessage("");
  }, [isEditing, savedCost?.effective_from, savedCost?.packaging_cost, savedCost?.unit_cost]);

  async function handleAction() {
    if (!product.sku) return;
    if (!isEditing) {
      setValidationMessage("");
      onEdit();
      return;
    }

    const parsedUnitCost = Number(unitCost);
    const parsedPackagingCost = Number(packagingCost || 0);
    if (!Number.isFinite(parsedUnitCost) || parsedUnitCost <= 0) {
      setValidationMessage("El costo unitario debe ser mayor que cero para validar el SKU.");
      return;
    }
    if (!Number.isFinite(parsedPackagingCost) || parsedPackagingCost < 0) {
      setValidationMessage("El empaque propio no puede ser negativo.");
      return;
    }
    if (!effectiveFrom) {
      setValidationMessage("Selecciona la fecha desde la que aplica este costo.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        sku: product.sku,
        product_name: product.display_name,
        unit_cost: parsedUnitCost,
        packaging_cost: parsedPackagingCost,
        effective_from: effectiveFrom,
      });
      setValidationMessage("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className="border-t border-border/50">
        <td className="px-3 py-2">{product.display_name}</td>
        <td className="px-3 py-2 font-mono text-xs">
          {product.sku || <span className="text-amber-300">Sin SKU</span>}
        </td>
        <td className="px-3 py-2 text-right font-mono text-xs">{currency(product.price)}</td>
        <td className="px-3 py-2 text-right">
          {isEditing ? (
            <Input
              type="number"
              min="0"
              step="1"
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              className="ml-auto h-8 w-28 px-2 text-right font-mono text-xs"
              placeholder="0"
            />
          ) : savedCost ? (
            <span className="font-mono text-xs">{currency(savedCost.unit_cost)}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {isEditing ? (
            <Input
              type="number"
              min="0"
              step="1"
              value={packagingCost}
              onChange={(event) => setPackagingCost(event.target.value)}
              className="ml-auto h-8 w-28 px-2 text-right font-mono text-xs"
              placeholder="0"
            />
          ) : savedCost ? (
            <span className="font-mono text-xs">{currency(savedCost.packaging_cost)}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-3 py-2">
          {isEditing ? (
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              className="h-8 w-36 px-2 font-mono text-xs"
            />
          ) : savedCost?.effective_from ? (
            <span className="font-mono text-xs">{formatDate(savedCost.effective_from)}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-3 py-2">
          {!product.sku ? (
            <Badge variant="warning">Sin SKU</Badge>
          ) : hasSavedCost ? (
            <Badge variant="success">Con costo</Badge>
          ) : (
            <Badge variant="warning">Sin costo</Badge>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasHistory}
            onClick={onOpenHistory}
            className="gap-2"
            title={hasHistory ? "Ver historial de cambios" : "Este SKU aun no tiene cambios historicos"}
          >
            <History className="h-4 w-4" />
            {hasHistory ? `Ver (${costVersions.length})` : "Sin cambios"}
          </Button>
        </td>
        <td className="px-3 py-2 text-right">
          <Button
            type="button"
            size="sm"
            variant={isEditing ? "default" : "outline"}
            disabled={!product.sku || saving}
            onClick={handleAction}
          >
            {saving ? "Guardando..." : isEditing ? "Guardar" : "Editar"}
          </Button>
        </td>
      </tr>
      {isEditing && validationMessage && (
        <tr className="border-t border-border/50 bg-amber-950/20">
          <td colSpan={9} className="px-3 py-2 text-xs text-amber-200">
            {validationMessage}
          </td>
        </tr>
      )}
    </>
  );
}

function ExpensesTab({
  expenses,
  form,
  setForm,
  onSave,
  onDelete,
}: {
  expenses: BusinessExpense[];
  form: typeof emptyExpense;
  setForm: (form: typeof emptyExpense) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onDelete: (id: number) => void;
}) {
  const [activeType, setActiveType] = useState<ExpenseType>("ads");
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const activeView =
    EXPENSE_VIEW_CONFIG.find((view) => view.type === activeType) ?? EXPENSE_VIEW_CONFIG[0];
  const visibleExpenses = expenses.filter((expense) => expense.type === activeType);
  const payrollPeople = uniqueKeys(
    expenses
      .filter((expense) => expense.type === "payroll" && expense.platform)
      .map((expense) => expense.platform)
  ).sort((a, b) => a.localeCompare(b));
  const formAmount = Number(form.amount);
  const formExchangeRate = Number(form.exchange_rate);
  const originalCurrency = getExpenseOriginalCurrency(form);
  const needsExchangeRate = originalCurrency !== "CRC";
  const convertedExpenseAmount =
    needsExchangeRate &&
    Number.isFinite(formAmount) &&
    formAmount > 0 &&
    Number.isFinite(formExchangeRate) &&
    formExchangeRate > 0
      ? roundMoney(formAmount * formExchangeRate)
      : 0;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthTotal = sum(
    visibleExpenses
      .filter((expense) => expense.month === currentMonth)
      .map((expense) => Number(expense.amount || 0))
  );
  const total = sum(visibleExpenses.map((expense) => Number(expense.amount || 0)));

  function selectExpenseType(type: ExpenseType) {
    setActiveType(type);
    setForm(prepareExpenseFormForType(form, type));
  }

  function openExpenseModal(type: ExpenseType) {
    setActiveType(type);
    setForm(prepareExpenseFormForType(form, type));
    setIsExpenseModalOpen(true);
  }

  async function handleExpenseSubmit(event: FormEvent<HTMLFormElement>) {
    const didSave = await onSave(event);
    if (didSave) setIsExpenseModalOpen(false);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">{activeView.tableTitle}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Registra y revisa gastos por tipo para alimentar la rentabilidad mensual.
            </p>
          </div>
          <Button type="button" onClick={() => openExpenseModal(activeType)} className="gap-2">
            <Plus className="h-4 w-4" />
            {activeView.buttonLabel}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 border-b border-border">
            {EXPENSE_VIEW_CONFIG.map((view) => (
              <button
                key={view.type}
                type="button"
                onClick={() => selectExpenseType(view.type)}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  activeType === view.type
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Registros" value={visibleExpenses.length} />
            <MiniStat label="Mes actual" value={currency(currentMonthTotal)} />
            <MiniStat label="Total" value={currency(total)} />
          </div>
          <div className="overflow-auto border border-border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2">{activeType === "payroll" ? "Persona" : "Plataforma / proveedor"}</th>
                  <th className="px-3 py-2">{activeType === "payroll" ? "Tipo" : "Categoria"}</th>
                  <th className="px-3 py-2">{activeType === "payroll" ? "Funcion / detalle" : "Descripcion"}</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleExpenses.map((expense) => (
                  <tr key={expense.id} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{expense.expense_date}</td>
                    <td className="px-3 py-2 font-mono text-xs">{expense.month}</td>
                    <td className="px-3 py-2">{expense.platform || "-"}</td>
                    <td className="px-3 py-2">{expense.category || "-"}</td>
                    <td className="px-3 py-2">{expense.description || "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {currency(expense.amount)}
                      {getExpenseOriginalPaymentLabel(expense) && (
                        <span className="block text-[11px] text-muted-foreground">
                          {getExpenseOriginalPaymentLabel(expense)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label="Eliminar gasto"
                        onClick={() => onDelete(expense.id)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibleExpenses.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      {activeView.emptyLabel}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isExpenseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="expense-modal-title"
        >
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h3 id="expense-modal-title" className="text-base font-semibold">
                  {activeView.modalTitle}
                </h3>
                <p className="text-xs text-muted-foreground">
                  El gasto queda clasificado automaticamente en {activeView.label}.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Cerrar registro de gasto"
                onClick={() => setIsExpenseModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={handleExpenseSubmit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledField label="Fecha de pago">
                  <Input
                    type="date"
                    value={form.expense_date}
                    onChange={(e) => setForm({ ...form, expense_date: e.target.value, type: activeType })}
                  />
                </LabeledField>
                <LabeledField label="Mes contable">
                  <Input
                    type="month"
                    value={form.month}
                    onChange={(e) => setForm({ ...form, month: e.target.value, type: activeType })}
                  />
                </LabeledField>
              </div>

              <LabeledField label={activeType === "payroll" ? "Persona" : "Plataforma / proveedor"}>
                <Input
                  placeholder={activeView.platformPlaceholder}
                  value={form.platform}
                  list={activeType === "payroll" ? "payroll-people" : undefined}
                  onChange={(e) => setForm({ ...form, platform: e.target.value, type: activeType })}
                  required={activeType === "payroll"}
                />
                {activeType === "payroll" && (
                  <datalist id="payroll-people">
                    {payrollPeople.map((person) => (
                      <option key={person} value={person} />
                    ))}
                  </datalist>
                )}
              </LabeledField>

              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledField label={activeType === "payroll" ? "Tipo de pago" : "Categoria"}>
                  <Input
                    placeholder={activeView.categoryPlaceholder}
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value, type: activeType })}
                  />
                </LabeledField>
                <LabeledField label={activeType === "payroll" ? "Funcion / detalle" : "Descripcion"}>
                  <Input
                    placeholder={activeView.descriptionPlaceholder}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value, type: activeType })}
                  />
                </LabeledField>
              </div>

              {activeType === "payroll" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabeledField label="Monto pagado en soles">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="S/ 0.00"
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value, type: activeType })}
                        required
                      />
                    </LabeledField>
                    <LabeledField label="Tipo de cambio a colones">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="CRC por 1 PEN"
                        value={form.exchange_rate}
                        onChange={(e) => setForm({ ...form, exchange_rate: e.target.value, type: activeType })}
                        required
                      />
                    </LabeledField>
                  </div>
                  <div className="border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    {convertedExpenseAmount
                      ? `Se guardara en cierre mensual como ${currency(convertedExpenseAmount)}.`
                      : "Ingresa monto y tipo de cambio para calcular el gasto en CRC."}
                  </div>
                </>
              ) : activeType === "misc" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <LabeledField label="Moneda pagada">
                      <select
                        value={originalCurrency}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            currency: e.target.value,
                            exchange_rate: e.target.value === "CRC" ? "" : form.exchange_rate,
                            type: activeType,
                          })
                        }
                        className="h-10 w-full border border-input bg-background px-3 text-sm outline-none"
                      >
                        <option value="CRC">Colones (CRC)</option>
                        <option value="USD">Dolares (USD)</option>
                        <option value="PEN">Soles (PEN)</option>
                      </select>
                    </LabeledField>
                    <LabeledField label={getExpenseAmountLabel(originalCurrency)}>
                      <Input
                        type="number"
                        min="0"
                        step={originalCurrency === "CRC" ? "1" : "0.01"}
                        inputMode="decimal"
                        placeholder={getExpenseAmountPlaceholder(originalCurrency)}
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value, type: activeType })}
                        required
                      />
                    </LabeledField>
                  </div>
                  {needsExchangeRate && (
                    <LabeledField label={getExchangeRateLabel(originalCurrency)}>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder={`CRC por 1 ${originalCurrency}`}
                        value={form.exchange_rate}
                        onChange={(e) => setForm({ ...form, exchange_rate: e.target.value, type: activeType })}
                        required
                      />
                    </LabeledField>
                  )}
                  <div className="border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    {needsExchangeRate
                      ? convertedExpenseAmount
                        ? `Se guardara en cierre mensual como ${currency(convertedExpenseAmount)}.`
                        : "Ingresa monto y tipo de cambio para calcular el gasto en CRC."
                      : "Se guardara en cierre mensual sin conversion."}
                  </div>
                </>
              ) : (
                <LabeledField label="Monto en colones">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="Monto"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value, type: activeType })}
                    required
                  />
                </LabeledField>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setIsExpenseModalOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Guardar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function prepareExpenseFormForType(form: typeof emptyExpense, type: ExpenseType): typeof emptyExpense {
  const currency =
    type === "payroll"
      ? "PEN"
      : type === "misc" && form.type === "misc"
        ? normalizeExpenseOriginalCurrency(form.currency)
        : "CRC";
  return {
    ...form,
    type,
    currency,
    exchange_rate: type === "ads" || currency === "CRC" ? "" : form.exchange_rate,
  };
}

function normalizeExpenseOriginalCurrency(value: string): ExpenseOriginalCurrency {
  return isExpenseOriginalCurrency(value) ? value : "CRC";
}

function isExpenseOriginalCurrency(value: string): value is ExpenseOriginalCurrency {
  return (EXPENSE_ORIGINAL_CURRENCIES as readonly string[]).includes(value);
}

function getExpenseOriginalCurrency(form: typeof emptyExpense): ExpenseOriginalCurrency {
  if (form.type === "payroll") return "PEN";
  if (form.type === "misc") return normalizeExpenseOriginalCurrency(form.currency);
  return "CRC";
}

function getExpenseAmountLabel(currencyCode: ExpenseOriginalCurrency): string {
  if (currencyCode === "USD") return "Monto pagado en dolares";
  if (currencyCode === "PEN") return "Monto pagado en soles";
  return "Monto en colones";
}

function getExpenseAmountPlaceholder(currencyCode: ExpenseOriginalCurrency): string {
  if (currencyCode === "USD") return "US$ 0.00";
  if (currencyCode === "PEN") return "S/ 0.00";
  return "Monto";
}

function getExchangeRateLabel(currencyCode: ExpenseOriginalCurrency): string {
  return `Tipo de cambio ${currencyCode} a colones`;
}

function getExpenseOriginalPaymentLabel(expense: BusinessExpense): string {
  const originalMatch = expense.notes.match(/Monto original:\s*([A-Z]{3})\s*([0-9.,]+)/i);
  const originalCurrency = originalMatch?.[1]?.toUpperCase() ?? "";
  const originalAmount = originalMatch?.[2];
  const exchangeRate = expense.notes.match(/Tipo de cambio [A-Z]{3}->CRC:\s*([0-9.,]+)/i)?.[1];
  if (!originalAmount && !exchangeRate) return "";

  const amount = Number(String(originalAmount ?? "").replace(",", "."));
  const amountLabel = Number.isFinite(amount) && amount > 0
    ? formatOriginalCurrencyAmount(originalCurrency, amount)
    : originalCurrency || "Origen";
  return exchangeRate ? `${amountLabel} @ ${exchangeRate}` : amountLabel;
}

function formatOriginalCurrencyAmount(currencyCode: string, amount: number): string {
  if (currencyCode === "USD") {
    return `US$ ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (currencyCode === "PEN") {
    return `S/ ${amount.toLocaleString("es-PE", { maximumFractionDigits: 2 })}`;
  }
  if (currencyCode === "CRC") return currency(amount);
  return `${currencyCode} ${amount.toLocaleString("es-CR", { maximumFractionDigits: 2 })}`;
}

function FinancialAnomaliesTable({
  anomalies,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  anomalies: FinancialAnomaly[];
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
}) {
  if (!anomalies.length) {
    return <p className="text-sm text-muted-foreground">No hay anomalias financieras detectadas.</p>;
  }

  return (
    <div className="max-h-[360px] overflow-auto border border-border">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Severidad</th>
            <th className="px-3 py-2">Tipo</th>
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Hallazgo</th>
            <th className="px-3 py-2">Accion</th>
            <th className="px-3 py-2">Reclamo</th>
          </tr>
        </thead>
        <tbody>
          {anomalies.slice(0, 120).map((anomaly) => {
            const claim = claimByAnomalyKey.get(anomaly.id);
            return (
              <tr key={anomaly.id} className="border-t border-border/50">
                <td className="px-3 py-2">
                  <Badge
                    variant={
                      anomaly.severity === "high"
                        ? "destructive"
                        : anomaly.severity === "medium"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {anomaly.severity === "high" ? "Alta" : anomaly.severity === "medium" ? "Media" : "Baja"}
                  </Badge>
                </td>
                <td className="px-3 py-2">{anomaly.type}</td>
                <td className="px-3 py-2 font-mono text-xs">{anomaly.order_name || "-"}</td>
                <td className="px-3 py-2 font-mono text-xs">{anomaly.guide_number || "-"}</td>
                <td className="px-3 py-2">{anomaly.message}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{anomaly.action}</td>
                <td className="px-3 py-2">
                  <div className="flex min-w-[260px] items-center gap-2">
                    <select
                      value={claim?.status ?? "pendiente"}
                      onChange={(event) => onSaveClaim(anomaly, event.target.value as FinanceClaim["status"], claim?.notes ?? "")}
                      className="h-8 border border-input bg-background px-2 text-xs"
                    >
                      <option value="pendiente">Pendiente</option>
                      <option value="reclamado">Reclamado</option>
                      <option value="resuelto">Resuelto</option>
                      <option value="descartado">Descartado</option>
                    </select>
                    <input
                      defaultValue={claim?.notes ?? ""}
                      onBlur={(event) => {
                        if (event.target.value !== (claim?.notes ?? "")) {
                          onSaveClaim(anomaly, claim?.status ?? "pendiente", event.target.value);
                        }
                      }}
                      placeholder="Nota"
                      className="h-8 w-32 border border-input bg-background px-2 text-xs outline-none"
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anomalies.length > 120 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Mostrando 120 de {anomalies.length} alertas.
        </div>
      )}
    </div>
  );
}

function CostCompositionBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
}) {
  const visibleSegments = segments
    .map((segment) => ({ ...segment, value: Math.max(0, Number(segment.value || 0)) }))
    .filter((segment) => segment.value > 0);
  const total = sum(visibleSegments.map((segment) => segment.value));

  if (!total) {
    return (
      <p className="border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        No hay costos registrados para este cierre.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden border border-border bg-background">
        {visibleSegments.map((segment) => {
          const percentage = (segment.value / total) * 100;
          return (
            <div
              key={segment.label}
              className={`${segment.className} h-full`}
              style={{ width: `${percentage}%` }}
              title={`${segment.label}: ${currency(segment.value)} (${percentage.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visibleSegments.map((segment) => {
          const percentage = (segment.value / total) * 100;
          return (
            <span
              key={segment.label}
              className="inline-flex items-center gap-1.5 border border-border bg-background px-2 py-1 text-[11px]"
            >
              <span className={`h-2 w-2 shrink-0 ${segment.className}`} />
              <span className="text-muted-foreground">{segment.label}</span>
              <span className="font-mono font-semibold">{currency(segment.value)}</span>
              <span className="text-muted-foreground">({percentage.toFixed(1)}%)</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface MonthProjectionBasis {
  delivery_effectiveness: number;
  avg_margin_per_delivered: number;
}

const MONTH_ROW_GRID =
  "grid grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-2 lg:grid-cols-[2rem_minmax(110px,1.3fr)_repeat(7,minmax(0,1fr))_minmax(0,1.2fr)]";

function MonthlyCloseTab({
  rows,
  control,
  summary,
  costs,
  onSaveProductCost,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  rows: MonthlyCloseRow[];
  control: FinanceControlCenter;
  summary: ProfitabilitySummary | null;
  costs: ProductCost[];
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
}) {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  // Tasa de entrega y margen historicos (sobre pedidos ya despachados o
  // liquidados) para proyectar meses que aun no tienen liquidaciones.
  const projectionBasis = useMemo(() => {
    let delivered = 0;
    let dispatched = 0;
    let marginSum = 0;
    let marginCount = 0;
    for (const order of control.orders) {
      const isDelivered = order.tracking_status === "delivered";
      const isDispatched =
        isDelivered ||
        order.tracking_status === "not_delivered" ||
        order.tracking_status === "returned";
      if (isDispatched) dispatched += 1;
      if (isDelivered) delivered += 1;
      if (order.settlement_count === 1) {
        marginSum += order.contribution_margin;
        marginCount += 1;
      }
    }
    return {
      delivery_effectiveness: dispatched ? delivered / dispatched : 0,
      avg_margin_per_delivered: marginCount ? marginSum / marginCount : 0,
    };
  }, [control.orders]);
  // Meses cronologicos primero; "sin fecha" al final como caso residual.
  const orderedRows = useMemo(
    () => [
      ...rows.filter((row) => row.month !== "sin-fecha"),
      ...rows.filter((row) => row.month === "sin-fecha"),
    ],
    [rows]
  );
  const totals = useMemo(() => {
    const acc = {
      orders: 0,
      delivered: 0,
      not_delivered: 0,
      annulled: 0,
      pending: 0,
      settled: 0,
      unsettled: 0,
      to_claim: 0,
      costs: 0,
      net_profit: 0,
      gross: 0,
      cash_pending: 0,
    };
    for (const row of rows) {
      acc.orders += row.orders;
      acc.delivered += row.delivered;
      acc.not_delivered += row.not_delivered;
      acc.annulled += row.annulled;
      acc.pending += row.pending;
      acc.settled += row.settled;
      acc.unsettled += row.unsettled;
      acc.to_claim += row.to_claim;
      acc.costs += row.boxful_costs + row.product_costs + row.ads + row.payroll + row.misc;
      acc.net_profit += row.net_profit;
      acc.gross += row.cash_received + row.boxful_costs;
      acc.cash_pending += row.cash_pending;
    }
    return acc;
  }, [rows]);
  // Alertas automaticas: se evaluan sobre el mes mas reciente con
  // liquidaciones (los abiertos aun no son representativos) y sobre globales.
  const autoAlerts = useMemo(() => {
    const list: Array<{ key: string; text: string; tone: "warning" | "danger" }> = [];
    const reference = rows.find(
      (row) => row.month !== "sin-fecha" && (row.settled > 0 || row.cash_received > 0)
    );
    if (reference) {
      const monthLabel = formatMonthLabel(reference.month);
      const completed = reference.delivered + reference.not_delivered + reference.annulled;
      const effectiveness = completed ? (reference.delivered / completed) * 100 : null;
      if (effectiveness != null && effectiveness < 50) {
        list.push({
          key: "efectividad",
          text: `Efectividad de entrega ${formatPercent(effectiveness)} (<50%) en ${monthLabel}`,
          tone: "danger",
        });
      }
      const annulRate = reference.orders ? (reference.annulled / reference.orders) * 100 : 0;
      if (annulRate > 25) {
        list.push({
          key: "anulacion",
          text: `Anulacion ${formatPercent(annulRate)} (>25%) en ${monthLabel}`,
          tone: "danger",
        });
      }
      if (reference.net_profit < 0) {
        list.push({ key: "margen", text: `Margen negativo en ${monthLabel}`, tone: "danger" });
      }
      const operatingMargin =
        reference.cash_received + reference.boxful_costs - reference.product_costs - reference.boxful_costs;
      if (reference.ads > 0 && reference.ads > operatingMargin) {
        list.push({
          key: "roas",
          text: `Ads por encima del margen operativo (ROAS bajo equilibrio) en ${monthLabel}`,
          tone: "danger",
        });
      }
    }
    if (control.missing_cost_count > 0) {
      list.push({
        key: "skus",
        text: `${control.missing_cost_count} pedidos con SKUs sin costo`,
        tone: "warning",
      });
    }
    const lateClaims = control.orders.filter(
      (order) =>
        order.tracking_status === "delivered" &&
        order.settlement_count === 0 &&
        daysSince(order.delivered_on ?? order.created_at ?? "") > 15
    ).length;
    if (lateClaims > 0) {
      list.push({
        key: "reclamos",
        text: `${lateClaims} entregas sin liquidar hace mas de 15 dias`,
        tone: "danger",
      });
    }
    return list;
  }, [rows, control]);
  const totalsCompleted = totals.delivered + totals.not_delivered + totals.annulled;
  const totalsEffectiveness = totalsCompleted ? (totals.delivered / totalsCompleted) * 100 : 0;
  const totalsHasFullCosts = rows.some(
    (row) => row.product_costs > 0 || row.ads > 0 || row.payroll > 0 || row.misc > 0
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Cierre mensual</h2>
          <p className="text-xs text-muted-foreground">
            Un mes por fila. Despliega cualquier mes para ver su detalle.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("cierre-mensual.csv", rows)}>
          <Download className="h-4 w-4" /> Exportar cierre
        </Button>
      </div>

      {autoAlerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {autoAlerts.map((alert) => (
            <span
              key={alert.key}
              className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs ${
                alert.tone === "danger"
                  ? "border-red-500/40 bg-red-500/10 text-red-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {alert.text}
            </span>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <CompactStat label="Ventas liquidadas" value={currency(totals.gross)} />
          <CompactStat
            label={totalsHasFullCosts ? "Utilidad neta" : "Margen logistico"}
            value={currency(totals.net_profit)}
            tone={totals.net_profit < 0 ? "warning" : undefined}
          />
          <CompactStat
            label="Margen"
            value={totals.gross ? formatPercent((totals.net_profit / totals.gross) * 100) : "-"}
          />
          <CompactStat
            label="Ticket promedio"
            value={currency(totals.delivered ? totals.gross / totals.delivered : 0)}
          />
          <CompactStat
            label="Efectividad entrega"
            value={`${totals.delivered} · ${formatPercent(totalsEffectiveness)}`}
          />
          <CompactStat
            label="Caja por reclamar"
            value={currency(totals.cash_pending)}
            tone={totals.cash_pending > 0 ? "warning" : undefined}
          />
        </div>
      )}

      {!rows.length ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No hay datos suficientes para cierre mensual.
          </CardContent>
        </Card>
      ) : (
        <div className="border border-border">
          <div className={`${MONTH_ROW_GRID} border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground`}>
            <span />
            <span>Mes</span>
            <span className="text-right">Pedidos</span>
            <span className="hidden text-right lg:block">Entregados</span>
            <span className="hidden text-right lg:block">Pendientes</span>
            <span className="hidden text-right lg:block">Liquidados</span>
            <span className="hidden text-right lg:block">Sin liquidacion</span>
            <span className="hidden text-right lg:block">Por reclamar</span>
            <span className="hidden text-right lg:block">Costos</span>
            <span className="text-right">Utilidad neta</span>
          </div>
          {orderedRows.map((row, index) => (
            <MonthlyCloseMonthRow
              key={row.month}
              row={row}
              previous={
                row.month === "sin-fecha"
                  ? undefined
                  : orderedRows.slice(index + 1).find((item) => item.month !== "sin-fecha")
              }
              open={expandedMonth === row.month}
              onToggle={() =>
                setExpandedMonth((value) => (value === row.month ? null : row.month))
              }
              control={control}
              summary={summary}
              costs={costs}
              onSaveProductCost={onSaveProductCost}
              projectionBasis={projectionBasis}
              claimByAnomalyKey={claimByAnomalyKey}
              onSaveClaim={onSaveClaim}
            />
          ))}
          <div className={`${MONTH_ROW_GRID} border-t-2 border-border bg-card px-3 py-2.5`}>
            <span />
            <span className="font-mono text-xs font-semibold">TOTAL</span>
            <span className="text-right font-mono text-xs font-semibold">{totals.orders}</span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">
              {totals.delivered}
              {totals.orders > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  {Math.round((totals.delivered / totals.orders) * 100)}%
                </span>
              )}
            </span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">{totals.pending}</span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">
              {totals.settled}
              {totals.orders > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  {Math.round((totals.settled / totals.orders) * 100)}%
                </span>
              )}
            </span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">{totals.unsettled}</span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">{totals.to_claim}</span>
            <span className="hidden text-right font-mono text-xs font-semibold lg:block">{currency(totals.costs)}</span>
            <span className={`text-right font-mono text-xs font-semibold ${totals.net_profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
              {currency(totals.net_profit)}
              {totals.gross > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  {Math.round((totals.net_profit / totals.gross) * 100)}%
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthlyCloseMonthRow({
  row,
  previous,
  open,
  onToggle,
  control,
  summary,
  costs,
  onSaveProductCost,
  projectionBasis,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  row: MonthlyCloseRow;
  previous?: MonthlyCloseRow;
  open: boolean;
  onToggle: () => void;
  control: FinanceControlCenter;
  summary: ProfitabilitySummary | null;
  costs: ProductCost[];
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
  projectionBasis: MonthProjectionBasis;
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
}) {
  const registeredCosts = row.boxful_costs + row.product_costs + row.ads + row.payroll + row.misc;
  // Efectividad sobre pedidos con ciclo terminado, no sobre el total del mes.
  const completedOutcomes = row.delivered + row.not_delivered + row.annulled;
  const deliveredPct = completedOutcomes
    ? Math.round((row.delivered / completedOutcomes) * 100)
    : 0;
  const settledPct = row.orders ? Math.round((row.settled / row.orders) * 100) : 0;
  const maturity = getMonthMaturity(row.month);
  const grossIncome = row.cash_received + row.boxful_costs;
  const marginPct = grossIncome ? Math.round((row.net_profit / grossIncome) * 100) : null;
  const incompleteData = row.orders > 0 && row.settled === 0 && row.cash_received === 0;
  const trend = previous
    ? row.net_profit > previous.net_profit
      ? "up"
      : row.net_profit < previous.net_profit
        ? "down"
        : null
    : null;

  return (
    <div className="border-t border-border/50 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`${MONTH_ROW_GRID} w-full px-3 py-3 text-left transition-colors hover:bg-primary/5 ${open ? "bg-primary/5" : ""}`}
      >
        <span className="flex h-6 w-6 items-center justify-center border border-border bg-background">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-xs font-semibold">{formatMonthLabel(row.month)}</span>
          {maturity && (
            <span className={`hidden shrink-0 border px-1.5 py-px text-[9px] sm:inline-flex ${maturity.className}`}>
              {maturity.label}
            </span>
          )}
          {incompleteData && (
            <span
              className="h-1.5 w-1.5 shrink-0 bg-amber-400"
              title="Sin cortes de Boxful que cubran este mes: la utilidad esta incompleta."
            />
          )}
        </span>
        <span className="text-right font-mono text-xs">{row.orders}</span>
        <span className="hidden text-right font-mono text-xs lg:block">
          {row.delivered}
          {completedOutcomes > 0 && (
            <span className="ml-1 text-[10px] text-muted-foreground">{deliveredPct}%</span>
          )}
        </span>
        <span className="hidden text-right font-mono text-xs lg:block">{row.pending}</span>
        <span className="hidden text-right font-mono text-xs lg:block">
          {row.settled}
          {row.orders > 0 && (
            <span className="ml-1 text-[10px] text-muted-foreground">{settledPct}%</span>
          )}
        </span>
        <span className="hidden text-right font-mono text-xs lg:block">{row.unsettled}</span>
        <span className="hidden text-right font-mono text-xs lg:block">{row.to_claim}</span>
        <span className="hidden text-right font-mono text-xs lg:block">{currency(registeredCosts)}</span>
        <span className={`flex items-baseline justify-end gap-1 font-mono text-xs ${row.net_profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
          {trend === "up" && <span className="text-[9px] text-emerald-300">▲</span>}
          {trend === "down" && <span className="text-[9px] text-red-300">▼</span>}
          {currency(row.net_profit)}
          {marginPct != null && (
            <span className="text-[10px] text-muted-foreground">{marginPct}%</span>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/50 bg-background/40 p-3 sm:p-4">
          <MonthCloseDetail
            close={row}
            previous={previous}
            control={control}
            summary={summary}
            costs={costs}
            onSaveProductCost={onSaveProductCost}
            projectionBasis={projectionBasis}
            claimByAnomalyKey={claimByAnomalyKey}
            onSaveClaim={onSaveClaim}
          />
        </div>
      )}
    </div>
  );
}

function MonthCloseDetail({
  close,
  previous,
  control,
  summary,
  costs,
  onSaveProductCost,
  projectionBasis,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  close: MonthlyCloseRow;
  previous?: MonthlyCloseRow;
  control: FinanceControlCenter;
  summary: ProfitabilitySummary | null;
  costs: ProductCost[];
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
  projectionBasis: MonthProjectionBasis;
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
}) {
  const [ordersModalFilter, setOrdersModalFilter] = useState<MonthlyOrderFilter | null>(null);
  const [showAnomaliesModal, setShowAnomaliesModal] = useState(false);
  const [showSkusModal, setShowSkusModal] = useState(false);

  const monthOrders = useMemo(
    () =>
      control.orders.filter(
        (order) => (getMonthKey(order.created_at) || "sin-fecha") === close.month
      ),
    [control.orders, close.month]
  );
  const monthAnomalies = useMemo(
    () =>
      control.anomalies.filter((anomaly) => {
        const order = control.orders.find(
          (item) =>
            item.order_name === anomaly.order_name ||
            (item.guide_number && item.guide_number === anomaly.guide_number)
        );
        return (getMonthKey(order?.created_at ?? null) || "sin-fecha") === close.month;
      }),
    [control.anomalies, control.orders, close.month]
  );
  const missingCostSkus = useMemo(
    () => uniqueKeys(monthOrders.flatMap((order) => order.missing_cost_skus)),
    [monthOrders]
  );
  const skuTitleBySku = useMemo(() => {
    const map = new Map<string, string>();
    for (const order of monthOrders) {
      for (const item of order.items ?? []) {
        const costKey = getProductItemCostKey(item);
        if (costKey && !map.has(costKey)) map.set(costKey, item.title || costKey);
      }
    }
    return map;
  }, [monthOrders]);

  const criticalAnomalies = monthAnomalies.filter((anomaly) => anomaly.severity === "high").length;
  const totalRegisteredCosts =
    close.boxful_costs + close.product_costs + close.ads + close.payroll + close.misc;
  const directCosts = close.boxful_costs + close.product_costs;
  const operatingExpenses = close.ads + close.payroll + close.misc;
  const settledRate = close.orders ? (close.settled / close.orders) * 100 : 0;
  const claimBase = close.cash_received + close.cash_pending;
  const claimShare = claimBase ? (close.cash_pending / claimBase) * 100 : 0;
  // Monto COD bruto cobrado: lo liquidado mas lo que Boxful retuvo en costos.
  const grossCodIncome = close.cash_received + close.boxful_costs;
  const previousGrossIncome = previous ? previous.cash_received + previous.boxful_costs : null;
  // Cascada financiera: ingresos -> margen bruto -> operativo -> contribucion -> utilidad.
  const grossMargin = grossCodIncome - close.product_costs;
  const operatingMargin = grossMargin - close.boxful_costs;
  const contributionAfterAds = operatingMargin - close.ads;
  const previousGrossMargin =
    previous && previousGrossIncome != null ? previousGrossIncome - previous.product_costs : null;
  const previousOperatingMargin =
    previous && previousGrossMargin != null ? previousGrossMargin - previous.boxful_costs : null;
  const previousContribution =
    previous && previousOperatingMargin != null ? previousOperatingMargin - previous.ads : null;
  // Mientras falten costos reales, el resultado es margen logistico, no utilidad.
  const hasFullCosts =
    close.product_costs > 0 || close.ads > 0 || close.payroll > 0 || close.misc > 0;
  const bottomLineLabel = hasFullCosts ? "Utilidad neta" : "Margen logistico (faltan costos)";
  // Efectividad sobre ciclo terminado (entregados + anulados + no entregados).
  const completedOutcomes = close.delivered + close.not_delivered + close.annulled;
  const deliveryEffectiveness = completedOutcomes
    ? (close.delivered / completedOutcomes) * 100
    : 0;
  const ticketPromedio = close.delivered ? grossCodIncome / close.delivered : 0;
  const logisticsPerDelivery = close.delivered ? close.boxful_costs / close.delivered : 0;
  const logisticsTicketShare = ticketPromedio
    ? (logisticsPerDelivery / ticketPromedio) * 100
    : 0;
  // Embudo COD del mes.
  const confirmedOrders = close.orders - close.annulled;
  const dispatchedOrders = useMemo(
    () => monthOrders.filter((order) => order.guide_number).length,
    [monthOrders]
  );
  const deliveredSettled = Math.max(0, close.delivered - close.to_claim);
  // Dinero quemado en envios fallidos: lo que Boxful cobro sobre no entregados.
  const failedDeliveryLoss = roundMoney(
    sum(
      monthOrders
        .filter(
          (order) =>
            order.tracking_status === "not_delivered" || order.tracking_status === "returned"
        )
        .map((order) => order.settlement_charged_costs)
    )
  );
  const toClaimAging = useMemo(() => {
    const buckets = {
      fresh: { count: 0, amount: 0 },
      warn: { count: 0, amount: 0 },
      late: { count: 0, amount: 0 },
    };
    for (const order of monthOrders) {
      if (order.tracking_status !== "delivered" || order.settlement_count !== 0) continue;
      const days = daysSince(order.delivered_on ?? order.created_at ?? "");
      const bucket = days <= 7 ? buckets.fresh : days <= 15 ? buckets.warn : buckets.late;
      bucket.count += 1;
      bucket.amount += order.expected_cod;
    }
    return buckets;
  }, [monthOrders]);
  const costSegments = [
    { label: "Comision COD", value: close.boxful_cod_commission, className: "bg-sky-400" },
    { label: "Costo entrega", value: close.boxful_delivery_cost, className: "bg-cyan-400" },
    { label: "Pick&Pack", value: close.boxful_pick_pack_cost, className: "bg-indigo-400" },
    { label: "Empaque Boxful", value: close.boxful_packaging_cost, className: "bg-blue-400" },
    { label: "Comision tarjeta", value: close.boxful_card_commission, className: "bg-teal-400" },
    { label: "Costo producto", value: close.product_costs, className: "bg-emerald-400" },
    { label: "Ads", value: close.ads, className: "bg-violet-400" },
    { label: "Planilla", value: close.payroll, className: "bg-amber-400" },
    { label: "Varios", value: close.misc, className: "bg-rose-400" },
  ];

  // Mes sin liquidaciones (tipicamente el mes en curso): se muestra la foto
  // operativa y una proyeccion con la tasa de entrega y margen historicos.
  const hasSettlementData = close.settled > 0 || close.cash_received > 0;
  const pendingOrders = monthOrders.filter((order) => order.tracking_status === "pending");
  const pipelineCod = sum(pendingOrders.map((order) => order.expected_cod));
  const annulledCod = sum(
    monthOrders
      .filter((order) => order.tracking_status === "annulled")
      .map((order) => order.expected_cod)
  );
  const annulledRate = close.orders ? (close.annulled / close.orders) * 100 : 0;
  const projectedDeliveries = Math.round(
    pendingOrders.length * projectionBasis.delivery_effectiveness
  );
  const projectedCash = pipelineCod * projectionBasis.delivery_effectiveness;
  const projectedMargin =
    projectedDeliveries * projectionBasis.avg_margin_per_delivered - operatingExpenses;

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${hasSettlementData ? "xl:grid-cols-[1fr_0.72fr_0.95fr]" : "xl:grid-cols-[1.15fr_0.85fr]"}`}>
        {hasSettlementData ? (
          <>
            <div className="border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Estado financiero del mes</p>
                <span className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
                  <span className="w-10 text-right">% ing.</span>
                  {previous && <span className="w-12 text-right">Δ mes ant.</span>}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                <StatementRow
                  label="Ingresos liquidados"
                  value={currency(grossCodIncome)}
                  pct={pctOf(grossCodIncome, grossCodIncome)}
                  delta={pctChange(grossCodIncome, previousGrossIncome)}
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Costo de producto"
                  value={currency(close.product_costs)}
                  sign="minus"
                  pct={pctOf(close.product_costs, grossCodIncome)}
                  delta={pctChange(close.product_costs, previous?.product_costs)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Margen bruto"
                  value={currency(grossMargin)}
                  emphasis
                  pct={pctOf(grossMargin, grossCodIncome)}
                  delta={pctChange(grossMargin, previousGrossMargin)}
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Comision COD"
                  value={currency(close.boxful_cod_commission)}
                  sign="minus"
                  pct={pctOf(close.boxful_cod_commission, grossCodIncome)}
                  delta={pctChange(close.boxful_cod_commission, previous?.boxful_cod_commission)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Costo de entrega"
                  value={currency(close.boxful_delivery_cost)}
                  sign="minus"
                  pct={pctOf(close.boxful_delivery_cost, grossCodIncome)}
                  delta={pctChange(close.boxful_delivery_cost, previous?.boxful_delivery_cost)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Pick&Pack"
                  value={currency(close.boxful_pick_pack_cost)}
                  sign="minus"
                  pct={pctOf(close.boxful_pick_pack_cost, grossCodIncome)}
                  delta={pctChange(close.boxful_pick_pack_cost, previous?.boxful_pick_pack_cost)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Empaque Boxful"
                  value={currency(close.boxful_packaging_cost)}
                  sign="minus"
                  pct={pctOf(close.boxful_packaging_cost, grossCodIncome)}
                  delta={pctChange(close.boxful_packaging_cost, previous?.boxful_packaging_cost)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                {close.boxful_card_commission > 0 && (
                  <StatementRow
                    label="Comision tarjeta"
                    value={currency(close.boxful_card_commission)}
                    sign="minus"
                    pct={pctOf(close.boxful_card_commission, grossCodIncome)}
                    delta={pctChange(close.boxful_card_commission, previous?.boxful_card_commission)}
                    deltaInverted
                    showDeltaCol={Boolean(previous)}
                  />
                )}
                <StatementRow
                  label="Margen operativo"
                  value={currency(operatingMargin)}
                  emphasis
                  pct={pctOf(operatingMargin, grossCodIncome)}
                  delta={pctChange(operatingMargin, previousOperatingMargin)}
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Ads"
                  value={currency(close.ads)}
                  sign="minus"
                  pct={pctOf(close.ads, grossCodIncome)}
                  delta={pctChange(close.ads, previous?.ads)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Contribucion"
                  value={currency(contributionAfterAds)}
                  emphasis
                  pct={pctOf(contributionAfterAds, grossCodIncome)}
                  delta={pctChange(contributionAfterAds, previousContribution)}
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Planilla"
                  value={currency(close.payroll)}
                  sign="minus"
                  pct={pctOf(close.payroll, grossCodIncome)}
                  delta={pctChange(close.payroll, previous?.payroll)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Software"
                  value={currency(close.misc_software)}
                  sign="minus"
                  pct={pctOf(close.misc_software, grossCodIncome)}
                  delta={pctChange(close.misc_software, previous?.misc_software)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
                <StatementRow
                  label="Otros gastos"
                  value={currency(close.misc_other)}
                  sign="minus"
                  pct={pctOf(close.misc_other, grossCodIncome)}
                  delta={pctChange(close.misc_other, previous?.misc_other)}
                  deltaInverted
                  showDeltaCol={Boolean(previous)}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                <span className="text-xs font-semibold">{bottomLineLabel}</span>
                <span className="flex items-baseline gap-2">
                  <span className={`font-mono text-xl font-semibold ${close.net_profit < 0 ? "text-red-300" : "text-primary"}`}>
                    {currency(close.net_profit)}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {pctOf(close.net_profit, grossCodIncome) == null
                      ? ""
                      : `${(pctOf(close.net_profit, grossCodIncome) as number).toFixed(1)}%`}
                  </span>
                  {previous && <DeltaCell delta={pctChange(close.net_profit, previous.net_profit)} />}
                </span>
              </div>
            </div>

            <div className="border border-border bg-card p-3">
              <p className="text-sm font-semibold">Operacion logistica</p>
              <div className="mt-2 space-y-1.5 border border-border bg-background p-2">
                {[
                  { label: "Pedidos", value: close.orders, base: null as number | null },
                  { label: "Confirmados", value: confirmedOrders, base: close.orders },
                  { label: "Despachados", value: dispatchedOrders, base: confirmedOrders },
                  { label: "Entregados", value: close.delivered, base: dispatchedOrders },
                  { label: "Liquidados", value: deliveredSettled, base: close.delivered },
                ].map((stage) => (
                  <div key={stage.label}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">{stage.label}</span>
                      <span className="font-mono">
                        {stage.value}
                        {stage.base ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            {Math.round((stage.value / stage.base) * 100)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden bg-muted">
                      <div
                        className="h-full bg-cyan-400/70"
                        style={{
                          width: `${close.orders ? Math.min(100, (stage.value / close.orders) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1">
                <StatementRow
                  label="Efectividad entrega"
                  value={`${close.delivered} · ${formatPercent(deliveryEffectiveness)}`}
                  tone={deliveryEffectiveness >= 50 ? "positive" : "negative"}
                />
                <StatementRow
                  label="Tasa de anulacion"
                  value={`${close.annulled} · ${formatPercent(annulledRate)}`}
                  tone={annulledRate > 25 ? "negative" : close.annulled ? "warning" : undefined}
                />
                <StatementRow
                  label="No entregados"
                  value={String(close.not_delivered)}
                  tone={close.not_delivered ? "negative" : undefined}
                />
                <StatementRow
                  label="Perdida no-entrega (Boxful)"
                  value={currency(failedDeliveryLoss)}
                  sign="minus"
                  tone={failedDeliveryLoss ? "negative" : undefined}
                />
                <StatementRow label="Pendientes en ruta" value={String(close.pending)} />
                <StatementRow
                  label="Liquidados"
                  value={`${close.settled} (${formatPercent(settledRate)})`}
                  emphasis
                />
              </div>
            </div>
          </>
        ) : (
          <div className="border border-border bg-card p-3">
            <>
              <div className="mb-2 border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                Mes sin liquidaciones todavia: la utilidad real llega con el proximo corte de Boxful.
              </div>
              <p className="text-xs text-muted-foreground">
                COD real en ruta ({pendingOrders.length} pedidos pendientes)
              </p>
              <p className="mt-0.5 font-mono text-2xl font-semibold text-primary">
                {currency(pipelineCod)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <CompactStat
                  label={`Anulados (${formatPercent(annulledRate)})`}
                  value={`${close.annulled} · ${currency(annulledCod)}`}
                  tone={close.annulled ? "warning" : undefined}
                />
                <CompactStat label="Gastos del mes" value={currency(operatingExpenses)} />
                <CompactStat
                  label="Ticket promedio"
                  value={currency(pendingOrders.length ? pipelineCod / pendingOrders.length : 0)}
                />
                <CompactStat label="Entregados" value={close.delivered} />
                <CompactStat label="No entregados" value={close.not_delivered} />
                <CompactStat label="Liquidados" value={close.settled} />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Proyeccion ({formatPercent(projectionBasis.delivery_effectiveness * 100)} entrega
                historica): caja {currency(projectedCash)} · {projectedDeliveries} entregas esperadas
                · margen estimado {currency(projectedMargin)}
              </p>
            </>
          </div>
        )}

        <div className="border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Que revisar primero</p>
            <button
              type="button"
              onClick={() => setOrdersModalFilter("all")}
              className="text-[11px] text-primary transition-colors hover:underline"
            >
              Ver todos los pedidos del mes ({monthOrders.length})
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            <CloseSignalRow
              label="Pedidos operativos pendientes"
              value={close.pending}
              hint="Aun no son entregados, devueltos ni anulados."
              tone={close.pending ? "warning" : "ok"}
              onClick={() => setOrdersModalFilter("pending")}
            />
            <CloseSignalRow
              label="Entregados sin liquidacion"
              value={close.to_claim}
              hint="Si Boxful ya los entrego, toca reclamar pago."
              tone={close.to_claim ? "warning" : "ok"}
              onClick={() => setOrdersModalFilter("to_claim")}
            />
            <CloseSignalRow
              label="Liquidaciones duplicadas"
              value={close.duplicate_settlements}
              hint="Un pedido no deberia aparecer dos veces."
              tone={close.duplicate_settlements ? "danger" : "ok"}
              onClick={() => setOrdersModalFilter("duplicate")}
            />
            <CloseSignalRow
              label="SKUs sin costo"
              value={missingCostSkus.length}
              hint="Sin costo de producto, la utilidad queda incompleta."
              tone={missingCostSkus.length ? "warning" : "ok"}
              onClick={() => setShowSkusModal(true)}
            />
            <CloseSignalRow
              label="Anomalias del mes"
              value={monthAnomalies.length}
              hint={`${criticalAnomalies} criticas de alta prioridad.`}
              tone={criticalAnomalies ? "danger" : monthAnomalies.length ? "warning" : "ok"}
              onClick={() => setShowAnomaliesModal(true)}
            />
          </div>
        </div>
      </div>

      {hasSettlementData && (
        <div className="border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Caja por reclamar</p>
            <span className={`font-mono text-sm font-semibold ${close.cash_pending > 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {currency(close.cash_pending)}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="border border-border bg-background px-2.5 py-1.5">
              <p className="text-[11px] text-muted-foreground">0-7 dias</p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {toClaimAging.fresh.count} <span className="text-[10px] font-normal text-muted-foreground">pedidos</span>
              </p>
              <p className="font-mono text-xs text-muted-foreground">{currency(toClaimAging.fresh.amount)}</p>
            </div>
            <div className="border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5">
              <p className="text-[11px] text-amber-200">8-15 dias</p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {toClaimAging.warn.count} <span className="text-[10px] font-normal text-muted-foreground">pedidos</span>
              </p>
              <p className="font-mono text-xs text-amber-200">{currency(toClaimAging.warn.amount)}</p>
            </div>
            <div className="border border-red-500/40 bg-red-500/5 px-2.5 py-1.5">
              <p className="text-[11px] text-red-200">+15 dias</p>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {toClaimAging.late.count} <span className="text-[10px] font-normal text-muted-foreground">pedidos</span>
              </p>
              <p className="font-mono text-xs text-red-200">{currency(toClaimAging.late.amount)}</p>
            </div>
          </div>
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Participacion sobre pendiente + liquidado</span>
              <span>{formatPercent(claimShare)}</span>
            </div>
            <div className="h-1.5 overflow-hidden border border-border bg-background">
              <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, claimShare)}%` }} />
            </div>
          </div>
        </div>
      )}

      {hasSettlementData && close.delivered > 0 && (
        <div className="border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Unit economics</p>
            <p className="text-[11px] text-muted-foreground">
              por pedido entregado ({close.delivered} entregados)
            </p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <CompactStat label="Ticket promedio" value={currency(ticketPromedio)} />
            <CompactStat label="Costo producto" value={currency(close.product_costs / close.delivered)} />
            <CompactStat
              label={`Costo logistico (${formatPercent(logisticsTicketShare)} ticket)`}
              value={currency(logisticsPerDelivery)}
            />
            <CompactStat
              label="CPA real (ads)"
              value={close.ads > 0 ? currency(close.ads / close.delivered) : "Sin ads"}
            />
            <CompactStat label="Margen bruto" value={currency(grossMargin / close.delivered)} />
            <CompactStat
              label="Utilidad por entrega"
              value={currency(close.net_profit / close.delivered)}
              tone={close.net_profit < 0 ? "warning" : undefined}
            />
            <CompactStat
              label="ROAS real"
              value={close.ads > 0 ? `${(grossCodIncome / close.ads).toFixed(1)}x` : "Sin ads"}
            />
          </div>
        </div>
      )}

      <div className="border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Costos registrados</p>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>
              Directos <span className="font-mono font-semibold text-foreground">{currency(directCosts)}</span>
            </span>
            <span>
              Operativos <span className="font-mono font-semibold text-foreground">{currency(operatingExpenses)}</span>
            </span>
            <span>
              Total <span className="font-mono font-semibold text-foreground">{currency(totalRegisteredCosts)}</span>
            </span>
          </div>
        </div>
        <div className="mt-2">
          <CostCompositionBar segments={costSegments} />
        </div>
        <p className="mt-2 border border-border bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground">
          A liquidar = Monto COD - Comision COD - Costo entrega - Pick&Pack - Empaque. La comision
          tarjeta queda solo como dato informativo cuando aplica: {currency(summary?.card_commission ?? 0)}.
        </p>
      </div>

      {ordersModalFilter && (
        <MonthOrdersModal
          monthLabel={formatMonthLabel(close.month)}
          month={close.month}
          orders={monthOrders}
          initialFilter={ordersModalFilter}
          onClose={() => setOrdersModalFilter(null)}
        />
      )}
      {showAnomaliesModal && (
        <MonthAnomaliesModal
          monthLabel={formatMonthLabel(close.month)}
          month={close.month}
          anomalies={monthAnomalies}
          claimByAnomalyKey={claimByAnomalyKey}
          onSaveClaim={onSaveClaim}
          onClose={() => setShowAnomaliesModal(false)}
        />
      )}
      {showSkusModal && (
        <MonthSkuCostsModal
          skus={missingCostSkus}
          titleBySku={skuTitleBySku}
          costs={costs}
          onSave={onSaveProductCost}
          onClose={() => setShowSkusModal(false)}
        />
      )}
    </div>
  );
}

function CloseSignalRow({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "ok" | "warning" | "danger";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";

  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="truncate text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <span className={`inline-flex min-w-10 shrink-0 justify-center border px-2 py-0.5 font-mono text-xs font-semibold ${toneClass}`}>
        {value}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={hint}
        className="flex w-full items-center justify-between gap-2 border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/50"
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-2 border border-border bg-background px-2.5 py-1.5"
      title={hint}
    >
      {content}
    </div>
  );
}

function CompactStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warning";
}) {
  return (
    <div
      className={`border px-2.5 py-1.5 ${
        tone === "warning" ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background"
      }`}
    >
      <p className="truncate text-[11px] text-muted-foreground" title={label}>
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function StatementRow({
  label,
  value,
  sign,
  emphasis,
  tone,
  pct,
  delta,
  deltaInverted,
  showDeltaCol,
}: {
  label: string;
  value: string;
  sign?: "minus";
  emphasis?: boolean;
  tone?: "positive" | "negative" | "warning";
  pct?: number | null;
  delta?: number | null;
  deltaInverted?: boolean;
  showDeltaCol?: boolean;
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "negative"
        ? "text-red-300"
        : tone === "warning"
          ? "text-amber-300"
          : sign === "minus"
            ? "text-red-300/80"
            : "";

  return (
    <div className={`flex items-center justify-between gap-2 ${emphasis ? "mt-1.5 border-t border-border pt-1.5" : ""}`}>
      <span className={emphasis ? "text-xs font-semibold" : "text-xs text-muted-foreground"}>
        {label}
      </span>
      <span className="flex items-baseline gap-2">
        <span className={`font-mono text-xs ${emphasis ? "font-semibold" : ""} ${valueClass}`}>
          {sign === "minus" ? `(${value})` : value}
        </span>
        {pct !== undefined && (
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
            {pct == null ? "" : `${pct.toFixed(1)}%`}
          </span>
        )}
        {showDeltaCol && <DeltaCell delta={delta ?? null} inverted={deltaInverted} />}
      </span>
    </div>
  );
}

function DeltaCell({ delta, inverted }: { delta: number | null; inverted?: boolean }) {
  if (delta == null) {
    return <span className="w-12 shrink-0" />;
  }
  const improving = inverted ? delta < 0 : delta > 0;
  const colorClass = delta === 0 ? "text-muted-foreground" : improving ? "text-emerald-300" : "text-red-300";
  const magnitude = Math.abs(delta) > 999 ? ">999" : Math.abs(delta).toFixed(0);
  return (
    <span className={`w-12 shrink-0 text-right font-mono text-[10px] ${colorClass}`}>
      {delta > 0 ? "+" : delta < 0 ? "-" : ""}
      {magnitude}%
    </span>
  );
}

function pctOf(value: number, base: number): number | null {
  return base ? (value / base) * 100 : null;
}

function pctChange(current: number, previousValue?: number | null): number | null {
  if (previousValue == null || previousValue === 0) return null;
  return ((current - previousValue) / Math.abs(previousValue)) * 100;
}


function MonthOrdersModal({
  monthLabel,
  month,
  orders,
  initialFilter,
  onClose,
}: {
  monthLabel: string;
  month: string;
  orders: OrderProfitabilityRow[];
  initialFilter: MonthlyOrderFilter;
  onClose: () => void;
}) {
  const [orderFilter, setOrderFilter] = useState<MonthlyOrderFilter>(initialFilter);
  const filterCounts = useMemo(() => getMonthlyOrderFilterCounts(orders), [orders]);
  const visibleOrders = useMemo(
    () => orders.filter((order) => matchesMonthlyOrderFilter(order, orderFilter)),
    [orders, orderFilter]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-orders-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-border bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="month-orders-title" className="text-base font-semibold">
              Pedidos de {monthLabel}
            </h3>
            <p className="text-xs text-muted-foreground">
              {visibleOrders.length} de {orders.length} pedidos visibles
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => exportCsv(`pedidos-cierre-${month}.csv`, visibleOrders)}
            >
              <Download className="h-4 w-4" /> Exportar
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {MONTHLY_ORDER_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setOrderFilter(filter.value)}
              className={`border px-2.5 py-1 text-sm transition-colors ${
                orderFilter === filter.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {filter.label}{" "}
              <span className="ml-1 font-mono text-xs text-foreground">{filterCounts[filter.value]}</span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <MonthlyOrdersTable rows={visibleOrders} />
        </div>
      </div>
    </div>
  );
}

function MonthAnomaliesModal({
  monthLabel,
  month,
  anomalies,
  claimByAnomalyKey,
  onSaveClaim,
  onClose,
}: {
  monthLabel: string;
  month: string;
  anomalies: FinancialAnomaly[];
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-anomalies-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-border bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="month-anomalies-title" className="text-base font-semibold">
              Anomalias y reclamos de {monthLabel}
            </h3>
            <p className="text-xs text-muted-foreground">{anomalies.length} alertas del mes</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => exportCsv(`anomalias-${month}.csv`, anomalies)}
            >
              <Download className="h-4 w-4" /> Exportar
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <FinancialAnomaliesTable
            anomalies={anomalies}
            claimByAnomalyKey={claimByAnomalyKey}
            onSaveClaim={onSaveClaim}
          />
        </div>
      </div>
    </div>
  );
}

function MonthSkuCostsModal({
  skus,
  titleBySku,
  costs,
  onSave,
  onClose,
}: {
  skus: string[];
  titleBySku: Map<string, string>;
  costs: ProductCost[];
  onSave: (input: ProductCostSaveInput) => Promise<void>;
  onClose: () => void;
}) {
  const [editingSku, setEditingSku] = useState("");
  const costBySku = useMemo(
    () => new Map(costs.map((cost) => [cost.sku.toLowerCase(), cost])),
    [costs]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="month-skus-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="month-skus-title" className="text-base font-semibold">
              SKUs sin costo
            </h3>
            <p className="text-xs text-muted-foreground">
              Asigna el costo aqui mismo; la utilidad se recalcula al guardar.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {skus.length ? (
          <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
            {skus.slice(0, 200).map((sku) => (
              <div
                key={sku}
                className="flex items-center justify-between gap-3 border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm" title={titleBySku.get(sku.toLowerCase()) ?? sku}>
                    {titleBySku.get(sku.toLowerCase()) ?? sku}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{sku}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-2"
                  onClick={() => setEditingSku(sku)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Asignar costo
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Todo al dia: no hay SKUs pendientes de costo en este mes.
          </p>
        )}
      </div>
      {editingSku && (
        <ProductCostQuickEditModal
          sku={editingSku}
          productName={titleBySku.get(editingSku.toLowerCase()) ?? editingSku}
          savedCost={costBySku.get(editingSku.toLowerCase())}
          onClose={() => setEditingSku("")}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function MonthlyOrdersTable({ rows }: { rows: OrderProfitabilityRow[] }) {
  if (!rows.length) {
    return (
      <p className="border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
        No hay pedidos con este mes y filtro.
      </p>
    );
  }

  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1420px] text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2">Origen</th>
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Seguimiento</th>
            <th className="px-3 py-2">Liquidacion</th>
            <th className="px-3 py-2">Archivo</th>
            <th className="px-3 py-2 text-right">A liquidar</th>
            <th className="px-3 py-2 text-right">Costo producto</th>
            <th className="px-3 py-2 text-right">Margen</th>
            <th className="px-3 py-2">Items</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 800).map((row) => {
            const settlementLabel =
              row.settlement_count > 1
                ? "Doble liquidacion"
                : row.settlement_count === 1
                  ? "Liquidada"
                  : "Sin liquidacion";
            const settlementVariant =
              row.settlement_count > 1 ? "warning" : row.settlement_count === 1 ? "success" : "muted";
            return (
              <tr key={row.order_key} className="border-t border-border/50">
                <td className="px-3 py-2 font-mono text-xs">
                  {row.created_at ? formatDate(row.created_at) : "sin fecha"}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={row.source === "boxful" ? "success" : row.source === "liquidacion" ? "warning" : "muted"}>
                    {row.source === "boxful" ? "Boxful" : row.source === "liquidacion" ? "Liquidacion" : "Shopify"}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{row.order_name || "-"}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.guide_number || "-"}</div>
                </td>
                <td className="px-3 py-2">{row.customer_name || "Sin nombre"}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.tracking_status} label={row.tracking_label} />
                </td>
                <td className="px-3 py-2">
                  <Badge variant={settlementVariant}>{settlementLabel}</Badge>
                </td>
                <td className="max-w-[240px] truncate px-3 py-2 text-xs text-muted-foreground" title={row.settlement_files.join(", ")}>
                  {row.settlement_files.join(", ") || "-"}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.amount_to_liquidate)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.product_cost)}</td>
                <td className={`px-3 py-2 text-right font-mono text-xs ${row.contribution_margin < 0 ? "text-red-300" : "text-emerald-300"}`}>
                  {currency(row.contribution_margin)}
                </td>
                <td className="max-w-[340px] truncate px-3 py-2 text-xs text-muted-foreground" title={row.items_summary}>
                  {row.items_summary || "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 800 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Mostrando 800 de {rows.length} pedidos.
        </div>
      )}
    </div>
  );
}

function BoxfulFilesTab({
  files,
  logisticsImports,
}: {
  files: BoxfulFileControl[];
  logisticsImports: LogisticsImport[];
}) {
  const mergedFiles = useMemo(
    () => mergeLogisticsBoxfulFiles(files, logisticsImports),
    [files, logisticsImports]
  );
  const importedCount = mergedFiles.filter((file) => file.status === "importado").length;
  const expectedCount = mergedFiles.filter((file) => file.status === "esperado").length;
  const missingCount = mergedFiles.filter((file) => file.status === "faltante").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Logistica Boxful</CardTitle>
            <p className="text-xs text-muted-foreground">
              Solo lectura. La logistica se registra al importar Boxful desde Pedidos; las liquidaciones se registran en Liquidaciones.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("archivos-boxful.csv", mergedFiles)}>
            <Download className="h-4 w-4" /> Exportar
          </Button>
        </CardHeader>
        <CardContent>
          <section className="grid gap-3 md:grid-cols-4">
            <MiniStat label="Total archivos" value={mergedFiles.length} />
            <MiniStat label="Importados" value={importedCount} />
            <MiniStat label="Esperados" value={expectedCount} />
            <MiniStat label="Faltantes" value={missingCount} />
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Historial logistico</CardTitle>
              <p className="text-xs text-muted-foreground">
                Consolida los archivos logisticos que ya entraron por el flujo operativo de Pedidos.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto border border-border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Archivo</th>
                  <th className="px-3 py-2">Corte</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Import ID</th>
                  <th className="px-3 py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {mergedFiles.map((file) => (
                  <tr key={file.file_name} className="border-t border-border/50">
                    <td className="max-w-[360px] truncate px-3 py-2" title={file.file_name}>{file.file_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{file.cutoff_date ? formatDate(file.cutoff_date) : "-"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={file.status === "faltante" ? "destructive" : file.status === "esperado" ? "warning" : "success"}>
                        {file.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{file.import_id ?? "-"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{file.notes || "-"}</td>
                  </tr>
                ))}
                {!mergedFiles.length && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No hay archivos logisticos importados todavia.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
function BreakdownLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{currency(value)}</span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent = false,
  warning = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <Card className={accent ? "border-primary/40" : warning ? "border-amber-500/40" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            accent
              ? "mt-2 text-2xl font-bold text-primary"
              : warning
                ? "mt-2 text-2xl font-bold text-amber-300"
                : "mt-2 text-2xl font-bold"
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon && <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      {children}
    </button>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  if (status === "delivered") return <Badge variant="success">{label || "Entregado"}</Badge>;
  if (status === "returned" || status === "not_delivered") {
    return <Badge variant="destructive">{label || "No entregado"}</Badge>;
  }
  if (status === "annulled") return <Badge variant="warning">Anulado</Badge>;
  if (status === "unmatched") return <Badge variant="warning">Sin match</Badge>;
  return <Badge variant="muted">{label || "Pendiente"}</Badge>;
}

function currency(value: number): string {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(0)}%`;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function money(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundMoney(value: number): number {
  return money(value);
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

async function readApiJson(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`El servidor devolvio una respuesta invalida (${res.status}). ${preview}`);
  }
}

function buildExpensePayload(
  form: typeof emptyExpense
): { ok: true; expense: ExpensePayload } | { ok: false; error: string } {
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "El monto debe ser numerico y mayor que cero." };
  }

  const baseExpense = {
    type: form.type,
    expense_date: form.expense_date,
    month: form.month,
    platform: form.platform.trim(),
    category: form.category.trim(),
    description: form.description.trim(),
    amount,
    currency: "CRC",
    notes: form.notes.trim(),
  };

  if (!baseExpense.platform) {
    if (form.type === "payroll") return { ok: false, error: "Ingresa la persona asociada al pago de planilla." };
  }

  const originalCurrency = getExpenseOriginalCurrency(form);
  if (originalCurrency === "CRC") return { ok: true, expense: baseExpense };

  const exchangeRate = Number(form.exchange_rate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return {
      ok: false,
      error: `Ingresa el tipo de cambio ${originalCurrency} a CRC para registrar este gasto.`,
    };
  }

  const convertedAmount = roundMoney(amount * exchangeRate);
  const conversionNote = [
    `Monto original: ${originalCurrency} ${amount.toFixed(2)}`,
    `Tipo de cambio ${originalCurrency}->CRC: ${exchangeRate}`,
    baseExpense.notes ? `Nota: ${baseExpense.notes}` : "",
  ].filter(Boolean).join("\n");

  return {
    ok: true,
    expense: {
      ...baseExpense,
      amount: convertedAmount,
      notes: conversionNote,
    },
  };
}

function exportCsv(filename: string, rows: unknown[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: unknown[]): string {
  if (!rows.length) return "";
  const records = rows.map((row) => row && typeof row === "object" ? row as Record<string, unknown> : { value: row });
  const headerSet = records.reduce<Set<string>>((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>());
  const headers = Array.from(headerSet);
  const escape = (value: unknown) => {
    const raw = Array.isArray(value) || (value && typeof value === "object")
      ? JSON.stringify(value)
      : String(value ?? "");
    const text = raw == null ? "" : String(raw);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers.join(","), ...records.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function persistedOrderToSummary(order: Record<string, unknown>): ShopifyOrderSummary {
  // El endpoint ya resuelve lineas y notas; raw_order queda solo como
  // respaldo por si llega una respuesta vieja cacheada.
  const rawOrder = (order.raw_order as Record<string, unknown> | null) ?? {};
  const columnLineItems = (order.line_items as ShopifyOrderSummary["line_items"]) ?? [];
  const rawLineItems = ((rawOrder.line_items as Array<Record<string, unknown>>) ?? []).map((item) => ({
    sku: String(item.sku ?? ""),
    title: String(item.title ?? ""),
    quantity: Number(item.quantity ?? 0),
    price: Number(item.price ?? 0),
  }));
  const lineItems = columnLineItems.length ? columnLineItems : rawLineItems;
  const noteAttributes =
    (order.note_attributes as ShopifyOrderSummary["note_attributes"]) ??
    (rawOrder.note_attributes as ShopifyOrderSummary["note_attributes"]) ??
    [];
  return {
    id: String(order.shopify_order_id ?? order.id ?? ""),
    order_number: Number(order.order_number ?? 0),
    name: String(order.name ?? ""),
    customer_name: String(order.customer_name ?? "Sin nombre"),
    phone: (order.phone as string | null) ?? null,
    products: lineItems.map((item) => `${item.quantity}x ${item.title}`).join(", "),
    total: `${order.total_price ?? 0} ${order.currency ?? "CRC"}`,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: String(order.fulfillment_status ?? ""),
    cancelled_at: (order.cancelled_at as string | null) ?? null,
    note: String(order.note ?? rawOrder.note ?? ""),
    note_attributes: noteAttributes,
    created_at: String(order.shopify_created_at ?? ""),
    line_items: lineItems,
  };
}

function mergeShopifyOrderSummaries(...orderGroups: ShopifyOrderSummary[][]): ShopifyOrderSummary[] {
  const byKey = new Map<string, ShopifyOrderSummary>();
  for (const orders of orderGroups) {
    for (const order of orders) {
      const key = order.id || order.name;
      const existing = byKey.get(key);
      byKey.set(key, existing ? mergeShopifyOrderSummary(existing, order) : order);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function mergeShopifyOrderSummary(
  existing: ShopifyOrderSummary,
  incoming: ShopifyOrderSummary
): ShopifyOrderSummary {
  return {
    ...existing,
    ...incoming,
    customer_name: incoming.customer_name || existing.customer_name,
    phone: incoming.phone ?? existing.phone,
    products: incoming.products || existing.products,
    total: incoming.total || existing.total,
    total_price: incoming.total_price || existing.total_price,
    currency: incoming.currency || existing.currency,
    note: incoming.note || existing.note,
    note_attributes: incoming.note_attributes?.length ? incoming.note_attributes : existing.note_attributes,
    line_items: incoming.line_items?.length ? incoming.line_items : existing.line_items,
    created_at: incoming.created_at || existing.created_at,
  };
}

function getShopifyNotesCreatedAtMin(): string {
  const date = new Date(Date.now() - FINANCE_SHOPIFY_NOTES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

function buildMonthlyCloseRows(
  orders: OrderProfitabilityRow[],
  expenses: BusinessExpense[]
): MonthlyCloseRow[] {
  const byMonth = new Map<string, MonthlyCloseRow>();
  const ensureMonth = (month: string) => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    const row: MonthlyCloseRow = {
      month,
      orders: 0,
      delivered: 0,
      not_delivered: 0,
      annulled: 0,
      pending: 0,
      settled: 0,
      unsettled: 0,
      to_claim: 0,
      duplicate_settlements: 0,
      boxful_costs: 0,
      boxful_cod_commission: 0,
      boxful_card_commission: 0,
      boxful_delivery_cost: 0,
      boxful_pick_pack_cost: 0,
      boxful_packaging_cost: 0,
      cash_received: 0,
      cash_pending: 0,
      product_costs: 0,
      ads: 0,
      payroll: 0,
      misc: 0,
      contribution_margin: 0,
      net_profit: 0,
      misc_software: 0,
      misc_other: 0,
    };
    byMonth.set(month, row);
    return row;
  };

  for (const order of orders) {
    const month = getMonthKey(order.created_at) || "sin-fecha";
    const row = ensureMonth(month);
    row.orders += 1;
    if (order.tracking_status === "delivered") row.delivered += 1;
    if (order.tracking_status === "not_delivered" || order.tracking_status === "returned") row.not_delivered += 1;
    if (order.tracking_status === "annulled") row.annulled += 1;
    if (order.tracking_status === "pending") row.pending += 1;
    if (order.settlement_count === 1) row.settled += 1;
    if (!order.settlement_count) row.unsettled += 1;
    if (order.tracking_status === "delivered" && !order.settlement_count) row.to_claim += 1;
    if (order.settlement_count > 1) row.duplicate_settlements += 1;
    if (order.cash_status === "cobrado") row.cash_received += order.amount_to_liquidate;
    if (order.cash_status === "por_cobrar") row.cash_pending += order.expected_cod;
    row.boxful_costs += order.settlement_charged_costs;
    row.boxful_cod_commission += order.settlement_cod_commission;
    row.boxful_card_commission += order.settlement_card_commission;
    row.boxful_delivery_cost += order.settlement_delivery_cost;
    row.boxful_pick_pack_cost += order.settlement_pick_pack_cost;
    row.boxful_packaging_cost += order.settlement_packaging_cost;
    row.product_costs += order.product_cost;
    row.contribution_margin += order.contribution_margin;
  }

  for (const expense of expenses) {
    const month = expense.month || getMonthKey(expense.expense_date) || "sin-fecha";
    const row = ensureMonth(month);
    const amount = Number(expense.amount || 0);
    if (expense.type === "ads") row.ads += amount;
    if (expense.type === "payroll") row.payroll += amount;
    if (expense.type === "misc") {
      row.misc += amount;
      // El desglose Software vs Otros sale de la categoria/descripcion del gasto.
      const descriptor = `${expense.category} ${expense.description} ${expense.platform}`.toLowerCase();
      if (/software|saas|suscrip|app|herramienta/.test(descriptor)) row.misc_software += amount;
      else row.misc_other += amount;
    }
  }

  return Array.from(byMonth.values())
    .map((row) => ({
      ...row,
      cash_received: roundMoney(row.cash_received),
      cash_pending: roundMoney(row.cash_pending),
      boxful_costs: roundMoney(row.boxful_costs),
      boxful_cod_commission: roundMoney(row.boxful_cod_commission),
      boxful_card_commission: roundMoney(row.boxful_card_commission),
      boxful_delivery_cost: roundMoney(row.boxful_delivery_cost),
      boxful_pick_pack_cost: roundMoney(row.boxful_pick_pack_cost),
      boxful_packaging_cost: roundMoney(row.boxful_packaging_cost),
      product_costs: roundMoney(row.product_costs),
      ads: roundMoney(row.ads),
      payroll: roundMoney(row.payroll),
      misc: roundMoney(row.misc),
      contribution_margin: roundMoney(row.contribution_margin),
      net_profit: roundMoney(row.contribution_margin - row.ads - row.payroll - row.misc),
      misc_software: roundMoney(row.misc_software),
      misc_other: roundMoney(row.misc_other),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function getMonthlyOrderFilterCounts(orders: OrderProfitabilityRow[]): Record<MonthlyOrderFilter, number> {
  const counts: Record<MonthlyOrderFilter, number> = {
    all: orders.length,
    pending: 0,
    delivered: 0,
    not_delivered: 0,
    annulled: 0,
    settled: 0,
    unsettled: 0,
    to_claim: 0,
    duplicate: 0,
  };

  for (const order of orders) {
    if (matchesMonthlyOrderFilter(order, "pending")) counts.pending += 1;
    if (matchesMonthlyOrderFilter(order, "delivered")) counts.delivered += 1;
    if (matchesMonthlyOrderFilter(order, "not_delivered")) counts.not_delivered += 1;
    if (matchesMonthlyOrderFilter(order, "annulled")) counts.annulled += 1;
    if (matchesMonthlyOrderFilter(order, "settled")) counts.settled += 1;
    if (matchesMonthlyOrderFilter(order, "unsettled")) counts.unsettled += 1;
    if (matchesMonthlyOrderFilter(order, "to_claim")) counts.to_claim += 1;
    if (matchesMonthlyOrderFilter(order, "duplicate")) counts.duplicate += 1;
  }

  return counts;
}

function matchesMonthlyOrderFilter(order: OrderProfitabilityRow, filter: MonthlyOrderFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return order.tracking_status === "pending";
  if (filter === "delivered") return order.tracking_status === "delivered";
  if (filter === "not_delivered") {
    return order.tracking_status === "not_delivered" || order.tracking_status === "returned";
  }
  if (filter === "annulled") return order.tracking_status === "annulled";
  if (filter === "settled") return order.settlement_count === 1;
  if (filter === "unsettled") return order.settlement_count === 0;
  if (filter === "to_claim") return order.tracking_status === "delivered" && order.settlement_count === 0;
  return order.settlement_count > 1;
}

// Estado de maduracion del mes segun dias desde su cierre: en COD un mes
// reciente aun no termina de liquidarse y no debe leerse como definitivo.
function getMonthMaturity(month: string): { label: string; className: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(year, monthNumber, 0);
  const days = Math.floor((Date.now() - monthEnd.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 15) return { label: "Abierto", className: "border-sky-500/40 bg-sky-500/10 text-sky-200" };
  if (days <= 30) return { label: "En maduracion", className: "border-amber-500/40 bg-amber-500/10 text-amber-200" };
  if (days <= 45) return { label: "Casi cerrado", className: "border-violet-500/40 bg-violet-500/10 text-violet-200" };
  return { label: "Cerrado", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" };
}

function getMonthKey(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 7);
}

function formatMonthLabel(month: string): string {
  if (month === "all") return "Todos los meses";
  if (month === "sin-fecha") return "Sin fecha Shopify";
  const [year, monthNumber] = month.split("-").map((part) => Number(part));
  if (!year || !monthNumber) return month;
  const date = new Date(year, monthNumber - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString("es-CR", { month: "long", year: "numeric" });
}

function mergeLogisticsBoxfulFiles(
  files: BoxfulFileControl[],
  logisticsImports: LogisticsImport[]
): BoxfulFileControl[] {
  const byName = new Map<string, BoxfulFileControl>();
  for (const file of files) {
    if (file.file_type !== "logistica") continue;
    byName.set(file.file_name, { ...file, file_type: "logistica" });
  }
  for (const item of logisticsImports) {
    if (byName.has(item.file_name)) continue;
    byName.set(item.file_name, {
      id: -item.id,
      file_name: item.file_name,
      file_type: "logistica",
      cutoff_date: item.period_end,
      status: "importado",
      import_id: item.id,
      notes: "",
      imported_at: item.created_at,
    });
  }
  return Array.from(byName.values()).sort((a, b) =>
    String(b.cutoff_date || b.imported_at || "").localeCompare(String(a.cutoff_date || a.imported_at || ""))
  );
}

function buildVisibleOrderRows(
  logisticsRows: LogisticsRow[],
  shopifyOrders: ShopifyOrderSummary[]
): TrackableOrderRow[] {
  const shopifyByMatchKey = buildShopifyOrderMatchIndex(shopifyOrders);
  const logisticsDisplayRows = logisticsRows.map((row): TrackableOrderRow => {
    const shopify = findShopifyOrderForRow(row, shopifyByMatchKey);
    const shopifyItems = shopify
      ? shopify.line_items.map((item) => ({
          sku: item.sku,
          title: `${item.quantity}x ${item.title}`,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
        }))
      : [];

    return {
      ...row,
      row_key: `boxful-${row.id}`,
      source: "boxful" as const,
      customer_name: row.customer_name || shopify?.customer_name || "",
      match_status: shopify ? "matched" : row.match_status,
      cod_amount: row.cod_amount || Number(shopify?.total_price || parseMoneyText(shopify?.total ?? "")),
      shopify_order_name: shopify?.name ?? row.shopify_order_name,
      shopify_order_number: shopify?.order_number ?? row.shopify_order_number,
      shopify_financial_status: shopify?.financial_status ?? row.shopify_financial_status,
      shopify_fulfillment_status: shopify?.fulfillment_status ?? row.shopify_fulfillment_status,
      shopify_cancelled_at: shopify?.cancelled_at ?? row.shopify_cancelled_at,
      shopify_note: shopify?.note ?? "",
      shopify_created_at: shopify?.created_at ?? row.shopify_created_at,
      // Shopify manda: las lineas del pedido definen el producto; los
      // "Paquete N" de Boxful quedan solo como respaldo sin match.
      package_items: shopifyItems.length ? shopifyItems : row.package_items ?? [],
    };
  });
  const consolidatedLogisticsRows = consolidateLogisticsRows(logisticsDisplayRows);

  const existingKeys = new Set<string>();
  for (const row of consolidatedLogisticsRows) {
    for (const key of getOrderMatchKeys(row)) existingKeys.add(key);
  }

  const shopifyOnlyRows = shopifyOrders
    .filter((order) => !getShopifyOrderMatchKeys(order).some((key) => existingKeys.has(key)))
    .map((order): TrackableOrderRow => ({
      row_key: `shopify-${order.id}`,
      source: "shopify",
      guide_number: "",
      order_name: order.name,
      customer_name: order.customer_name,
      boxful_status: "",
      internal_status:
        order.cancelled_at || order.financial_status === "voided" ? "annulled" : "pending",
      match_status: "matched",
      cod_amount: Number(order.total_price || parseMoneyText(order.total)),
      shopify_order_name: order.name,
      shopify_order_number: order.order_number ?? null,
      shopify_financial_status: order.financial_status,
      shopify_fulfillment_status: order.fulfillment_status ?? "",
      shopify_cancelled_at: order.cancelled_at,
      shopify_note: order.note ?? "",
      shopify_created_at: order.created_at,
      package_items: (order.line_items ?? []).map((item) => ({
        sku: item.sku,
        title: `${item.quantity}x ${item.title}`,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
      })),
    }));

  return [...consolidatedLogisticsRows, ...shopifyOnlyRows].sort((a, b) =>
    String(b.shopify_created_at || "").localeCompare(String(a.shopify_created_at || ""))
  );
}

function consolidateLogisticsRows(rows: TrackableOrderRow[]): TrackableOrderRow[] {
  const byOrder = new Map<string, TrackableOrderRow>();

  for (const row of rows) {
    const key = getLogisticsConsolidationKey(row);
    const current = byOrder.get(key);
    byOrder.set(key, current ? pickBestLogisticsRow(current, row) : row);
  }

  return Array.from(byOrder.values());
}

function getLogisticsConsolidationKey(row: TrackableOrderRow): string {
  return (
    normalizeMatchKey(row.shopify_order_name) ||
    (row.shopify_order_number ? normalizeMatchKey(`#MCRC${row.shopify_order_number}`) : "") ||
    normalizeMatchKey(row.order_name) ||
    normalizeMatchKey(row.guide_number) ||
    row.row_key
  );
}

function pickBestLogisticsRow(current: TrackableOrderRow, candidate: TrackableOrderRow): TrackableOrderRow {
  const currentScore = getLogisticsTrackingScore(current);
  const candidateScore = getLogisticsTrackingScore(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;

  const currentDate = getLogisticsStatusDate(current);
  const candidateDate = getLogisticsStatusDate(candidate);
  if (candidateDate !== currentDate) return candidateDate > currentDate ? candidate : current;

  const currentHasShopify = normalizeMatchKey(current.shopify_order_name) ? 1 : 0;
  const candidateHasShopify = normalizeMatchKey(candidate.shopify_order_name) ? 1 : 0;
  if (candidateHasShopify !== currentHasShopify) return candidateHasShopify > currentHasShopify ? candidate : current;

  return candidate.id && current.id && candidate.id > current.id ? candidate : current;
}

function getLogisticsTrackingScore(row: TrackableOrderRow): number {
  const inferredStatus = isFinalTrackingStatus(row.internal_status)
    ? row.internal_status
    : inferTrackingStatusFromText(row.boxful_status);
  const status = getTrackingFilterFromStatus(inferredStatus);
  if (status === "delivered" || status === "not_delivered") return 3;
  if (row.source === "boxful" && row.guide_number) return 2;
  return 1;
}

function getLogisticsStatusDate(row: TrackableOrderRow): string {
  return String(row.finalized_on || row.created_on || row.shopify_created_at || row.created_at || "");
}

function enrichSettlementRowsWithShopify(
  rows: SettlementRow[],
  shopifyOrders: ShopifyOrderSummary[]
): SettlementRow[] {
  if (!rows.length || !shopifyOrders.length) return rows;

  const shopifyByMatchKey = buildShopifyOrderMatchIndex(shopifyOrders);
  return rows.map((row) => {
    const shopify = findShopifyOrderForRow(
      {
        order_name: row.order_name,
        shopify_order_name: row.shopify_order_name,
      },
      shopifyByMatchKey
    );
    if (!shopify) return row;

    return {
      ...row,
      match_status: "matched",
      shopify_order_id: shopify.id,
      shopify_order_name: shopify.name,
      shopify_financial_status: shopify.financial_status,
      shopify_fulfillment_status: shopify.fulfillment_status ?? "",
      shopify_total: Number(shopify.total_price || parseMoneyText(shopify.total)),
      shopify_created_at: shopify.created_at,
      order_items: row.order_items?.length
        ? row.order_items
        : shopify.line_items.map((item) => ({
            sku: String(item.sku ?? "").toLowerCase(),
            title: String(item.title ?? ""),
            quantity: Number(item.quantity || 0),
            price: Number(item.price || 0),
          })),
    };
  });
}

type OrderMatchKeySource = {
  order_name?: string | null;
  shopify_order_name?: string | null;
  shopify_order_number?: number | null;
  shopify_note?: string | null;
};

function buildShopifyOrderMatchIndex(orders: ShopifyOrderSummary[]): Map<string, ShopifyOrderSummary> {
  const byKey = new Map<string, ShopifyOrderSummary>();

  for (const order of orders) {
    for (const key of extractExternalOrderCodesFromText(getShopifyNoteText(order)).map(normalizeMatchKey)) {
      if (!byKey.has(key)) byKey.set(key, order);
    }
  }

  for (const order of orders) {
    for (const key of getShopifyDirectOrderMatchKeys(order)) {
      if (!byKey.has(key)) byKey.set(key, order);
    }
  }
  return byKey;
}

function findShopifyOrderForRow(
  row: OrderMatchKeySource,
  shopifyByMatchKey: Map<string, ShopifyOrderSummary>
): ShopifyOrderSummary | undefined {
  for (const key of getOrderMatchKeys(row)) {
    const order = shopifyByMatchKey.get(key);
    if (order) return order;
  }
  return undefined;
}

function getOrderMatchKeys(row: OrderMatchKeySource): string[] {
  const orderNumber = row.shopify_order_number;
  const orderNameKey = normalizeMatchKey(row.order_name ?? "");
  // Guias reenviadas ("#MCRC10099-V2") cruzan con su pedido base de Shopify.
  const reshipmentBaseKey = /^mcrc\d+-v\d+$/.test(orderNameKey)
    ? orderNameKey.replace(/-v\d+$/, "")
    : "";
  return uniqueKeys([
    orderNameKey,
    reshipmentBaseKey,
    ...extractExternalOrderCodesFromText(row.shopify_note ?? "").map(normalizeMatchKey),
    normalizeMatchKey(row.shopify_order_name ?? ""),
    orderNumber ? normalizeMatchKey(`#MCRC${orderNumber}`) : "",
  ]);
}

function getShopifyOrderMatchKeys(order: ShopifyOrderSummary): string[] {
  return uniqueKeys([
    ...extractExternalOrderCodesFromText(getShopifyNoteText(order)).map(normalizeMatchKey),
    ...getShopifyDirectOrderMatchKeys(order),
  ]);
}

function getShopifyDirectOrderMatchKeys(order: ShopifyOrderSummary): string[] {
  const orderNumber = order.order_number;
  return uniqueKeys([
    normalizeMatchKey(order.name),
    orderNumber ? normalizeMatchKey(`#MCRC${orderNumber}`) : "",
  ]);
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

function parseMoneyText(value: string): number {
  return Number(String(value || "").replace(/,/g, "").replace(/[^0-9.-]/g, "")) || 0;
}

function buildFinanceControlCenter(
  visibleOrders: TrackableOrderRow[],
  settlementRows: SettlementRow[],
  imports: SettlementImport[],
  costs: ProductCost[],
  costVersions: ProductCostVersion[],
  settlementTraceByKey: Map<string, SettlementTrace[]>
): FinanceControlCenter {
  const fileByImportId = new Map(imports.map((item) => [item.id, item.file_name]));
  const settlementRowsByKey = buildSettlementRowsByKey(settlementRows);
  const costVersionsBySku = buildCostVersionsBySku(costs, costVersions);
  const consumedSettlementIds = new Set<number>();
  const orders: OrderProfitabilityRow[] = [];
  const anomalies: FinancialAnomaly[] = [];

  for (const order of visibleOrders) {
    const matchedSettlementRows = getMatchedSettlementRowsForOrder(order, settlementRowsByKey);
    matchedSettlementRows.forEach((row) => consumedSettlementIds.add(row.id));

    const traces = getSettlementTracesForLogisticsRow(order, settlementTraceByKey);
    const trackingStatus = getEffectiveTrackingStatus(order, traces);
    const trackingLabel = getTrackingStatusLabel(order, traces, trackingStatus);
    const financialRow = buildOrderProfitabilityRow({
      order,
      settlementRows: matchedSettlementRows,
      fileByImportId,
      costVersionsBySku,
      trackingStatus,
      trackingLabel,
    });

    orders.push(financialRow);
    anomalies.push(...buildFinancialAnomalies(financialRow, matchedSettlementRows));
  }

  for (const settlementRow of settlementRows.filter((row) => !consumedSettlementIds.has(row.id))) {
    const standaloneOrder = settlementRowToTrackableOrder(settlementRow);
    const traces = getSettlementTracesForLogisticsRow(standaloneOrder, settlementTraceByKey);
    const trackingStatus = getEffectiveTrackingStatus(standaloneOrder, traces);
    const financialRow = buildOrderProfitabilityRow({
      order: standaloneOrder,
      settlementRows: [settlementRow],
      fileByImportId,
      costVersionsBySku,
      trackingStatus,
      trackingLabel: getTrackingStatusLabel(standaloneOrder, traces, trackingStatus),
    });

    orders.push(financialRow);
    anomalies.push(...buildFinancialAnomalies(financialRow, [settlementRow]));
  }

  const uniqueAnomalies = uniqueFinancialAnomalies(anomalies).sort(sortAnomalies);
  const sortedOrders = orders.sort((a, b) => {
    if (b.issue_count !== a.issue_count) return b.issue_count - a.issue_count;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });

  return {
    orders: sortedOrders,
    anomalies: uniqueAnomalies,
    cash_received: roundMoney(sum(orders.filter((row) => row.cash_status === "cobrado").map((row) => row.amount_to_liquidate))),
    cash_pending: roundMoney(sum(orders.filter((row) => row.cash_status === "por_cobrar").map((row) => row.expected_cod))),
    contribution_margin: roundMoney(sum(orders.map((row) => row.contribution_margin))),
    missing_cost_count: orders.filter((row) => row.missing_cost_skus.length > 0).length,
  };
}

function buildProductAnalysisRows(orders: OrderProfitabilityRow[]): ProductAnalysisRow[] {
  const byProduct = new Map<string, ProductAnalysisRow>();

  for (const order of orders) {
    if (!isShopifyProductAnalysisOrder(order)) continue;

    const itemsByProduct = new Map<string, { sku: string; title: string; quantity: number }>();
    const items = getProductAnalysisItems(order);

    for (const item of items) {
      const normalized = normalizeProductLineItem(item);
      const existing = itemsByProduct.get(normalized.key);
      if (existing) {
        existing.quantity += normalized.quantity;
        if (!existing.sku && normalized.sku) existing.sku = normalized.sku;
        continue;
      }
      itemsByProduct.set(normalized.key, {
        sku: normalized.sku,
        title: normalized.title,
        quantity: normalized.quantity,
      });
    }

    const status = getProductOrderAnalysisStatus(order);
    for (const [key, item] of Array.from(itemsByProduct.entries())) {
      const existing = byProduct.get(key) ?? {
        key,
        product_name: item.title,
        sku: item.sku,
        sample_orders: [],
        orders: 0,
        units: 0,
        dispatched: 0,
        dispatch_rate: 0,
        delivery_effectiveness: 0,
        delivered: 0,
        not_delivered: 0,
        annulled: 0,
        pending: 0,
      };

      existing.orders += 1;
      existing.units += item.quantity;
      if (!existing.sku && item.sku) existing.sku = item.sku;
      const sampleOrder = order.order_name || order.guide_number || order.customer_name;
      if (sampleOrder && existing.sample_orders.length < 5 && !existing.sample_orders.includes(sampleOrder)) {
        existing.sample_orders.push(sampleOrder);
      }
      existing[status] += 1;
      if (hasBoxfulGuide(order)) existing.dispatched += 1;
      existing.dispatch_rate = existing.orders ? (existing.dispatched / existing.orders) * 100 : 0;
      existing.delivery_effectiveness = existing.dispatched
        ? (existing.delivered / existing.dispatched) * 100
        : 0;
      byProduct.set(key, existing);
    }
  }

  return Array.from(byProduct.values()).sort(
    (a, b) =>
      b.orders - a.orders ||
      a.delivery_effectiveness - b.delivery_effectiveness ||
      a.product_name.localeCompare(b.product_name)
  );
}

function mergeProductAnalysisWithCatalog(
  rows: ProductAnalysisRow[],
  products: ShopifyProductOption[]
): ProductAnalysisRow[] {
  const merged = rows.map((row) => ({ ...row, sample_orders: [...row.sample_orders] }));
  const byTitleKey = new Map<string, ProductAnalysisRow>();
  const seenSkus = new Set<string>();

  for (const row of merged) {
    const sku = row.sku.trim().toLowerCase();
    if (sku) seenSkus.add(sku);
    const titleKey = getProductTitleCostKey(row.product_name);
    if (titleKey && !byTitleKey.has(titleKey)) byTitleKey.set(titleKey, row);
  }

  for (const product of products) {
    const sku = String(product.sku || "").trim();
    const skuKey = sku.toLowerCase();
    const titleKey = getProductTitleCostKey(product.display_name);
    if (skuKey && seenSkus.has(skuKey)) continue;

    const titleMatch = titleKey ? byTitleKey.get(titleKey) : undefined;
    if (titleMatch) {
      if (!titleMatch.sku && sku) {
        titleMatch.sku = sku;
        seenSkus.add(skuKey);
      }
      continue;
    }

    merged.push({
      key: skuKey ? `catalog:${skuKey}` : titleKey || `catalog:${product.variant_id}`,
      product_name: product.display_name,
      sku,
      sample_orders: [],
      orders: 0,
      units: 0,
      dispatched: 0,
      dispatch_rate: 0,
      delivery_effectiveness: 0,
      delivered: 0,
      not_delivered: 0,
      annulled: 0,
      pending: 0,
    });
    if (skuKey) seenSkus.add(skuKey);
    if (titleKey) byTitleKey.set(titleKey, merged[merged.length - 1]);
  }

  return merged;
}

function getProductAnalysisItems(order: OrderProfitabilityRow): ProductLineItem[] {
  if (order.items.length) return order.items;
  const parsedSummaryItems = parseItemsSummary(order.items_summary);
  if (parsedSummaryItems.length) return parsedSummaryItems;
  return [{ title: UNKNOWN_PRODUCT_LABEL, quantity: 1, price: 0 }];
}

function parseItemsSummary(summary: string): ProductLineItem[] {
  return String(summary || "")
    .split(/\s*,\s*/)
    .map((part): ProductLineItem | null => {
      const trimmed = part.trim();
      if (!trimmed) return null;

      const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i);
      const quantity = match ? Math.max(1, Number(match[1] || 1)) : 1;
      const title = cleanProductTitle(match?.[2] ?? trimmed);
      if (!title || title === UNKNOWN_PRODUCT_LABEL) return null;

      return {
        sku: looksLikeSkuOnly(title) ? title.toLowerCase() : "",
        title,
        quantity,
        price: 0,
      };
    })
    .filter((item): item is ProductLineItem => Boolean(item));
}

function looksLikeSkuOnly(value: string): boolean {
  const text = value.trim();
  return Boolean(text && !/\s/.test(text) && /^[a-z0-9._-]{3,}$/i.test(text));
}

function normalizeProductLineItem(item: ProductLineItem): { key: string; sku: string; title: string; quantity: number } {
  const sku = String(item.sku ?? "").trim();
  const title = cleanProductTitle(item.title || sku || UNKNOWN_PRODUCT_LABEL);
  const titleKey = getProductTitleCostKey(title);
  const key = titleKey || (sku ? `sku:${sku.toLowerCase()}` : `title:${title.toLowerCase()}`);
  return {
    key,
    sku,
    title,
    quantity: Math.max(1, Number(item.quantity || 1)),
  };
}

function cleanProductTitle(title: string): string {
  return String(title || UNKNOWN_PRODUCT_LABEL)
    .replace(/^\s*\d+\s*x\s*/i, "")
    .trim() || UNKNOWN_PRODUCT_LABEL;
}

function getProductAnalysisCostKey(row: Pick<ProductAnalysisRow, "sku" | "product_name">): string {
  const sku = String(row.sku || "").trim().toLowerCase();
  if (sku) return sku;
  return getProductTitleCostKey(row.product_name);
}

function getProductAnalysisCostLookupKeys(row: Pick<ProductAnalysisRow, "sku" | "product_name">): string[] {
  return uniqueKeys([
    String(row.sku || "").trim().toLowerCase(),
    getProductTitleCostKey(row.product_name),
  ]);
}

function getProductCostForAnalysisRow(
  row: Pick<ProductAnalysisRow, "sku" | "product_name">,
  costBySku: Map<string, ProductCost>
): ProductCost | undefined {
  for (const key of getProductAnalysisCostLookupKeys(row)) {
    const cost = costBySku.get(key);
    if (cost) return cost;
  }
  return undefined;
}

function getProductVersionsForAnalysisRow(
  row: Pick<ProductAnalysisRow, "sku" | "product_name">,
  versionsBySku: Map<string, ProductCostVersion[]>
): ProductCostVersion[] {
  for (const key of getProductAnalysisCostLookupKeys(row)) {
    const versions = versionsBySku.get(key);
    if (versions?.length) return versions;
  }
  return [];
}

function getProductVersionKeyForAnalysisRow(
  row: Pick<ProductAnalysisRow, "sku" | "product_name">,
  versionsBySku: Map<string, ProductCostVersion[]>
): string {
  return getProductAnalysisCostLookupKeys(row).find((key) => (versionsBySku.get(key) ?? []).length > 0) ?? "";
}

function getProductItemCostKey(item: Pick<ProductLineItem, "sku" | "title">): string {
  const sku = String(item.sku || "").trim().toLowerCase();
  if (sku) return sku;
  return getProductTitleCostKey(item.title);
}

function getProductTitleCostKey(title: string): string {
  const cleanTitle = cleanProductTitle(title);
  if (!cleanTitle || cleanTitle === UNKNOWN_PRODUCT_LABEL) return "";
  const slug = cleanTitle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug ? `producto:${slug}` : "";
}

function hasBoxfulGuide(order: Pick<OrderProfitabilityRow, "guide_number">): boolean {
  const guide = String(order.guide_number || "").trim();
  return Boolean(guide && guide !== "-" && guide !== "0");
}

function isShopifyProductAnalysisOrder(
  order: Pick<
    OrderProfitabilityRow,
    "source" | "order_name" | "shopify_financial_status" | "shopify_cancelled_at" | "created_at"
  >
): boolean {
  if (order.source === "shopify") return true;
  if (order.shopify_financial_status || order.shopify_cancelled_at || order.created_at) return true;
  return /^#?MCRC/i.test(order.order_name);
}

function getProductOrderAnalysisStatus(
  row: Pick<OrderProfitabilityRow, "tracking_status" | "shopify_cancelled_at" | "shopify_financial_status">
): "pending" | "annulled" | "delivered" | "not_delivered" {
  if (isShopifyCancelled(row)) return "annulled";
  if (row.tracking_status === "delivered") return "delivered";
  if (row.tracking_status === "not_delivered" || row.tracking_status === "returned") return "not_delivered";
  return "pending";
}

function matchesProductAnalysisFilter(
  row: ProductAnalysisRow,
  filter: ProductAnalysisFilter,
  costBySku: Map<string, ProductCost>
): boolean {
  if (filter === "all") return true;
  if (filter === "unknown_product") return row.product_name === UNKNOWN_PRODUCT_LABEL;
  if (filter === "no_cost") {
    const costKey = getProductAnalysisCostKey(row);
    if (!costKey) return false;
    const cost = getProductCostForAnalysisRow(row, costBySku);
    return !cost || Number(cost.unit_cost || 0) <= 0;
  }
  return row[filter] > 0;
}

function summarizeProductAnalysisRows(rows: ProductAnalysisRow[]): Pick<
  ProductAnalysisRow,
  "orders" | "dispatched" | "delivered" | "not_delivered" | "annulled" | "pending" | "dispatch_rate" | "delivery_effectiveness"
> {
  const orders = sum(rows.map((row) => row.orders));
  const dispatched = sum(rows.map((row) => row.dispatched));
  const delivered = sum(rows.map((row) => row.delivered));
  const notDelivered = sum(rows.map((row) => row.not_delivered));
  const annulled = sum(rows.map((row) => row.annulled));
  const pending = sum(rows.map((row) => row.pending));
  return {
    orders,
    dispatched,
    delivered,
    not_delivered: notDelivered,
    annulled,
    pending,
    dispatch_rate: orders ? (dispatched / orders) * 100 : 0,
    delivery_effectiveness: dispatched ? (delivered / dispatched) * 100 : 0,
  };
}

function getProductAnalysisFilterCounts(
  rows: ProductAnalysisRow[],
  costBySku: Map<string, ProductCost>
): Record<ProductAnalysisFilter, number> {
  return {
    all: rows.length,
    no_cost: rows.filter((row) => matchesProductAnalysisFilter(row, "no_cost", costBySku)).length,
    unknown_product: rows.filter((row) => row.product_name === UNKNOWN_PRODUCT_LABEL).length,
    pending: rows.filter((row) => row.pending > 0).length,
    annulled: rows.filter((row) => row.annulled > 0).length,
    delivered: rows.filter((row) => row.delivered > 0).length,
    not_delivered: rows.filter((row) => row.not_delivered > 0).length,
  };
}

function buildSettlementRowsByKey(settlementRows: SettlementRow[]): Map<string, SettlementRow[]> {
  const rowsByKey = new Map<string, SettlementRow[]>();
  for (const row of settlementRows) {
    for (const key of uniqueKeys([
      normalizeMatchKey(row.order_name),
      normalizeMatchKey(row.shopify_order_name),
      normalizeMatchKey(row.guide_number),
    ])) {
      rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row]);
    }
  }
  return rowsByKey;
}

function getMatchedSettlementRowsForOrder(
  order: TrackableOrderRow,
  rowsByKey: Map<string, SettlementRow[]>
): SettlementRow[] {
  const seen = new Set<number>();
  const matches: SettlementRow[] = [];
  const keys = uniqueKeys([
    ...getOrderMatchKeys(order),
    normalizeMatchKey(order.guide_number),
  ]);

  for (const key of keys) {
    for (const row of rowsByKey.get(key) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      matches.push(row);
    }
  }

  return matches;
}

function buildOrderProfitabilityRow({
  order,
  settlementRows,
  fileByImportId,
  costVersionsBySku,
  trackingStatus,
  trackingLabel,
}: {
  order: TrackableOrderRow;
  settlementRows: SettlementRow[];
  fileByImportId: Map<number, string>;
  costVersionsBySku: Map<string, ProductCostVersion[]>;
  trackingStatus: string;
  trackingLabel: string;
}): OrderProfitabilityRow {
  const settlementFiles = uniqueKeys(
    settlementRows.map((row) => fileByImportId.get(row.import_id) || `Import #${row.import_id}`)
  );
  const settlementStatuses = uniqueKeys(settlementRows.map((row) => row.settlement_status || row.internal_status));
  const amountToLiquidate = sum(settlementRows.map((row) => row.amount_to_liquidate));
  const settlementCodCommission = sum(settlementRows.map((row) => Number(row.cod_commission || 0)));
  const settlementCardCommission = sum(settlementRows.map((row) => Number(row.card_commission || 0)));
  const settlementDeliveryCost = sum(settlementRows.map((row) => Number(row.delivery_cost || 0)));
  const settlementPickPackCost = sum(settlementRows.map((row) => Number(row.pick_pack_cost || 0)));
  const settlementPackagingCost = sum(settlementRows.map((row) => Number(row.packaging_cost || 0)));
  const settlementChargedCosts =
    settlementCodCommission +
    settlementCardCommission +
    settlementDeliveryCost +
    settlementPickPackCost +
    settlementPackagingCost;
  const settlementCodAmount = sum(settlementRows.map((row) => row.cod_amount));
  const expectedCod = order.cod_amount || sum(settlementRows.map((row) => row.cod_amount));
  const items = getProfitabilityItems(order, settlementRows);
  const productCostResult = calculateProductCost(items, costVersionsBySku, trackingStatus, order.shopify_created_at);
  const hasSettlement = settlementRows.length > 0;
  const shopifyCancelledWithMovement = isShopifyCancelled(order) && (order.source !== "shopify" || hasSettlement);
  const cashStatus =
    hasSettlement ? "cobrado" : trackingStatus === "delivered" ? "por_cobrar" : "sin_caja";

  const issueCount =
    (trackingStatus === "delivered" && !hasSettlement ? 1 : 0) +
    (settlementRows.length > 1 ? 1 : 0) +
    (shopifyCancelledWithMovement ? 1 : 0) +
    (productCostResult.missingCostSkus.length ? 1 : 0) +
    (shouldFlagNegativeMargin(amountToLiquidate - productCostResult.productCost, settlementCodAmount) ? 1 : 0);

  return {
    order_key: order.row_key,
    order_name: order.order_name || order.shopify_order_name,
    guide_number: order.guide_number,
    customer_name: order.customer_name,
    source: order.source,
    shopify_cancelled_at: order.shopify_cancelled_at,
    shopify_financial_status: order.shopify_financial_status,
    tracking_status: trackingStatus,
    tracking_label: trackingLabel,
    settlement_status: settlementStatuses.join(", ") || "Sin liquidacion",
    settlement_files: settlementFiles,
    settlement_count: settlementRows.length,
    settlement_charged_costs: roundMoney(settlementChargedCosts),
    settlement_cod_commission: roundMoney(settlementCodCommission),
    settlement_card_commission: roundMoney(settlementCardCommission),
    settlement_delivery_cost: roundMoney(settlementDeliveryCost),
    settlement_pick_pack_cost: roundMoney(settlementPickPackCost),
    settlement_packaging_cost: roundMoney(settlementPackagingCost),
    amount_to_liquidate: roundMoney(amountToLiquidate),
    expected_cod: roundMoney(expectedCod),
    product_cost: productCostResult.productCost,
    contribution_margin: roundMoney(amountToLiquidate - productCostResult.productCost),
    missing_cost_skus: productCostResult.missingCostSkus,
    items,
    items_summary: summarizeItems(items),
    cash_status: cashStatus,
    issue_count: issueCount,
    created_at: order.shopify_created_at,
    days_since_order: order.shopify_created_at ? daysSince(order.shopify_created_at) : null,
    delivered_on: order.finalized_on ?? null,
  };
}

function settlementRowToTrackableOrder(row: SettlementRow): TrackableOrderRow {
  return {
    row_key: `liquidacion-${row.id}`,
    source: "liquidacion",
    guide_number: row.guide_number,
    order_name: row.order_name || row.shopify_order_name,
    customer_name: row.customer_name,
    boxful_status: row.settlement_status,
    internal_status: row.internal_status,
    match_status: row.match_status,
    cod_amount: 0,
    shopify_order_name: row.shopify_order_name,
    shopify_order_number: null,
    shopify_financial_status: row.shopify_financial_status,
    shopify_fulfillment_status: row.shopify_fulfillment_status,
    shopify_cancelled_at: null,
    shopify_created_at: row.shopify_created_at ?? null,
    package_items: row.order_items,
  };
}

function getProfitabilityItems(
  order: TrackableOrderRow,
  settlementRows: SettlementRow[]
): Array<{ sku?: string; title: string; quantity: number; price: number }> {
  const settlementItems = settlementRows.flatMap((row) => row.order_items ?? []);
  if (settlementItems.length) return settlementItems;
  return order.package_items ?? [];
}

function buildCostVersionsBySku(
  costs: ProductCost[],
  versions: ProductCostVersion[]
): Map<string, ProductCostVersion[]> {
  const bySku = new Map<string, ProductCostVersion[]>();
  const allVersions: ProductCostVersion[] = [
    ...versions,
    ...costs
      .filter((cost) => cost.active)
      .map((cost) => ({
        id: -cost.id,
        sku: cost.sku,
        product_name: cost.product_name,
        unit_cost: cost.unit_cost,
        packaging_cost: cost.packaging_cost,
        currency: cost.currency,
        effective_from: cost.effective_from || "1900-01-01",
        created_at: "",
      })),
  ];

  for (const version of allVersions) {
    const key = version.sku.toLowerCase();
    bySku.set(key, [...(bySku.get(key) ?? []), version]);

    const titleKey = getProductTitleCostKey(version.product_name);
    if (titleKey && titleKey !== key) bySku.set(titleKey, [...(bySku.get(titleKey) ?? []), version]);
  }

  for (const [sku, skuVersions] of Array.from(bySku.entries())) {
    bySku.set(
      sku,
      skuVersions.sort((a, b) =>
        b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at)
      )
    );
  }
  return bySku;
}

function calculateProductCost(
  items: Array<{ sku?: string; title: string; quantity: number; price: number }>,
  costVersionsBySku: Map<string, ProductCostVersion[]>,
  trackingStatus: string,
  orderDate: string | null
): { productCost: number; missingCostSkus: string[] } {
  if (trackingStatus !== "delivered") return { productCost: 0, missingCostSkus: [] };

  const missingCostSkus = new Set<string>();
  let productCost = 0;

  for (const item of items) {
    const costKey = getProductItemCostKey(item);
    if (!costKey) continue;
    const cost = pickCostVersion(costVersionsBySku.get(costKey) ?? [], orderDate);
    if (!cost) {
      missingCostSkus.add(costKey);
      continue;
    }
    productCost += (Number(cost.unit_cost || 0) + Number(cost.packaging_cost || 0)) * Number(item.quantity || 0);
  }

  return {
    productCost: roundMoney(productCost),
    missingCostSkus: Array.from(missingCostSkus),
  };
}

function pickCostVersion(versions: ProductCostVersion[], orderDate: string | null): ProductCostVersion | undefined {
  if (!versions.length) return undefined;
  const date = (orderDate || new Date().toISOString()).slice(0, 10);
  return versions.find((version) => version.effective_from <= date) ?? versions[versions.length - 1];
}

function buildFinancialAnomalies(
  row: OrderProfitabilityRow,
  settlementRows: SettlementRow[]
): FinancialAnomaly[] {
  const anomalies: FinancialAnomaly[] = [];
  const hasSettlement = settlementRows.length > 0;
  const sourceFile = row.settlement_files[0] ?? "";

  if (row.tracking_status === "delivered" && !hasSettlement) {
    anomalies.push({
      id: `${row.order_key}-delivered-without-settlement`,
      severity: "high",
      type: "Entregado sin liquidacion",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.expected_cod,
      source_file: sourceFile,
      message: "Boxful/seguimiento indica entregado pero no aparece en liquidacion.",
      action: "Reclamar liquidacion a Boxful y revisar el corte faltante.",
    });
  }

  if (settlementRows.length > 1) {
    anomalies.push({
      id: `${row.order_key}-duplicate-settlement`,
      severity: "high",
      type: "Doble liquidacion",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: `El pedido aparece ${settlementRows.length} veces en liquidaciones.`,
      action: "Validar que no exista cobro duplicado o archivo repetido.",
    });
  }

  if (hasSettlement && row.tracking_status !== "delivered" && settlementRows.some((item) => item.internal_status === "delivered")) {
    anomalies.push({
      id: `${row.order_key}-settlement-without-delivery`,
      severity: "medium",
      type: "Liquidado sin entrega confirmada",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: "Liquidacion reporta entregado pero seguimiento no esta entregado.",
      action: "Comparar Boxful logistico contra liquidacion y corregir estado.",
    });
  }

  const shopifyCancelledWithMovement = isShopifyCancelled(row) && (row.source !== "shopify" || hasSettlement);
  if (shopifyCancelledWithMovement) {
    anomalies.push({
      id: `${row.order_key}-cancelled-with-movement`,
      severity: row.tracking_status === "delivered" ? "high" : "medium",
      type: "Anulado Shopify con movimiento",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: "Shopify indica anulado/cancelado, pero Boxful o liquidacion muestran movimiento operativo.",
      action: "No tratar como anulado puro; seguir estado Boxful. Si se entrego, contabilizar caja/margen; si no se entrego, reconocer costos logisticos.",
    });
  }

  if (row.missing_cost_skus.length) {
    anomalies.push({
      id: `${row.order_key}-missing-cost`,
      severity: "medium",
      type: "SKU sin costo",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: `Falta costo para ${row.missing_cost_skus.join(", ")}.`,
      action: "Completar costo unitario/empaque en Costos SKU para cerrar margen.",
    });
  }

  const settlementCodAmount = sum(settlementRows.map((item) => item.cod_amount));

  if (hasSettlement && shouldFlagNegativeMargin(row.contribution_margin, settlementCodAmount)) {
    anomalies.push({
      id: `${row.order_key}-negative-margin`,
      severity: "medium",
      type: "Margen negativo",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.contribution_margin,
      source_file: sourceFile,
      message: `El pedido queda con margen ${currency(row.contribution_margin)} antes de ads/planilla.`,
      action: "Revisar precio, costo SKU, cobros logisticos y promociones.",
    });
  }

  if (row.source === "shopify" && row.tracking_status === "pending" && Number(row.days_since_order ?? 0) >= 2) {
    anomalies.push({
      id: `${row.order_key}-shopify-without-boxful`,
      severity: "low",
      type: "Shopify sin Boxful",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.expected_cod,
      source_file: sourceFile,
      message: "Pedido Shopify sigue sin guia Boxful despues de 2 dias.",
      action: "Confirmar si se despacho, si falta importar el archivo logistico o si fue anulado manualmente.",
    });
  }

  return anomalies;
}

function shouldFlagNegativeMargin(contributionMargin: number, settlementCodAmount: number): boolean {
  if (contributionMargin >= 0) return false;
  return settlementCodAmount > 0;
}

function uniqueFinancialAnomalies(anomalies: FinancialAnomaly[]): FinancialAnomaly[] {
  const seen = new Set<string>();
  const unique: FinancialAnomaly[] = [];
  for (const anomaly of anomalies) {
    if (seen.has(anomaly.id)) continue;
    seen.add(anomaly.id);
    unique.push(anomaly);
  }
  return unique;
}

function sortAnomalies(a: FinancialAnomaly, b: FinancialAnomaly): number {
  const severityRank = { high: 3, medium: 2, low: 1 };
  return severityRank[b.severity] - severityRank[a.severity] || a.type.localeCompare(b.type);
}

function summarizeItems(items: Array<{ sku?: string; title: string; quantity: number }>): string {
  return items
    .slice(0, 2)
    .map((item) => `${item.quantity || 1}x ${item.sku || item.title}`)
    .join(", ");
}

function daysSince(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function getDeliveredWithoutSettlement(
  logisticsRows: LogisticsRow[],
  settlementRows: SettlementRow[]
): LogisticsRow[] {
  const settledOrderKeys = new Set<string>();
  const settledGuideKeys = new Set<string>();

  for (const row of settlementRows) {
    const orderKey = normalizeMatchKey(row.order_name || row.shopify_order_name);
    const guideKey = normalizeMatchKey(row.guide_number);
    if (orderKey) settledOrderKeys.add(orderKey);
    if (guideKey) settledGuideKeys.add(guideKey);
  }

  return logisticsRows.filter((row) => {
    if (row.internal_status !== "delivered") return false;
    const orderKey = normalizeMatchKey(row.order_name || row.shopify_order_name);
    const guideKey = normalizeMatchKey(row.guide_number);
    return !((orderKey && settledOrderKeys.has(orderKey)) || (guideKey && settledGuideKeys.has(guideKey)));
  });
}

function buildSettlementTraceByKey(
  settlementRows: SettlementRow[],
  imports: SettlementImport[]
): Map<string, SettlementTrace[]> {
  const fileByImportId = new Map(imports.map((item) => [item.id, item.file_name]));
  const traceByKey = new Map<string, SettlementTrace[]>();

  for (const row of settlementRows) {
    const trace: SettlementTrace = {
      file_name: fileByImportId.get(row.import_id) || `Import #${row.import_id}`,
      amount_to_liquidate: row.amount_to_liquidate,
      settlement_status: row.settlement_status,
      internal_status: row.internal_status,
    };
    addSettlementTrace(traceByKey, normalizeMatchKey(row.order_name || row.shopify_order_name), trace);
    addSettlementTrace(traceByKey, normalizeMatchKey(row.guide_number), trace);
  }

  return traceByKey;
}

function addSettlementTrace(
  traceByKey: Map<string, SettlementTrace[]>,
  key: string,
  trace: SettlementTrace
) {
  if (!key) return;
  const existing = traceByKey.get(key) ?? [];
  if (
    existing.some(
      (item) =>
        item.file_name === trace.file_name &&
        item.amount_to_liquidate === trace.amount_to_liquidate &&
        item.settlement_status === trace.settlement_status
    )
  ) {
    return;
  }
  traceByKey.set(key, [...existing, trace]);
}

function getSettlementTracesForLogisticsRow(
  row: OrderMatchKeySource & Pick<TrackableOrderRow, "guide_number">,
  settlementTraceByKey: Map<string, SettlementTrace[]>
): SettlementTrace[] {
  const seen = new Set<string>();
  const traces: SettlementTrace[] = [];
  const keys = [
    ...getOrderMatchKeys(row),
    normalizeMatchKey(row.guide_number),
  ];

  for (const key of uniqueKeys(keys)) {
    for (const trace of settlementTraceByKey.get(key) ?? []) {
      const traceKey = `${trace.file_name}|${trace.amount_to_liquidate}|${trace.settlement_status}`;
      if (seen.has(traceKey)) continue;
      seen.add(traceKey);
      traces.push(trace);
    }
  }

  return traces;
}

function getDoubleSettlementAnomalies(
  settlementTraceByKey: Map<string, SettlementTrace[]>
): DoubleSettlementAnomaly[] {
  const anomalies: DoubleSettlementAnomaly[] = [];

  for (const [key, traces] of Array.from(settlementTraceByKey.entries())) {
    const uniqueTraces = uniqueSettlementTraces(traces);
    if (uniqueTraces.length < 2) continue;

    anomalies.push({
      key,
      kind: /^\d{6,}$/.test(key) ? "guide" : "order",
      traces: uniqueTraces,
    });
  }

  return anomalies
    .sort((a, b) => b.traces.length - a.traces.length || a.key.localeCompare(b.key))
    .slice(0, 250);
}

function uniqueSettlementTraces(traces: SettlementTrace[]): SettlementTrace[] {
  const seen = new Set<string>();
  const unique: SettlementTrace[] = [];
  for (const trace of traces) {
    const key = `${trace.file_name}|${trace.amount_to_liquidate}|${trace.settlement_status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trace);
  }
  return unique;
}

function normalizeMatchKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "");
}

function normalizeSearchText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function extractExternalOrderCodesFromText(value: string): string[] {
  const codes = new Set<string>();
  const patterns = [
    /\bpedido\s*#?\s*([0-9]{3,})\b/gi,
    /\border\s*#?\s*([0-9]{3,})\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    const text = String(value || "");
    while ((match = pattern.exec(text)) !== null) {
      const code = normalizeSearchText(match[1] ?? "").replace(/[^0-9]/g, "");
      if (code) codes.add(code);
    }
  }
  return Array.from(codes);
}

function getShopifyNoteText(order: Pick<ShopifyOrderSummary, "note" | "note_attributes">): string {
  const attributeText = (order.note_attributes ?? [])
    .flatMap((attribute) => [attribute.name ?? "", attribute.value ?? ""])
    .filter(Boolean)
    .join("\n");
  return [order.note ?? "", attributeText].filter(Boolean).join("\n");
}

function buildShopifyNoteAliasRows(orders: ShopifyOrderSummary[]): ShopifyNoteAliasRow[] {
  return orders
    .flatMap((order) => {
      const note = getShopifyNoteText(order).trim();
      if (!note) return [];

      const externalCodes = extractExternalOrderCodesFromText(note);
      if (!externalCodes.length) {
        return [{
          row_key: `${order.id}-note`,
          shopify_order_name: order.name,
          note_order_number: "",
          note,
          created_at: order.created_at,
        }];
      }

      return externalCodes.map((code, index) => ({
        row_key: `${order.id}-${code}-${index}`,
        shopify_order_name: order.name,
        note_order_number: code,
        note,
        created_at: order.created_at,
      }));
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function matchesShopifyNoteAliasSearch(row: ShopifyNoteAliasRow, query: string): boolean {
  const rawQuery = query.trim().toLowerCase();
  const compactQuery = normalizeSearchText(query);
  if (!rawQuery && !compactQuery) return true;

  const values = [
    row.shopify_order_name,
    row.note_order_number,
    row.note,
  ];

  return values.some((value) => {
    const text = String(value || "").toLowerCase();
    const compactText = normalizeSearchText(String(value || ""));
    return Boolean(
      (rawQuery && text.includes(rawQuery)) ||
      (compactQuery && compactText.includes(compactQuery))
    );
  });
}

function matchesOrderSearch(row: TrackableOrderRow, query: string): boolean {
  const rawQuery = query.trim().toLowerCase();
  const compactQuery = normalizeSearchText(query);
  if (!rawQuery && !compactQuery) return true;

  const values = [
    row.order_name,
    row.shopify_order_name,
    row.shopify_order_number ? String(row.shopify_order_number) : "",
    row.shopify_order_number ? `#MCRC${row.shopify_order_number}` : "",
    row.guide_number,
    row.customer_name,
    row.shopify_note ?? "",
    ...(row.package_items ?? []).flatMap((item) => [item.sku ?? "", item.title]),
  ];

  return values.some((value) => {
    const text = String(value || "").toLowerCase();
    const compactText = normalizeSearchText(String(value || ""));
    return Boolean(
      (rawQuery && text.includes(rawQuery)) ||
      (compactQuery && compactText.includes(compactQuery))
    );
  });
}

function matchesOrderPeriod(
  row: TrackableOrderRow,
  mode: OrderPeriodMode,
  month: string,
  startDate: string,
  endDate: string
): boolean {
  if (mode === "all") return true;
  const orderDate = getOrderDateKey(row);
  if (!orderDate) return false;

  if (mode === "month") {
    if (!month) return true;
    return getMonthKey(orderDate) === month;
  }

  if (startDate && orderDate < startDate) return false;
  if (endDate && orderDate > endDate) return false;
  return true;
}

function getOrderDateKey(row: Pick<TrackableOrderRow, "shopify_created_at">): string {
  return row.shopify_created_at ? row.shopify_created_at.slice(0, 10) : "";
}

function getEffectiveTrackingStatus(
  row: Pick<TrackableOrderRow, "source" | "boxful_status" | "internal_status" | "shopify_cancelled_at" | "shopify_financial_status">,
  traces: SettlementTrace[]
): string {
  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  const boxfulStatus = inferTrackingStatusFromText(row.boxful_status);
  if (isFinalTrackingStatus(boxfulStatus)) return boxfulStatus;

  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

  const hasOperationalMovement = row.source !== "shopify" || traces.length > 0;
  if (isShopifyCancelled(row) && !hasOperationalMovement) return "annulled";

  return "pending";
}

function inferTrackingStatusFromText(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("no entregado") || lower.includes("devuelto")) return "not_delivered";
  if (lower.includes("entregado")) return "delivered";
  return "pending";
}

function getTrackingFilterFromStatus(status: string): Exclude<OrderTrackingFilter, "all"> {
  if (status === "annulled") return "annulled";
  if (status === "delivered") return "delivered";
  if (status === "not_delivered" || status === "returned") return "not_delivered";
  return "pending";
}

function getTrackingStatusLabel(
  row: Pick<TrackableOrderRow, "internal_status" | "boxful_status">,
  traces: SettlementTrace[],
  status: string
): string {
  if (status === "annulled") return "Anulado";
  if (isFinalTrackingStatus(row.internal_status)) {
    return status === "not_delivered" || status === "returned" ? "No entregado" : row.boxful_status || "Entregado";
  }

  const settlementTrace = traces.find((trace) => trace.internal_status === status);
  if (settlementTrace?.settlement_status) return settlementTrace.settlement_status;
  if (status === "delivered") return "Entregado";
  if (status === "not_delivered" || status === "returned") return "No entregado";
  return "Pendiente";
}

function isFinalTrackingStatus(status: string): boolean {
  return status === "delivered" || status === "not_delivered" || status === "returned";
}

function isShopifyCancelled(
  row: Pick<TrackableOrderRow, "shopify_cancelled_at" | "shopify_financial_status"> | Pick<OrderProfitabilityRow, "shopify_cancelled_at" | "shopify_financial_status">
): boolean {
  return Boolean(row.shopify_cancelled_at || row.shopify_financial_status === "voided");
}
