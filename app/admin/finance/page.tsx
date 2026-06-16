"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { normalizeSearchText } from "@/lib/order-matching";
import {
  type FinanceControlCenter,
  type FinancialAnomaly,
  type MonthlyCloseRow,
  type OrderProfitabilityRow,
  type ProductAnalysisRow,
  type ShopifyNoteAliasRow,
} from "@/lib/finance-orders";
import { reconcileMoovin, type MoovinDiscrepancy } from "@/lib/moovin-reconcile";
import type {
  BoxfulFileControl,
  BusinessExpense,
  ExpenseType,
  FinanceClaim,
  ForzaTrackingRow,
  LogisticsImport,
  LogisticsRow,
  MoovinTrackingRow,
  PayrollStaff,
  ProductCost,
  ProductCostVersion,
  ProfitabilitySummary,
  SettlementImport,
  SettlementRow,
} from "@/lib/finance-types";
import {
  DEFAULT_FINANCE_STORE_CODE,
  FINANCE_STORES,
  getFinanceStore,
  type FinanceStoreCode,
  type FinanceStorePublic,
} from "@/lib/store-config";
import { sanitizeExternalError } from "@/lib/api-errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "orders" | "products" | "notes" | "settlements" | "expenses" | "monthly" | "files";

// Carril 2 (ultimo tab): TODOS los tabs cargan server-side. Pedidos/KPIs, Productos,
// Notas, Cierre y ahora Liquidaciones traen sus datos ya calculados desde sus
// endpoints, asi que el navegador ya NO ensambla el snapshot pesado (historico
// Shopify ~11k + logistica completa) para ningun tab.

type OrderTrackingFilter = "all" | "pending" | "en_route" | "en_route_retry" | "incident" | "annulled" | "delivered" | "not_delivered";
type ProductAnalysisFilter =
  | "all"
  | "no_cost"
  | "unknown_product"
  | "dispatched"
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

interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  last_name?: string;
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
  tracking_number?: string;
  tracking_company?: string;
  created_at: string;
  line_items: ProductLineItem[];
}

interface TrackableOrderRow {
  id?: number;
  row_key: string;
  source: "boxful" | "shopify" | "liquidacion";
  guide_number: string;
  courier?: string;
  moovin_group?: string;
  moovin_incidents?: number;
  forza_group?: string;
  forza_incidents?: number;
  order_name: string;
  customer_name: string;
  last_name?: string;
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

type ProductCostSaveInput = {
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  effective_from?: string;
};

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

const EMPTY_FINANCE_CONTROL_CENTER: FinanceControlCenter = {
  orders: [],
  anomalies: [],
  cash_received: 0,
  cash_pending: 0,
  contribution_margin: 0,
  missing_cost_count: 0,
};

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
const PAYROLL_PAYMENT_TYPES = [
  "Sueldo mensual",
  "Sueldo quincena",
  "Horas extras",
  "CTS",
  "Gratificacion",
] as const;
type ExpenseOriginalCurrency = (typeof EXPENSE_ORIGINAL_CURRENCIES)[number];

const ORDER_TRACKING_FILTERS: Array<{ value: OrderTrackingFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "en_route", label: "En ruta" },
  { value: "en_route_retry", label: "Reintento" },
  { value: "incident", label: "Incidencia" },
  { value: "annulled", label: "Anulados" },
  { value: "delivered", label: "Entregados" },
  { value: "not_delivered", label: "No entregados" },
];

// Punto de color por estado de seguimiento, alineado con los KPIs de arriba.
const TRACKING_DOT_COLORS: Record<OrderTrackingFilter, string> = {
  all: "bg-muted-foreground/40",
  pending: "bg-slate-400",
  en_route: "bg-cyan-400",
  en_route_retry: "bg-orange-500",
  incident: "bg-amber-400",
  annulled: "bg-zinc-500",
  delivered: "bg-emerald-400",
  not_delivered: "bg-red-400",
};

const PRODUCT_ANALYSIS_FILTERS: Array<{ value: ProductAnalysisFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "no_cost", label: "Sin costo" },
  { value: "unknown_product", label: "Sin producto" },
  { value: "dispatched", label: "Despachados" },
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

// --- Tabla de pedidos server-side (Carril 2 inc.2) -------------------------
// Las filas que devuelve /api/finance/orders ya traen las trazas de liquidacion
// resueltas server-side, asi la tabla no necesita el settlementTraceByKey en
// memoria.
type OrderRowWithTraces = TrackableOrderRow & { traces: SettlementTrace[] };

const ORDERS_PAGE_SIZE = 100;

const EMPTY_TRACKING_COUNTS: Record<OrderTrackingFilter, number> = {
  all: 0,
  pending: 0,
  en_route: 0,
  en_route_retry: 0,
  incident: 0,
  annulled: 0,
  delivered: 0,
  not_delivered: 0,
};

const EMPTY_SETTLEMENT_COUNTS: Record<OrderSettlementFilter, number> = {
  all: 0,
  settled: 0,
  unsettled: 0,
  to_claim: 0,
  duplicate: 0,
};

// Meses disponibles para el selector, derivados del rango de cobertura Shopify
// (oldest..newest) en vez de recorrer el snapshot completo. Devuelve YYYY-MM
// desc.
function buildMonthOptionsFromCoverage(
  coverage: { oldest: string | null; newest: string | null } | null
): string[] {
  const oldest = coverage?.oldest ? coverage.oldest.slice(0, 7) : "";
  const newest = coverage?.newest ? coverage.newest.slice(0, 7) : "";
  const end = newest || new Date().toISOString().slice(0, 7);
  const start = oldest || end;
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
  const months: string[] = [];
  let [year, month] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  // Tope de seguridad por si las fechas vienen invertidas/corruptas.
  let guard = 0;
  while ((year < endYear || (year === endYear && month <= endMonth)) && guard < 600) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    guard += 1;
  }
  return months.reverse();
}

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

const FINANCE_SHOPIFY_CREATED_AT_MIN_BY_STORE: Record<FinanceStoreCode, string> = {
  "mireva-cr": "2026-01-01T00:00:00-06:00",
  "mireva-hn": "2025-12-09T00:00:00-06:00",
};
// Solo la primera pagina (Shopify base + logistica): el resto de tabs cargan
// server-side, asi que ya NO se pagina hacia el snapshot completo en el navegador.
const FINANCE_SHOPIFY_SYNC_INITIAL_PAGE_SIZE = 250;
// Ventana de "pedidos actualizados recientemente" leida en vivo de Shopify.
const FINANCE_SHOPIFY_RECENT_UPDATES_DAYS = 7;
const FINANCE_SHOPIFY_NOTES_LOOKBACK_DAYS = 90;
const FINANCE_LOGISTICS_INITIAL_PAGE_SIZE = 500;
const FINANCE_FAST_FETCH_TIMEOUT_MS = 20000;
const FINANCE_BACKGROUND_FETCH_TIMEOUT_MS = 18000;

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [kpiRange, setKpiRange] = useState<KpiRange>("30d");
  // KPIs operativos: ahora se calculan server-side (Carril 2 inc.2) en
  // /api/finance/kpis para no depender de cargar las ~11k filas en el navegador.
  const [kpiCards, setKpiCards] = useState<KpiCardVM[]>([]);
  const [kpiLoading, setKpiLoading] = useState(true);
  // Carril 2 inc.2: la barra de Alertas se alimenta de conteos server-side
  // (period=all) en vez del snapshot en memoria, que ya no se carga en el tab
  // Pedidos. Pedimos /api/finance/orders con pageSize=1 (el dataset esta cacheado
  // 30s en el server, asi que es barato) solo para leer tracking/settlement counts.
  const [alertCounts, setAlertCounts] = useState<{
    trackingCounts: Record<OrderTrackingFilter, number>;
    settlementCounts: Record<OrderSettlementFilter, number>;
  }>({ trackingCounts: EMPTY_TRACKING_COUNTS, settlementCounts: EMPTY_SETTLEMENT_COUNTS });
  // Carril 2 inc.2 (tabs restantes): Productos, Cierre mensual y Notas cargan
  // server-side. Cada uno trae sus filas ya calculadas desde su endpoint, asi que
  // estos tabs ya no dependen del snapshot pesado (~11k pedidos) en el navegador.
  const [productAnalysisRows, setProductAnalysisRows] = useState<ProductAnalysisRow[]>([]);
  const [productAnalysisLoading, setProductAnalysisLoading] = useState(false);
  const [productAnalysisError, setProductAnalysisError] = useState("");
  const [monthlyCloseRows, setMonthlyCloseRows] = useState<MonthlyCloseRow[]>([]);
  const [financeControl, setFinanceControl] = useState<FinanceControlCenter>(EMPTY_FINANCE_CONTROL_CENTER);
  const [monthlyCloseLoading, setMonthlyCloseLoading] = useState(false);
  const [monthlyCloseError, setMonthlyCloseError] = useState("");
  const [noteAliasRows, setNoteAliasRows] = useState<ShopifyNoteAliasRow[]>([]);
  const [noteShopifyOrderCount, setNoteShopifyOrderCount] = useState(0);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [selectedStoreCode, setSelectedStoreCode] = useState<FinanceStoreCode>(
    DEFAULT_FINANCE_STORE_CODE
  );
  const [imports, setImports] = useState<SettlementImport[]>([]);
  const [logisticsImports, setLogisticsImports] = useState<LogisticsImport[]>([]);
  // shopifyOrders se mantiene SOLO como contador base para el tab Pedidos
  // (shopifyOrderCount) y se alimenta de la primera pagina + pedidos recientes;
  // ya NO se carga el historico completo (~11k) en el navegador.
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
  const [moovinByPackage, setMoovinByPackage] = useState<Map<string, MoovinTrackingRow>>(new Map());
  const [forzaByGuide, setForzaByGuide] = useState<Map<string, ForzaTrackingRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingLogistics, setImportingLogistics] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [rematching, setRematching] = useState(false);
  const [rematchMessage, setRematchMessage] = useState("");
  const [expenseForm, setExpenseForm] = useState(emptyExpense);
  const refreshRunRef = useRef(0);
  const selectedStore = useMemo(() => getFinanceStore(selectedStoreCode), [selectedStoreCode]);

  const latestLogisticsImport = logisticsImports[0];
  const claimByAnomalyKey = useMemo(
    () => new Map(claims.map((claim) => [claim.anomaly_key, claim])),
    [claims]
  );

  async function refresh() {
    const refreshRun = refreshRunRef.current + 1;
    refreshRunRef.current = refreshRun;
    const isCurrentRun = () => refreshRunRef.current === refreshRun;
    const activeStoreCode = selectedStore.code;
    setLoading(true);
    setError("");
    setImports([]);
    setLogisticsImports([]);
    setShopifyOrders([]);
    setShopifyCoverage(null);
    try {
      const safeJson = async (input: Promise<Response>, label: string): Promise<Record<string, any>> => {
        try {
          return await readApiJson(await input);
        } catch (err) {
          const message = err instanceof Error ? err.message : "No se pudo leer la respuesta del servidor";
          return { error: `${label}: ${message}` };
        }
      };
      const reportCriticalError = (maybeError: unknown) => {
        if (maybeError && isCurrentRun()) setError((current) => current || String(maybeError));
      };
      const loadJson = (
        label: string,
        request: () => Promise<Response>,
        apply: (json: Record<string, any>) => void,
        options: { critical?: boolean; delayMs?: number } = {}
      ) => {
        const task = (async () => {
          if (options.delayMs) await delay(options.delayMs);
          const json = await safeJson(request(), label);
          if (!isCurrentRun()) return;
          apply(json);
          if (options.critical) reportCriticalError(json.error);
        })();
        return task;
      };

      // Cada fuente carga de forma independiente: una llamada lenta no puede
      // bloquear el primer render del dashboard.
      const recentUpdatesMin = new Date(
        Date.now() - FINANCE_SHOPIFY_RECENT_UPDATES_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      // Solo la primera pagina Shopify + coverage (agregado barato): el total real
      // y el rango de fechas para el tab Pedidos. Carril 2 (ultimo tab): ya NO se
      // continua hacia el historico completo (~11k filas) en el navegador.
      const firstShopifyPageTask = loadJson(
        "pedidos Shopify base",
        () =>
          fetchWithTimeout(
            // coverage=1 (agregado barato: total + rango de fechas) para que el
            // tab Pedidos tenga el total real y los meses del selector sin cargar
            // las ~11k filas (Carril 2 inc.2).
            withStore(
              `/api/finance/shopify-sync?limit=${FINANCE_SHOPIFY_SYNC_INITIAL_PAGE_SIZE}&offset=0&coverage=1`,
              activeStoreCode
            ),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
          ),
        (json) => {
          const persistedShopifyOrders = Array.isArray(json.orders)
            ? (json.orders as Array<Record<string, unknown>>).map(persistedOrderToSummary)
            : [];
          if (persistedShopifyOrders.length) {
            setShopifyOrders((current) => mergeShopifyOrderSummaries(current, persistedShopifyOrders));
          }
          const coverage =
            (json.coverage as { count: number; oldest: string | null; newest: string | null } | null) ?? null;
          if (coverage) {
            setShopifyCoverage(coverage);
          }
        },
        { delayMs: 0 }
      );

      // Solo la primera pagina de logistica: alimenta los imports de logistica
      // (badge del tab Pedidos). Carril 2 (ultimo tab): ya NO se descarga la
      // logistica completa en el navegador (las alertas de cobro las calcula
      // /api/finance/settlements-view).
      const logisticsTask = (async () => {
        await delay(250);
        if (!isCurrentRun()) return;
        const logisticsJson = await safeJson(
          fetchWithTimeout(
            withStore(
              `/api/finance/logistics?limit=${FINANCE_LOGISTICS_INITIAL_PAGE_SIZE}&offset=0`,
              activeStoreCode
            ),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
          ),
          "logistica Boxful"
        );
        if (!isCurrentRun()) return;
        setLogisticsImports(logisticsJson.imports ?? []);
      })();

      loadJson(
        "costos SKU",
        () =>
          fetchWithTimeout(
            withStore("/api/finance/product-costs", activeStoreCode),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
          ),
        (json) => {
          setCosts(json.costs ?? []);
          setCostVersions(Array.isArray(json.versions) ? json.versions as ProductCostVersion[] : []);
        },
        { delayMs: 150 }
      );
      loadJson(
        "gastos",
        () =>
          fetchWithTimeout(
            withStore("/api/finance/expenses", activeStoreCode),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
        ),
        (json) => setExpenses(json.expenses ?? []),
        { delayMs: 300 }
      );
      loadJson(
        "resumen financiero",
        () =>
          fetchWithTimeout(
            withStore("/api/finance/summary", activeStoreCode),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
        ),
        (json) => setSummary(json.summary ?? null),
        { delayMs: 600 }
      );
      loadJson(
        "pedidos recientes Shopify",
        () =>
          fetchWithTimeout(
            withStore(
              `/api/shopify/orders?status=any&all=1&max_pages=4&updated_at_min=${encodeURIComponent(recentUpdatesMin)}`,
              activeStoreCode
            ),
            { cache: "no-store" },
            FINANCE_BACKGROUND_FETCH_TIMEOUT_MS
          ),
        (json) => {
          const recentShopifyOrders = Array.isArray(json.orders) ? (json.orders as ShopifyOrderSummary[]) : [];
          if (recentShopifyOrders.length) {
            setShopifyOrders((current) => mergeShopifyOrderSummaries(current, recentShopifyOrders));
          }
        },
        { delayMs: 400 }
      );
      loadJson(
        "notas Shopify",
        () =>
          fetchWithTimeout(
            withStore(
              `/api/shopify/note-orders?created_at_min=${encodeURIComponent(getShopifyNotesCreatedAtMin(activeStoreCode))}&max_pages=12`,
              activeStoreCode
            ),
            { cache: "no-store" },
            FINANCE_BACKGROUND_FETCH_TIMEOUT_MS
          ),
        (json) => {
          const noteShopifyOrders = Array.isArray(json.orders) ? (json.orders as ShopifyOrderSummary[]) : [];
          if (noteShopifyOrders.length) {
            setShopifyOrders((current) => mergeShopifyOrderSummaries(current, noteShopifyOrders));
          }
        },
        { delayMs: 800 }
      );
      loadJson(
        "reclamos",
        () =>
          fetchWithTimeout(
            withStore("/api/finance/claims", activeStoreCode),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
        ),
        (json) => setClaims(Array.isArray(json.claims) ? json.claims as FinanceClaim[] : []),
        { delayMs: 200 }
      );
      loadJson(
        "archivos Boxful",
        () =>
          fetchWithTimeout(
            withStore("/api/finance/boxful-files", activeStoreCode),
            { cache: "no-store" },
            FINANCE_FAST_FETCH_TIMEOUT_MS
        ),
        (json) => setBoxfulFiles(Array.isArray(json.files) ? json.files as BoxfulFileControl[] : []),
        { delayMs: 250 }
      );

      void Promise.race([
        Promise.allSettled([firstShopifyPageTask, logisticsTask]),
        delay(12000),
      ]).finally(() => {
        if (isCurrentRun()) setLoading(false);
      });

      // Solo los imports de liquidaciones (lista pequena): alimentan el selector de
      // archivos y los badges del tab Liquidaciones. Las filas enriquecidas, las
      // alertas de cobro y las anomalias las trae /api/finance/settlements-view
      // (Carril 2 — tab Liquidaciones), asi que aqui ya NO se guardan las filas.
      void (async () => {
        await delay(1200);
        if (!isCurrentRun()) return;
        const settlementsJson = await safeJson(
          fetchWithTimeout(
            withStore("/api/finance/settlements", activeStoreCode),
            { cache: "no-store" },
            FINANCE_BACKGROUND_FETCH_TIMEOUT_MS
          ),
          "liquidaciones"
        );
        if (!isCurrentRun()) return;
        setImports(settlementsJson.imports ?? []);
      })();
    } catch (err) {
      if (isCurrentRun()) setError(err instanceof Error ? err.message : "Error cargando gestion financiera");
    } finally {
      if (isCurrentRun()) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    reloadCarrierTracking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreCode]);

  useEffect(() => {
    if (tab !== "products" || shopifyProducts.length || productsLoading) return;
    loadShopifyProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedStoreCode]);

  async function loadShopifyProducts() {
    const activeStoreCode = selectedStore.code;
    setProductsLoading(true);
    setProductsError("");
    try {
      const res = await fetch(withStore("/api/shopify/products", activeStoreCode), {
        cache: "no-store",
      });
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
    data.set("store", selectedStore.code);
    setImporting(true);
    setError("");
    try {
      const res = await fetch(withStore("/api/finance/settlements", selectedStore.code), {
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
    const res = await fetch(withStore(`/api/finance/settlements?id=${id}`, selectedStore.code), {
      method: "DELETE",
    });
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
    data.set("store", selectedStore.code);
    setImportingLogistics(true);
    setError("");
    try {
      const res = await fetch(withStore("/api/finance/logistics", selectedStore.code), {
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
    const res = await fetch(withStore("/api/finance/product-costs", selectedStore.code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, store: selectedStore.code }),
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
        store_id: savedCost.store_id,
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
    // El refresco del resumen es secundario: si falla (endpoint pesado o
    // migracion pendiente) no debe reportar el guardado como fallido.
    try {
      const summaryRes = await fetch(withStore("/api/finance/summary", selectedStore.code), {
        cache: "no-store",
      });
      const summaryJson = await readApiJson(summaryRes);
      if (summaryRes.ok) setSummary(summaryJson.summary ?? null);
    } catch {
      // Se recalcula en la proxima carga.
    }
  }

  async function reloadCosts() {
    const res = await fetch(withStore("/api/finance/product-costs", selectedStore.code), {
      cache: "no-store",
    });
    const json = await readApiJson(res);
    setCosts(json.costs ?? []);
    setCostVersions(Array.isArray(json.versions) ? (json.versions as ProductCostVersion[]) : []);
  }

  async function reloadCarrierTracking(storeCode = selectedStore.code) {
    const store = getFinanceStore(storeCode);
    if (store.logisticsProvider === "moovin") {
      setForzaByGuide(new Map());
      await reloadMoovin(storeCode);
      return;
    }
    setMoovinByPackage(new Map());
    await reloadForza(storeCode);
  }

  async function reloadMoovin(storeCode = selectedStore.code) {
    try {
      const json = await readApiJson(
        await fetch(withStore("/api/finance/moovin-sync", storeCode), { cache: "no-store" })
      );
      if (Array.isArray(json.rows)) {
        setMoovinByPackage(new Map((json.rows as MoovinTrackingRow[]).map((r) => [r.id_package, r])));
      }
    } catch {
      // sin cache; el estado cae al de Boxful/sistema.
    }
  }

  async function reloadForza(storeCode = selectedStore.code) {
    try {
      const json = await readApiJson(
        await fetch(withStore("/api/finance/forza-sync", storeCode), { cache: "no-store" })
      );
      if (Array.isArray(json.rows)) {
        setForzaByGuide(buildForzaTrackingMap(json.rows as ForzaTrackingRow[]));
      }
    } catch {
      // sin cache; el estado cae a guia/Boxful/sistema.
    }
  }

  async function rematchImports() {
    setRematching(true);
    setRematchMessage("Re-emparejando con la base de Shopify...");
    setError("");
    try {
      const res = await fetch(withStore("/api/finance/rematch", selectedStore.code), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: selectedStore.code }),
      });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudo re-emparejar");
      const logistics = json.logistics ?? { matched: 0, total: 0 };
      const settlements = json.settlements ?? { matched: 0, total: 0 };
      setRematchMessage(
        `Re-emparejado listo: Boxful ${logistics.matched}/${logistics.total} con match` +
          (settlements.total
            ? `, liquidaciones ${settlements.matched}/${settlements.total} con match`
            : "") +
          "."
      );
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo re-emparejar";
      setError(message);
      setRematchMessage(message);
    } finally {
      setRematching(false);
    }
  }

  async function syncShopifyHistory() {
    setSyncingShopify(true);
    setSyncMessage("Sincronizando Shopify...");
    setError("");
    let totalSynced = 0;
    const activeStoreCode = selectedStore.code;
    const shopifyCreatedAtMin = getShopifyCreatedAtMin(activeStoreCode);

    // Fase 1: pedidos recientes (de lo mas nuevo hacia atras con cursor).
    try {
      let nextUrl: string | null = null;
      for (let batch = 0; batch < 40; batch++) {
        const res = await fetch(withStore("/api/finance/shopify-sync", activeStoreCode), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: activeStoreCode,
            created_at_min: shopifyCreatedAtMin,
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
        const res = await fetch(withStore("/api/finance/shopify-sync", activeStoreCode), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: activeStoreCode,
            created_at_min: shopifyCreatedAtMin,
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
    const res = await fetch(withStore("/api/finance/claims", selectedStore.code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store: selectedStore.code,
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

    const res = await fetch(withStore("/api/finance/expenses", selectedStore.code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...expensePayload.expense, store: selectedStore.code }),
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
    await fetch(withStore(`/api/finance/expenses?id=${id}`, selectedStore.code), { method: "DELETE" });
    await refresh();
  }

  // Carril 2 inc.2: la barra de Alertas ya NO se calcula sobre visibleOrderRows
  // (que en el tab Pedidos queda vacio porque el snapshot pesado esta diferido).
  // Sus conteos vienen del estado `alertCounts`, alimentado por el efecto
  // server-side de mas abajo (/api/finance/orders?period=all).

  // La ventana (etiqueta de rango / comparativo / "tasas en maduracion") es
  // pura y barata: se calcula en cliente. Las tarjetas de KPIs vienen del
  // endpoint server-side (efecto de abajo). Mientras no hay datos, mostramos las
  // 7 tarjetas en cero para conservar el layout (OperationalKpiCard pinta "...").
  const operationalKpis = useMemo(
    () => ({
      win: getKpiWindows(kpiRange, new Date()),
      cards: kpiCards.length ? kpiCards : buildOperationalKpiCards(EMPTY_OP_METRICS, null),
    }),
    [kpiRange, kpiCards]
  );

  // Fetch de KPIs server-side: current + previous por tienda y periodo. Reemplaza
  // el calculo en memoria sobre visibleOrderRows (Carril 2 inc.2).
  useEffect(() => {
    const controller = new AbortController();
    setKpiLoading(true);
    (async () => {
      try {
        const res = await fetch(
          withStore(`/api/finance/kpis?period=${kpiRange}`, selectedStoreCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudieron calcular los KPIs");
        const current = json.current as OpMetrics | undefined;
        const previous = (json.previous as OpMetrics | null | undefined) ?? null;
        if (!current) throw new Error("Respuesta de KPIs invalida");
        setKpiCards(buildOperationalKpiCards(current, previous));
      } catch (err) {
        if (controller.signal.aborted) return;
        // No bloqueamos la pantalla por los KPIs; quedan vacios y la tabla sigue.
        setKpiCards([]);
      } finally {
        if (!controller.signal.aborted) setKpiLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedStoreCode, kpiRange]);

  // Conteos para la barra de Alertas (Carril 2 inc.2). period=all para que las
  // alertas reflejen todo el historico, no solo la ventana del selector. Una
  // sola request barata (pageSize=1; el server cachea el dataset 30s) por tienda
  // o cuando se actualiza. No reintroduce el snapshot pesado en el tab Pedidos.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/orders?period=all&pageSize=1", selectedStoreCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar las alertas");
        setAlertCounts({
          trackingCounts: (json.trackingCounts as Record<OrderTrackingFilter, number>) ?? EMPTY_TRACKING_COUNTS,
          settlementCounts: (json.settlementCounts as Record<OrderSettlementFilter, number>) ?? EMPTY_SETTLEMENT_COUNTS,
        });
      } catch {
        if (controller.signal.aborted) return;
        // Las alertas son informativas; si fallan dejamos los conteos en cero y
        // la tabla de pedidos sigue funcionando.
        setAlertCounts({ trackingCounts: EMPTY_TRACKING_COUNTS, settlementCounts: EMPTY_SETTLEMENT_COUNTS });
      }
    })();
    return () => controller.abort();
  }, [selectedStoreCode]);

  // Productos server-side (Carril 2 inc.2): /api/finance/product-analysis devuelve
  // las filas ya agregadas (buildFinanceControlCenter + buildProductAnalysisRows en
  // el server). Solo se pide al entrar al tab o al cambiar de tienda.
  useEffect(() => {
    if (tab !== "products") return;
    const controller = new AbortController();
    setProductAnalysisLoading(true);
    setProductAnalysisError("");
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/product-analysis", selectedStoreCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo analizar productos");
        setProductAnalysisRows(Array.isArray(json.rows) ? (json.rows as ProductAnalysisRow[]) : []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setProductAnalysisRows([]);
        setProductAnalysisError(err instanceof Error ? err.message : "No se pudo analizar productos");
      } finally {
        if (!controller.signal.aborted) setProductAnalysisLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tab, selectedStoreCode]);

  // Cierre mensual server-side (Carril 2 inc.2): /api/finance/monthly-close devuelve
  // las filas del cierre + el centro de control (financeControl) ya calculados.
  useEffect(() => {
    if (tab !== "monthly") return;
    const controller = new AbortController();
    setMonthlyCloseLoading(true);
    setMonthlyCloseError("");
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/monthly-close", selectedStoreCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo calcular el cierre mensual");
        setMonthlyCloseRows(Array.isArray(json.rows) ? (json.rows as MonthlyCloseRow[]) : []);
        setFinanceControl((json.control as FinanceControlCenter) ?? EMPTY_FINANCE_CONTROL_CENTER);
      } catch (err) {
        if (controller.signal.aborted) return;
        setMonthlyCloseRows([]);
        setFinanceControl(EMPTY_FINANCE_CONTROL_CENTER);
        setMonthlyCloseError(err instanceof Error ? err.message : "No se pudo calcular el cierre mensual");
      } finally {
        if (!controller.signal.aborted) setMonthlyCloseLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tab, selectedStoreCode]);

  // Notas Shopify server-side (Carril 2 inc.2): /api/finance/notes devuelve los
  // alias (buildShopifyNoteAliasRows). El cliente hace la busqueda de texto y el
  // filtro "solo con codigo" en memoria sobre esta lista pequena.
  useEffect(() => {
    if (tab !== "notes") return;
    const controller = new AbortController();
    setNotesLoading(true);
    setNotesError("");
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/notes", selectedStoreCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar las notas Shopify");
        setNoteAliasRows(Array.isArray(json.rows) ? (json.rows as ShopifyNoteAliasRow[]) : []);
        setNoteShopifyOrderCount(Number(json.shopifyOrderCount ?? 0));
      } catch (err) {
        if (controller.signal.aborted) return;
        setNoteAliasRows([]);
        setNoteShopifyOrderCount(0);
        setNotesError(err instanceof Error ? err.message : "No se pudieron cargar las notas Shopify");
      } finally {
        if (!controller.signal.aborted) setNotesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [tab, selectedStoreCode]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-card/70 backdrop-blur">
        <div className="container mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:py-4">
          <div className="flex min-w-0 items-center gap-2 sm:flex-1">
            <Link href="/">
              <Button variant="ghost" size="sm" className="shrink-0 px-2">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Dashboard
              </Button>
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-bold sm:text-lg">Gestion de pedidos y rentabilidad</h1>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                Liquidaciones, costos por SKU, gastos y utilidad neta
              </p>
            </div>
          </div>
          <div className="flex items-end gap-2 sm:ml-auto">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-muted-foreground sm:flex-none sm:min-w-[190px]">
              Tienda
              <select
                value={selectedStore.code}
                onChange={(event) => setSelectedStoreCode(event.target.value as FinanceStoreCode)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-primary"
              >
                {FINANCE_STORES.map((store) => (
                  <option key={store.code} value={store.code}>
                    {store.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refresh();
                if (tab === "products") loadShopifyProducts();
              }}
              className="h-9 shrink-0 gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Actualizar</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-4 px-4 py-4 sm:space-y-6 sm:py-6">
        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-200">
            {formatFinancePageError(error)}
          </div>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {KPI_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setKpiRange(option.value)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    kpiRange === option.value
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {operationalKpis.win.rangeLabel} · {operationalKpis.win.compareLabel}
              </span>
              {operationalKpis.win.maturing && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-amber-200">
                  tasas en maduración
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-4 xl:grid-cols-7">
            {operationalKpis.cards.map(({ id, ...card }) => (
              <OperationalKpiCard key={id} loading={kpiLoading} {...card} />
            ))}
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Alertas</span>
            {/* Carril 2 inc.2: alimentado de conteos server-side (period=all) en
                lugar del snapshot en memoria. Reintentos/Incidencias vienen de
                trackingCounts; Por reclamar de settlementCounts.to_claim. */}
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
              <AlertStat label="Reintentos" value={loading ? "..." : formatInt(alertCounts.trackingCounts.en_route_retry)} tone="bad" />
              <AlertStat label="Incidencias" value={loading ? "..." : formatInt(alertCounts.trackingCounts.incident)} tone="bad" />
              <AlertStat label="Por reclamar" value={loading ? "..." : formatInt(alertCounts.settlementCounts.to_claim)} tone="warn" />
              <AlertStat
                label="Anomalías"
                // Equivale al calculo previo en cliente (liquidationAlertRows +
                // doubleSettlementAnomalies): entregados sin liquidar (to_claim) +
                // liquidaciones duplicadas (duplicate).
                value={loading ? "..." : formatInt(alertCounts.settlementCounts.to_claim + alertCounts.settlementCounts.duplicate)}
                tone="warn"
              />
            </div>
          </div>
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

        <>
          {/* El tab Pedidos ya carga server-side (tiene su propio loader); el
              loader por bloques solo aplica a los tabs que dependen del dataset
              en memoria. */}
          {loading && tab !== "orders" && (
            <div className="flex items-center gap-2 border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Cargando vista operativa por bloques...
            </div>
          )}
            {tab === "orders" && (
              <OrdersTab
                selectedStore={selectedStore}
                logisticsImports={logisticsImports}
                latestLogisticsImport={latestLogisticsImport}
                moovinByPackage={moovinByPackage}
                forzaByGuide={forzaByGuide}
                onReloadMoovin={reloadMoovin}
                onReloadForza={reloadForza}
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
                rowsLoading={productAnalysisLoading}
                rowsError={productAnalysisError}
                costs={costs}
                costVersions={costVersions}
                products={shopifyProducts}
                productsLoading={productsLoading}
                productsError={productsError}
                onSaveProductCost={saveProductCost}
                onReloadCosts={reloadCosts}
              />
            )}
            {tab === "notes" && (
              <ShopifyNotesTab
                rows={noteAliasRows}
                shopifyOrderCount={noteShopifyOrderCount}
                loading={notesLoading}
                error={notesError}
              />
            )}
            {tab === "settlements" && (
              <SettlementsTab
                storeCode={selectedStoreCode}
                imports={imports}
                shopifyCoverage={shopifyCoverage}
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
                loading={monthlyCloseLoading}
                error={monthlyCloseError}
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
                rematching={rematching}
                rematchMessage={rematchMessage}
                onRematch={rematchImports}
              />
            )}
        </>
      </main>
    </div>
  );
}

// Capa de fondo comun para los modales: cierra con la tecla ESC y con clic
// fuera del contenido (clic directo sobre el fondo, no sobre los hijos).
function ModalOverlay({
  onClose,
  labelledBy,
  children,
}: {
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  dotClass,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  dotClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {dotClass && <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />}
      {label}
      <span
        className={`min-w-[1.25rem] rounded-full px-1 text-center font-mono text-[10px] leading-4 ${
          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function OrdersTab({
  selectedStore,
  logisticsImports,
  latestLogisticsImport,
  moovinByPackage,
  forzaByGuide,
  onReloadMoovin,
  onReloadForza,
  shopifyOrderCount,
  shopifyCoverage,
  syncingShopify,
  syncMessage,
  onSyncShopify,
  importingLogistics,
  onLogisticsImport,
}: {
  selectedStore: FinanceStorePublic;
  logisticsImports: LogisticsImport[];
  latestLogisticsImport?: LogisticsImport;
  // moovinByPackage/forzaByGuide siguen en cliente: alimentan los botones de
  // tracking en vivo y el estado de courier del export (cargas acotadas, NO las
  // ~11k filas de Shopify).
  moovinByPackage: Map<string, MoovinTrackingRow>;
  forzaByGuide: Map<string, ForzaTrackingRow>;
  onReloadMoovin: () => Promise<void>;
  onReloadForza: () => Promise<void>;
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
  // --- Datos server-side (Carril 2 inc.2) ---------------------------------
  // La tabla de pedidos ya no consume el snapshot completo en memoria: pagina y
  // filtra contra /api/finance/orders. Los conteos de los chips, el total y las
  // guias para los botones de sync vienen en la misma respuesta.
  const [page, setPage] = useState(1);
  // Se incrementa tras un sync de courier para refrescar la tabla (el cache del
  // dataset server-side tiene TTL corto; esto fuerza la relectura).
  const [refreshKey, setRefreshKey] = useState(0);
  const [serverRows, setServerRows] = useState<OrderRowWithTraces[]>([]);
  const [total, setTotal] = useState(0);
  const [periodCount, setPeriodCount] = useState(0);
  const [searchedCount, setSearchedCount] = useState(0);
  const [trackingCounts, setTrackingCounts] = useState<Record<OrderTrackingFilter, number>>(EMPTY_TRACKING_COUNTS);
  const [settlementCounts, setSettlementCounts] = useState<Record<OrderSettlementFilter, number>>(
    EMPTY_SETTLEMENT_COUNTS
  );
  const [enRouteGuides, setEnRouteGuides] = useState<{
    moovin: Array<{ idPackage: string; lastName: string }>;
    forza: Array<{ guide: string }>;
  }>({ moovin: [], forza: [] });
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState("");
  const [exporting, setExporting] = useState(false);
  // Busqueda con debounce (~300ms) para no disparar un fetch por tecla.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Meses disponibles: derivados del rango de cobertura Shopify (oldest..newest)
  // en vez de recorrer las ~11k filas en el navegador.
  const orderMonthOptions = useMemo(
    () => buildMonthOptionsFromCoverage(shopifyCoverage),
    [shopifyCoverage]
  );

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(orderSearch.trim()), 300);
    return () => clearTimeout(handle);
  }, [orderSearch]);

  // Cualquier cambio de filtro vuelve a la primera pagina.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, trackingFilter, settlementFilter, periodMode, selectedOrderMonth, rangeStart, rangeEnd, selectedStore.code]);

  // Query params compartidos por el fetch de la tabla y por el export.
  const buildOrdersQuery = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      params.set("period", periodMode);
      if (periodMode === "month" && selectedOrderMonth) params.set("month", selectedOrderMonth);
      if (periodMode === "range") {
        if (rangeStart) params.set("start", rangeStart);
        if (rangeEnd) params.set("end", rangeEnd);
      }
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (trackingFilter !== "all") params.set("status", trackingFilter);
      if (settlementFilter !== "all") params.set("settlement", settlementFilter);
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
      return params.toString();
    },
    [periodMode, selectedOrderMonth, rangeStart, rangeEnd, debouncedSearch, trackingFilter, settlementFilter]
  );

  useEffect(() => {
    const controller = new AbortController();
    setTableLoading(true);
    setTableError("");
    (async () => {
      try {
        const query = buildOrdersQuery({ page: String(page), pageSize: String(ORDERS_PAGE_SIZE) });
        const res = await fetch(withStore(`/api/finance/orders?${query}`, selectedStore.code), {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar los pedidos");
        setServerRows(Array.isArray(json.rows) ? (json.rows as OrderRowWithTraces[]) : []);
        setTotal(Number(json.total ?? 0));
        setPeriodCount(Number(json.periodCount ?? 0));
        setSearchedCount(Number(json.searchedCount ?? 0));
        setTrackingCounts((json.trackingCounts as Record<OrderTrackingFilter, number>) ?? EMPTY_TRACKING_COUNTS);
        setSettlementCounts((json.settlementCounts as Record<OrderSettlementFilter, number>) ?? EMPTY_SETTLEMENT_COUNTS);
      } catch (err) {
        if (controller.signal.aborted) return;
        setServerRows([]);
        setTotal(0);
        setTableError(err instanceof Error ? err.message : "No se pudieron cargar los pedidos");
      } finally {
        if (!controller.signal.aborted) setTableLoading(false);
      }
    })();
    return () => controller.abort();
  }, [buildOrdersQuery, page, selectedStore.code, refreshKey]);

  // Guias "en ruta" para los botones Moovin/Forza: dependen de la tienda (no de
  // pagina/filtro), asi que se traen una sola vez por tienda con ?guides=1, en
  // vez de viajar en cada fetch de la tabla.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/orders?period=all&pageSize=1&guides=1", selectedStore.code),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) return;
        setEnRouteGuides(
          (json.enRouteGuides as {
            moovin: Array<{ idPackage: string; lastName: string }>;
            forza: Array<{ guide: string }>;
          }) ?? { moovin: [], forza: [] }
        );
      } catch {
        // Los botones de sync no son criticos para la carga inicial.
      }
    })();
    return () => controller.abort();
  }, [selectedStore.code, refreshKey]);

  const [moovinSyncing, setMoovinSyncing] = useState(false);
  const [moovinMessage, setMoovinMessage] = useState("");
  const [forzaSyncing, setForzaSyncing] = useState(false);
  const [forzaMessage, setForzaMessage] = useState("");

  // Guias no terminales para los botones de sync: vienen del endpoint (calculadas
  // sobre el dataset completo server-side), no del snapshot en memoria.
  const enRouteMoovinGuides = enRouteGuides.moovin;
  const enRouteForzaGuides = enRouteGuides.forza;

  async function updateMoovinStatuses() {
    if (!enRouteMoovinGuides.length) return;
    setMoovinSyncing(true);
    setMoovinMessage(`Consultando Moovin: 0/${enRouteMoovinGuides.length}...`);
    const chunkSize = 50;
    let checked = 0;
    let incidents = 0;
    let delivered = 0;
    try {
      for (let i = 0; i < enRouteMoovinGuides.length; i += chunkSize) {
        const chunk = enRouteMoovinGuides.slice(i, i + chunkSize);
        const res = await fetch("/api/finance/moovin-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packages: chunk }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo actualizar Moovin");
        checked += Number(json.checked ?? 0);
        incidents += Number(json.incidents ?? 0);
        delivered += Number(json.delivered ?? 0);
        setMoovinMessage(
          `Consultando Moovin: ${Math.min(i + chunkSize, enRouteMoovinGuides.length)}/${enRouteMoovinGuides.length}...`
        );
      }
      await onReloadMoovin();
      setRefreshKey((key) => key + 1);
      setMoovinMessage(
        `Moovin actualizado: ${checked} consultados, ${delivered} entregados, ${incidents} con incidencia.`
      );
    } catch (err) {
      setMoovinMessage(err instanceof Error ? err.message : "No se pudo actualizar Moovin");
    } finally {
      setMoovinSyncing(false);
    }
  }

  async function updateForzaStatuses() {
    if (!enRouteForzaGuides.length) return;
    setForzaSyncing(true);
    setForzaMessage(`Consultando Forza: 0/${enRouteForzaGuides.length}...`);
    const chunkSize = 60;
    let checked = 0;
    let incidents = 0;
    let delivered = 0;
    try {
      for (let i = 0; i < enRouteForzaGuides.length; i += chunkSize) {
        const chunk = enRouteForzaGuides.slice(i, i + chunkSize);
        const res = await fetch(withStore("/api/finance/forza-sync", selectedStore.code), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: selectedStore.code, guides: chunk }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudo actualizar Forza");
        checked += Number(json.checked ?? 0);
        incidents += Number(json.incidents ?? 0);
        delivered += Number(json.delivered ?? 0);
        setForzaMessage(
          `Consultando Forza: ${Math.min(i + chunkSize, enRouteForzaGuides.length)}/${enRouteForzaGuides.length}...`
        );
      }
      await onReloadForza();
      setRefreshKey((key) => key + 1);
      setForzaMessage(
        `Forza actualizado: ${checked} consultados, ${delivered} entregados, ${incidents} con incidencia.`
      );
    } catch (err) {
      setForzaMessage(err instanceof Error ? err.message : "No se pudo actualizar Forza");
    } finally {
      setForzaSyncing(false);
    }
  }

  // total = filas que pasan TODOS los filtros (lo que antes era filteredRows.length).
  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
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

  // Export: trae TODAS las filas filtradas (all=1, fuera de la vista paginada) y
  // arma el XLSX con el mismo formato de columnas que antes. Las trazas vienen
  // en cada fila; el estado de courier sigue saliendo de los mapas en cliente.
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const query = buildOrdersQuery({ all: "1" });
      const res = await fetch(withStore(`/api/finance/orders?${query}`, selectedStore.code), {
        cache: "no-store",
      });
      const json = await readApiJson(res);
      if (!res.ok) throw new Error(json.error ?? "No se pudo exportar");
      const exportRows = (Array.isArray(json.rows) ? (json.rows as OrderRowWithTraces[]) : []).map((row) => {
        const traces = row.traces ?? [];
        const status = getEffectiveTrackingStatus(row, traces);
        const moovin = row.guide_number ? moovinByPackage.get(row.guide_number) : undefined;
        const forza = row.guide_number ? getForzaTrackingFromMap(forzaByGuide, row.guide_number) : undefined;
        return {
          Orden: row.order_name || row.shopify_order_name,
          Origen: row.source,
          Guia: row.guide_number,
          Transportadora: normalizeOperationalCourier(row.courier, selectedStore, row.guide_number),
          "Estado courier": moovin?.latest_status ?? forza?.latest_status ?? "",
          "Incidencia courier": moovin?.has_incident || forza?.has_incident ? "si" : "",
          Cliente: row.customer_name,
          Apellido: row.last_name ?? "",
          "Estado seguimiento": getTrackingStatusLabel(row, traces, status),
          Shopify: row.match_status === "matched" ? row.shopify_order_name : "sin match",
          Fecha: row.shopify_created_at ? formatDate(row.shopify_created_at) : "",
          "Estado liquidacion": traces.map((t) => t.settlement_status).join(" | ") || "sin liquidacion",
          "A liquidar": traces.length ? sum(traces.map((t) => t.amount_to_liquidate)) : "",
          COD: row.cod_amount,
          Items: (row.package_items ?? []).map((item) => item.title).join("; "),
        };
      });
      await exportXlsx(`pedidos-${new Date().toISOString().slice(0, 10)}.xlsx`, exportRows, "Pedidos");
    } catch (err) {
      setTableError(err instanceof Error ? err.message : "No se pudo exportar");
    } finally {
      setExporting(false);
    }
  }

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
        <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Seguimiento de pedidos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Shopify es la base; Boxful y liquidaciones actualizan seguimiento y cobros.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
            {selectedStore.logisticsProvider === "moovin" && enRouteMoovinGuides.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={moovinSyncing}
                onClick={updateMoovinStatuses}
                className="gap-2"
              >
                {moovinSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {moovinSyncing ? "Actualizando..." : `Actualizar Moovin (${enRouteMoovinGuides.length})`}
              </Button>
            )}
            {selectedStore.logisticsProvider === "forza" && enRouteForzaGuides.length > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={forzaSyncing}
                onClick={updateForzaStatuses}
                className="gap-2"
              >
                {forzaSyncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {forzaSyncing ? "Actualizando..." : `Actualizar Forza (${enRouteForzaGuides.length})`}
              </Button>
            )}
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
          {(syncMessage || moovinMessage || forzaMessage) && (
            <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {syncMessage && (
                <p className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 shrink-0" /> {syncMessage}
                </p>
              )}
              {moovinMessage && (
                <p className="flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0" /> {moovinMessage}
                </p>
              )}
              {forzaMessage && (
                <p className="flex items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0" /> {forzaMessage}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 sm:flex-1">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={orderSearch}
                onChange={(event) => setOrderSearch(event.target.value)}
                placeholder="Buscar pedido: #MCRC11566, 11566, guia o cliente"
                className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              {tableLoading && (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Actualizando...
                </span>
              )}
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                <span className="font-mono text-sm font-semibold text-foreground">{total}</span>{" "}
                {orderSearch ? `de ${searchedCount}` : "pedidos"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={exporting || !total}
                onClick={handleExport}
              >
                <Download className="h-4 w-4" /> {exporting ? "Exportando..." : `Exportar (${total})`}
              </Button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-[4.5rem] shrink-0 text-xs font-medium text-muted-foreground">Periodo</span>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {ORDER_PERIOD_MODES.map((mode, index) => (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setPeriodMode(mode.value)}
                    className={`px-3 py-1 text-sm transition-colors ${index > 0 ? "border-l border-border" : ""} ${
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
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none"
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
                <span className="font-mono text-sm font-semibold text-foreground">{periodCount}</span>
              </span>
            </div>

            <div className="h-px bg-border/60" />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[4.5rem] shrink-0 text-xs font-medium text-muted-foreground">Estado</span>
              {ORDER_TRACKING_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  label={filter.label}
                  count={trackingCounts[filter.value]}
                  active={trackingFilter === filter.value}
                  onClick={() => setTrackingFilter(filter.value)}
                  dotClass={filter.value === "all" ? undefined : TRACKING_DOT_COLORS[filter.value]}
                />
              ))}
            </div>

            <div className="h-px bg-border/60" />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-[4.5rem] shrink-0 text-xs font-medium text-muted-foreground">Liquidacion</span>
              {ORDER_SETTLEMENT_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  label={filter.label}
                  count={settlementCounts[filter.value]}
                  active={settlementFilter === filter.value}
                  onClick={() => setSettlementFilter(filter.value)}
                />
              ))}
              {settlementFilter !== "all" && (
                <button
                  type="button"
                  onClick={() => setSettlementFilter("all")}
                  className="ml-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Base Shopify: {shopifyCoverage?.count ?? shopifyOrderCount} pedidos
            {shopifyCoverage?.oldest ? ` desde ${formatDate(shopifyCoverage.oldest.slice(0, 10))}` : ""}
            {latestLogisticsImport
              ? ` · Boxful: ${latestLogisticsImport.total_rows} filas, ${latestLogisticsImport.matched_rows} match, ${latestLogisticsImport.unmatched_rows} sin match`
              : " · Sin Boxful importado"}
          </p>
          {tableError && (
            <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-200">
              {tableError}
            </div>
          )}
          <div
            className={`transition-opacity ${tableLoading && serverRows.length > 0 ? "opacity-50" : ""}`}
            aria-busy={tableLoading}
          >
          <OrdersTable
            selectedStore={selectedStore}
            rows={serverRows}
            moovinByPackage={moovinByPackage}
            forzaByGuide={forzaByGuide}
            loading={tableLoading}
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
          </div>
          {total > ORDERS_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Pagina <span className="font-semibold text-foreground">{page}</span> de {totalPages} ·{" "}
                <span className="font-mono">{total}</span> pedidos
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || tableLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || tableLoading}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
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
        <ModalOverlay onClose={() => setIsLogisticsModalOpen(false)} labelledBy="logistics-import-title">
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
        </ModalOverlay>
      )}
    </div>
  );
}

function OrdersTable({
  selectedStore,
  rows,
  moovinByPackage,
  forzaByGuide,
  loading = false,
  emptyLabel = "No hay pedidos para mostrar.",
}: {
  selectedStore: FinanceStorePublic;
  // Filas server-side: ya traen las trazas de liquidacion resueltas (Carril 2
  // inc.2), por eso no hace falta el settlementTraceByKey en cliente.
  rows: OrderRowWithTraces[];
  moovinByPackage: Map<string, MoovinTrackingRow>;
  forzaByGuide: Map<string, ForzaTrackingRow>;
  loading?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-2 py-1.5">Orden</th>
            <th className="px-2 py-1.5">Origen</th>
            <th className="px-2 py-1.5">Guia</th>
            <th className="px-2 py-1.5">Transportadora</th>
            <th className="px-2 py-1.5">Cliente</th>
            <th className="px-2 py-1.5">Estado seguimiento</th>
            <th className="px-2 py-1.5">Shopify</th>
            <th className="px-2 py-1.5">Fecha</th>
            <th className="px-2 py-1.5">Liquidacion</th>
            <th className="px-2 py-1.5">Archivo</th>
            <th className="px-2 py-1.5 text-right">A liquidar</th>
            <th className="px-2 py-1.5">Items</th>
            <th className="px-2 py-1.5 text-right">COD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const traces = row.traces ?? [];
            const trackingStatus = getEffectiveTrackingStatus(row, traces);
            const forza = row.guide_number ? getForzaTrackingFromMap(forzaByGuide, row.guide_number) : undefined;
            const displayCourier = normalizeOperationalCourier(row.courier, selectedStore, row.guide_number);
            return (
              <tr key={row.row_key} className="border-b border-border/50">
                <td className="px-2 py-1.5 font-mono text-xs">{row.order_name}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={row.source === "boxful" ? "success" : row.source === "liquidacion" ? "warning" : "muted"}>
                    {row.source === "boxful" ? "Boxful" : row.source === "liquidacion" ? "Liquidacion" : "Shopify"}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">{row.guide_number || "-"}</td>
                <td className="px-2 py-1.5 text-xs">
                  {displayCourier ? (
                    <div className="flex flex-col items-start gap-0.5">
                      <span>{displayCourier}</span>
                      {isMoovinCourier(displayCourier, selectedStore) && row.guide_number && (
                        <MoovinTrackingButton
                          idPackage={row.guide_number}
                          lastName={row.last_name ?? ""}
                          cached={moovinByPackage.get(row.guide_number)}
                        />
                      )}
                      {isForzaCourier(displayCourier, selectedStore) && row.guide_number && (
                        <ForzaTrackingButton guide={row.guide_number} cached={forza} />
                      )}
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <span className="block max-w-[150px] truncate" title={row.customer_name || "Sin nombre"}>
                    {row.customer_name || "Sin nombre"}
                  </span>
                  {row.last_name && (
                    <span className="mt-0.5 block max-w-[150px] truncate text-[10px] text-muted-foreground">
                      Apellido: {row.last_name}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <StatusBadge
                    status={trackingStatus}
                    label={getTrackingStatusLabel(row, traces, trackingStatus)}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Badge variant={row.match_status === "matched" ? "success" : "warning"}>
                    {row.match_status === "matched" ? row.shopify_order_name : "sin match"}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {row.shopify_created_at ? formatDate(row.shopify_created_at) : "-"}
                </td>
                <td className="px-2 py-1.5">
                  <SettlementStatusBadge traces={traces} />
                </td>
                <td className="px-2 py-1.5">
                  <SettlementFileBadge traces={traces} />
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs">
                  {traces.length ? currency(sum(traces.map((trace) => trace.amount_to_liquidate))) : "-"}
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                  <span
                    className="block max-w-[140px] truncate"
                    title={(row.package_items ?? []).map((item) => item.title).join(", ")}
                  >
                    {(row.package_items ?? []).map((item) => item.title).join(", ") || "-"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs">
                  {currency(row.cod_amount)}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={13} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Cargando pedidos...
                  </span>
                ) : (
                  emptyLabel
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function isMoovinCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return false;
  return String(courier ?? "").toLowerCase().includes("moovin");
}

function isForzaCourier(courier: string | undefined, store?: FinanceStorePublic): boolean {
  if (store?.logisticsProvider === "forza") return Boolean(String(courier ?? "").trim());
  return String(courier ?? "").toLowerCase().includes("forza");
}

// EasySell/Shopify a veces rotula el fulfillment con un valor generico
// ("Transportadora", "Other", etc.) en vez del courier real. La transportadora
// por defecto depende de la tienda: Costa Rica usa Moovin, Honduras usa Forza.
const GENERIC_COURIER_LABELS = new Set([
  "",
  "transportadora",
  "transportista",
  "other",
  "otra",
  "custom",
  "manual",
  "n/a",
  "na",
  "none",
  "easysell",
]);

function getDefaultCourierForStore(store: FinanceStorePublic): string {
  return store.logisticsProvider === "forza" ? "Forza" : "Moovin";
}

function normalizeShopifyCourier(rawCompany: string | undefined, store: FinanceStorePublic): string {
  const company = String(rawCompany ?? "").trim();
  const lower = company.toLowerCase();
  if (GENERIC_COURIER_LABELS.has(lower)) return getDefaultCourierForStore(store);
  if (store.logisticsProvider === "forza") {
    if (lower.includes("forza") || lower.includes("moovin")) return "Forza";
  }
  if (store.logisticsProvider === "moovin" && lower.includes("moovin")) return "Moovin";
  return company;
}

function normalizeOperationalCourier(
  rawCompany: string | undefined,
  store: FinanceStorePublic,
  guide?: string
): string {
  const company = String(rawCompany ?? "").trim();
  if (company) return normalizeShopifyCourier(company, store);
  return guide ? getDefaultCourierForStore(store) : "";
}

function normalizeForzaGuide(guide: string): string {
  const trimmed = String(guide ?? "").trim().toUpperCase();
  if (!trimmed) return "";
  return trimmed.startsWith("FD") ? trimmed : `FD${trimmed.replace(/^FD/i, "")}`;
}

function normalizeGuideForStore(guide: string | undefined, store: FinanceStorePublic): string {
  const trimmed = String(guide ?? "").trim();
  if (!trimmed) return "";
  return store.logisticsProvider === "forza" ? normalizeForzaGuide(trimmed) : trimmed;
}

function buildForzaTrackingMap(rows: ForzaTrackingRow[]): Map<string, ForzaTrackingRow> {
  const map = new Map<string, ForzaTrackingRow>();
  for (const row of rows) {
    const normalized = normalizeForzaGuide(row.guide_number || row.tracking_number);
    if (!normalized) continue;
    map.set(normalized, row);
    map.set(normalized.replace(/^FD/i, ""), row);
    if (row.guide_number) map.set(String(row.guide_number).trim().toUpperCase(), row);
    if (row.tracking_number) map.set(String(row.tracking_number).trim().toUpperCase(), row);
  }
  return map;
}

function getForzaTrackingFromMap(
  map: Map<string, ForzaTrackingRow>,
  guide: string | undefined
): ForzaTrackingRow | undefined {
  const normalized = normalizeForzaGuide(String(guide ?? ""));
  if (!normalized) return undefined;
  return map.get(normalized) ?? map.get(normalized.replace(/^FD/i, "")) ?? map.get(String(guide).trim().toUpperCase());
}

interface MoovinTrackingEvent {
  code: string;
  group: "delivered" | "failed" | "returned" | "in_progress";
  title: string;
  description: string;
  date: string | null;
  note: string;
}

interface MoovinTrackingResult {
  ok?: boolean;
  error?: string;
  tracking_number?: string;
  latest_status?: string | null;
  latest_group?: MoovinTrackingEvent["group"] | null;
  latest_at?: string | null;
  delivery_address?: string;
  events?: MoovinTrackingEvent[];
}

function MoovinTrackingButton({
  idPackage,
  lastName,
  cached,
}: {
  idPackage: string;
  lastName: string;
  cached?: MoovinTrackingRow;
}) {
  const [open, setOpen] = useState(false);
  const groupClass =
    cached?.latest_group === "delivered"
      ? "text-emerald-300"
      : cached?.latest_group === "failed" || cached?.latest_group === "returned"
        ? "text-red-300"
        : "text-cyan-300";

  return (
    <>
      {cached?.latest_status ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Ver ruta completa"
          className="flex flex-col items-start text-left"
        >
          <span className={`text-[10px] font-medium ${groupClass}`}>
            {cached.has_incident ? "⚠ " : ""}
            {cached.latest_status}
          </span>
          {cached.latest_at && (
            <span className="text-[9px] text-muted-foreground">{formatMoovinDate(cached.latest_at)}</span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5 text-[10px] text-primary transition-colors hover:border-primary/50"
        >
          <Search className="h-3 w-3" /> estado
        </button>
      )}
      {open && (
        <MoovinTrackingModal idPackage={idPackage} lastName={lastName} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function MoovinTrackingModal({
  idPackage,
  lastName,
  onClose,
}: {
  idPackage: string;
  lastName: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<MoovinTrackingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(
      `/api/finance/moovin-tracking?idPackage=${encodeURIComponent(idPackage)}&lastName=${encodeURIComponent(lastName)}`,
      { cache: "no-store" }
    )
      .then((res) => res.json())
      .then((json: MoovinTrackingResult) => {
        if (cancelled) return;
        if (json.error || json.ok === false) {
          setError(json.error || "Moovin no devolvio datos para esta guia.");
        } else {
          setData(json);
        }
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo consultar Moovin.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [idPackage, lastName]);

  const events = data?.events ?? [];

  return (
    <ModalOverlay onClose={onClose} labelledBy="moovin-tracking-title">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="moovin-tracking-title" className="text-base font-semibold">
              Seguimiento Moovin
            </h3>
            <p className="font-mono text-xs text-muted-foreground">
              Guia {idPackage}
              {lastName ? ` · ${lastName}` : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Consultando Moovin...
          </div>
        ) : error ? (
          <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{error}</p>
        ) : (
          <>
            <div className="mb-3 border border-border bg-background p-3">
              <p className="text-[11px] text-muted-foreground">Ultimo estado</p>
              <p
                className={`mt-0.5 text-sm font-semibold ${
                  data?.latest_group === "delivered"
                    ? "text-emerald-300"
                    : data?.latest_group === "failed" || data?.latest_group === "returned"
                      ? "text-red-300"
                      : "text-foreground"
                }`}
              >
                {data?.latest_status ?? "Sin estado"}
              </p>
              {data?.latest_at && (
                <p className="text-[11px] text-muted-foreground">{formatMoovinDate(data.latest_at)}</p>
              )}
              {data?.delivery_address && (
                <p className="mt-1 text-[11px] text-muted-foreground">Entrega: {data.delivery_address}</p>
              )}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto">
              {events.map((event, index) => (
                <div key={`${event.code}-${index}`} className="flex gap-2">
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                      event.group === "delivered"
                        ? "bg-emerald-400"
                        : event.group === "failed" || event.group === "returned"
                          ? "bg-red-400"
                          : "bg-cyan-400"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs font-medium">{event.title}</span>
                      {event.date && (
                        <span className="text-[10px] text-muted-foreground">{formatMoovinDate(event.date)}</span>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-[11px] text-muted-foreground">{event.description}</p>
                    )}
                    {event.note && (
                      <p className="text-[11px] text-amber-200">{event.note}</p>
                    )}
                  </div>
                </div>
              ))}
              {!events.length && (
                <p className="text-sm text-muted-foreground">Sin eventos de seguimiento.</p>
              )}
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
}

function formatMoovinDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ForzaTrackingButton({
  guide,
  cached,
}: {
  guide: string;
  cached?: ForzaTrackingRow;
}) {
  const groupClass =
    cached?.latest_group === "delivered"
      ? "text-emerald-300"
      : cached?.latest_group === "failed" || cached?.latest_group === "returned"
        ? "text-red-300"
        : "text-cyan-300";
  const url = buildForzaTrackingUrl(guide);

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title="Abrir rastreo Forza"
      className="flex flex-col items-start text-left"
    >
      {cached?.latest_status ? (
        <>
          <span className={`text-[10px] font-medium ${groupClass}`}>
            {cached.has_incident ? "!" : ""} {cached.latest_status}
          </span>
          {cached.latest_at && (
            <span className="text-[9px] text-muted-foreground">{formatCourierDate(cached.latest_at, "es-HN")}</span>
          )}
        </>
      ) : (
        <span className="inline-flex items-center gap-1 border border-border bg-background px-1.5 py-0.5 text-[10px] text-primary transition-colors hover:border-primary/50">
          <Search className="h-3 w-3" /> rastreo
        </span>
      )}
    </a>
  );
}

function buildForzaTrackingUrl(guide: string): string {
  const normalized = normalizeForzaGuide(guide);
  return `https://rastreo.forzadelivery.com/${encodeURIComponent(normalized || guide)}`;
}

function formatCourierDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ProductColumnKey = "product_name" | "cost" | "orders" | "dispatch_rate" | "delivery_effectiveness";

function ProductAnalysisTab({
  rows,
  rowsLoading,
  rowsError,
  costs,
  costVersions,
  products,
  productsLoading,
  productsError,
  onSaveProductCost,
  onReloadCosts,
}: {
  rows: ProductAnalysisRow[];
  rowsLoading: boolean;
  rowsError: string;
  costs: ProductCost[];
  costVersions: ProductCostVersion[];
  products: ShopifyProductOption[];
  productsLoading: boolean;
  productsError: string;
  onSaveProductCost: (input: ProductCostSaveInput) => Promise<void>;
  onReloadCosts: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductAnalysisFilter>("all");
  const [sort, setSort] = useState<{ key: ProductColumnKey; dir: "asc" | "desc" } | null>(null);
  const [isBulkCostOpen, setIsBulkCostOpen] = useState(false);
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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsBulkCostOpen(true)}>
              <Upload className="h-4 w-4" /> Importar costos
            </Button>
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
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rowsError && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
            {rowsError}
          </div>
        )}
        {productsError && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
            {productsError}
          </div>
        )}
        {rowsLoading && (
          <div className="flex items-center gap-2 border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando analisis de productos...
          </div>
        )}
        <ProductFunnelStats
          productsVisible={filteredRows.length}
          productsLoading={productsLoading || rowsLoading}
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
      {isBulkCostOpen && (
        <BulkCostImportModal onClose={() => setIsBulkCostOpen(false)} onReloadCosts={onReloadCosts} />
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

interface ParsedCostRow {
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  effective_from: string;
}

function BulkCostImportModal({
  onClose,
  onReloadCosts,
}: {
  onClose: () => void;
  onReloadCosts: () => Promise<void>;
}) {
  const [parsed, setParsed] = useState<ParsedCostRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ saved: number; failed: number } | null>(null);

  async function handleFile(file: File) {
    setParsing(true);
    setMessage("");
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const rows = raw.map(mapBulkCostRow).filter((r): r is ParsedCostRow => r !== null);
      setParsed(rows);
      if (!rows.length) {
        setMessage(
          "No se detectaron filas validas. Asegurate de tener columnas SKU y Costo (unitario)."
        );
      }
    } catch {
      setMessage("No se pudo leer el archivo. Usa un XLSX o CSV con encabezados.");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!parsed.length) return;
    setImporting(true);
    setMessage("");
    try {
      const res = await fetch("/api/finance/product-costs/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo importar");
      setResult({ saved: Number(json.saved ?? 0), failed: Number(json.failed ?? 0) });
      await onReloadCosts();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo importar");
    } finally {
      setImporting(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} labelledBy="bulk-cost-title">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="bulk-cost-title" className="text-base font-semibold">
              Importar costos por SKU
            </h3>
            <p className="text-xs text-muted-foreground">
              Sube un Excel/CSV con columnas <strong>SKU</strong> y <strong>Costo</strong> (unitario).
              Opcionales: <strong>Empaque</strong>, <strong>Vigente desde</strong>, <strong>Producto</strong>.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        {parsing && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Leyendo {fileName}...
          </p>
        )}
        {message && (
          <p className="mt-3 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {message}
          </p>
        )}
        {result && (
          <p className="mt-3 border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {result.saved} costos guardados{result.failed ? `, ${result.failed} con error` : ""}.
          </p>
        )}

        {parsed.length > 0 && !result && (
          <div className="mt-3 min-h-0 flex-1 overflow-auto border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Costo</th>
                  <th className="px-3 py-2 text-right">Empaque</th>
                  <th className="px-3 py-2">Vigente</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 200).map((row, index) => (
                  <tr key={`${row.sku}-${index}`} className="border-t border-border/50">
                    <td className="px-3 py-1.5 font-mono text-xs">{row.sku}</td>
                    <td className="max-w-[180px] truncate px-3 py-1.5 text-xs" title={row.product_name}>
                      {row.product_name || "-"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{currency(row.unit_cost)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{currency(row.packaging_cost)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{row.effective_from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {parsed.length > 0 ? `${parsed.length} SKUs listos para importar` : ""}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {result ? "Cerrar" : "Cancelar"}
            </Button>
            {!result && (
              <Button type="button" disabled={importing || !parsed.length} onClick={handleImport} className="gap-2">
                {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? "Importando..." : `Importar ${parsed.length || ""}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

// Mapea una fila del Excel a un costo, aceptando variantes de encabezado.
function mapBulkCostRow(raw: Record<string, unknown>): ParsedCostRow | null {
  const get = (...names: string[]): string => {
    for (const key of Object.keys(raw)) {
      const norm = key.trim().toLowerCase();
      if (names.some((n) => norm === n || norm.includes(n))) {
        return String(raw[key] ?? "").trim();
      }
    }
    return "";
  };
  const sku = get("sku", "codigo", "código");
  const unitCostText = get("costo unitario", "costo", "precio", "unit_cost", "unitcost");
  const unit_cost = Number(String(unitCostText).replace(/[^0-9.,-]/g, "").replace(/,/g, "")) || 0;
  if (!sku || unit_cost <= 0) return null;
  const packagingText = get("empaque", "packaging", "empaque propio");
  const packaging_cost = Number(String(packagingText).replace(/[^0-9.,-]/g, "").replace(/,/g, "")) || 0;
  return {
    sku,
    product_name: get("producto", "product", "nombre", "descripcion", "descripción"),
    unit_cost,
    packaging_cost,
    effective_from: normalizeBulkDate(get("vigente", "fecha", "effective", "desde")),
  };
}

function normalizeBulkDate(value: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  // dd/mm/aaaa o dd-mm-aaaa -> aaaa-mm-dd
  const parts = value.split(/[/-]/).map((p) => p.trim());
  if (parts.length === 3 && Number(parts[2]) > 1900) {
    const [d, m, y] = parts;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
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
    } catch (err) {
      setValidationMessage(
        err instanceof Error ? err.message : "No se pudo guardar el costo. Intenta de nuevo."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} labelledBy="product-cost-edit-title">
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
    </ModalOverlay>
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

function ShopifyNotesTab({
  rows: noteAliasRows,
  shopifyOrderCount,
  loading,
  error,
}: {
  rows: ShopifyNoteAliasRow[];
  shopifyOrderCount: number;
  loading: boolean;
  error: string;
}) {
  const [noteSearch, setNoteSearch] = useState("");
  const [onlyRowsWithCode, setOnlyRowsWithCode] = useState(true);
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
            Alias de notas Shopify de la base sincronizada para cruzar codigos del bot.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={exportAliases} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar alias
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando notas Shopify...
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Pedidos Shopify" value={shopifyOrderCount} />
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
  storeCode,
  imports,
  shopifyCoverage,
  importing,
  onImport,
  onDeleteImport,
}: {
  storeCode: FinanceStoreCode;
  imports: SettlementImport[];
  shopifyCoverage: { count: number; oldest: string | null; newest: string | null } | null;
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
  // Vista server-side (Carril 2 — ultimo tab): /api/finance/settlements-view trae
  // las filas de liquidacion ya enriquecidas con Shopify, las alertas "entregados
  // sin liquidar" y las anomalias de doble liquidacion ya calculadas. Asi el
  // navegador ya NO carga el snapshot (~11k pedidos + logistica completa). Se
  // refresca al cambiar de tienda y cada vez que cambian los imports (tras
  // importar/eliminar una liquidacion).
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [liquidationAlertRows, setLiquidationAlertRows] = useState<LogisticsRow[]>([]);
  const [doubleSettlementAnomalies, setDoubleSettlementAnomalies] = useState<DoubleSettlementAnomaly[]>([]);
  const [viewLoading, setViewLoading] = useState(true);
  const [viewError, setViewError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setViewLoading(true);
    setViewError("");
    (async () => {
      try {
        const res = await fetch(
          withStore("/api/finance/settlements-view", storeCode),
          { cache: "no-store", signal: controller.signal }
        );
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la vista de liquidaciones");
        setRows(Array.isArray(json.rows) ? (json.rows as SettlementRow[]) : []);
        setLiquidationAlertRows(Array.isArray(json.liquidationAlertRows) ? (json.liquidationAlertRows as LogisticsRow[]) : []);
        setDoubleSettlementAnomalies(
          Array.isArray(json.doubleSettlementAnomalies)
            ? (json.doubleSettlementAnomalies as DoubleSettlementAnomaly[])
            : []
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        setRows([]);
        setLiquidationAlertRows([]);
        setDoubleSettlementAnomalies([]);
        setViewError(err instanceof Error ? err.message : "No se pudo cargar la vista de liquidaciones");
      } finally {
        if (!controller.signal.aborted) setViewLoading(false);
      }
    })();
    return () => controller.abort();
  }, [storeCode, imports]);

  const fileByImportId = useMemo(
    () => new Map(imports.map((item) => [item.id, item.file_name])),
    [imports]
  );
  // Las filas ya vienen enriquecidas con Shopify desde el endpoint.
  const enrichedRows = rows;
  const unmatchedByImport = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.match_status === "matched") continue;
      counts.set(row.import_id, (counts.get(row.import_id) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
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
      {viewError && (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-200">
          {viewError}
        </div>
      )}
      {viewLoading && (
        <div className="flex items-center gap-2 border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Cargando liquidaciones...
        </div>
      )}
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
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {(unmatchedByImport.get(item.id) ?? 0) > 0 ? (
                          <Badge variant="warning">{unmatchedByImport.get(item.id)} sin match</Badge>
                        ) : (
                          <Badge variant="success">0 sin match</Badge>
                        )}
                        {shopifyCoverage?.oldest &&
                          item.period_end &&
                          item.period_end < shopifyCoverage.oldest.slice(0, 10) && (
                            <Badge
                              variant="destructive"
                              title={`Este corte es anterior a tu base sincronizada (desde ${formatDate(shopifyCoverage.oldest.slice(0, 10))}). Corre Sync Shopify para extender el historico y estos pedidos cruzaran solos.`}
                            >
                              corte fuera de la base
                            </Badge>
                          )}
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
    <ModalOverlay onClose={onClose} labelledBy="cost-history-title">
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
    </ModalOverlay>
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
  const [staff, setStaff] = useState<PayrollStaff[]>([]);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/finance/payroll-staff", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && Array.isArray(json.staff)) setStaff(json.staff as PayrollStaff[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const activeView =
    EXPENSE_VIEW_CONFIG.find((view) => view.type === activeType) ?? EXPENSE_VIEW_CONFIG[0];
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [expenseSort, setExpenseSort] = useState<{
    key: "expense_date" | "month" | "platform" | "category" | "description" | "amount";
    dir: "asc" | "desc";
  }>({ key: "expense_date", dir: "desc" });

  const typeExpenses = expenses.filter((expense) => expense.type === activeType);
  const monthFilterOptions = uniqueKeys(typeExpenses.map((expense) => expense.month).filter(Boolean))
    .sort()
    .reverse();
  const platformFilterOptions = uniqueKeys(
    typeExpenses.map((expense) => expense.platform).filter(Boolean)
  ).sort((a, b) => a.localeCompare(b));
  const categoryFilterOptions = uniqueKeys(
    typeExpenses.map((expense) => expense.category).filter(Boolean)
  ).sort((a, b) => a.localeCompare(b));
  const hasExpenseFilters =
    filterMonth !== "all" || filterPlatform !== "all" || filterCategory !== "all";

  const visibleExpenses = typeExpenses
    .filter(
      (expense) =>
        (filterMonth === "all" || expense.month === filterMonth) &&
        (filterPlatform === "all" || expense.platform === filterPlatform) &&
        (filterCategory === "all" || expense.category === filterCategory)
    )
    .sort((a, b) => {
      const factor = expenseSort.dir === "asc" ? 1 : -1;
      if (expenseSort.key === "amount") {
        return (Number(a.amount || 0) - Number(b.amount || 0)) * factor;
      }
      const aValue = String(a[expenseSort.key] ?? "");
      const bValue = String(b[expenseSort.key] ?? "");
      return (
        (aValue.localeCompare(bValue, "es", { sensitivity: "base" }) ||
          String(a.created_at || "").localeCompare(String(b.created_at || ""))) * factor
      );
    });

  function toggleExpenseSort(key: typeof expenseSort.key) {
    setExpenseSort((current) => {
      if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      // Fechas y montos arrancan de mayor a menor; texto A-Z.
      return { key, dir: key === "amount" || key === "expense_date" || key === "month" ? "desc" : "asc" };
    });
  }

  function clearExpenseFilters() {
    setFilterMonth("all");
    setFilterPlatform("all");
    setFilterCategory("all");
  }
  const payrollPeople = uniqueKeys(
    expenses
      .filter((expense) => expense.type === "payroll" && expense.platform)
      .map((expense) => expense.platform)
  ).sort((a, b) => a.localeCompare(b));
  const formAmount = Number(form.amount);
  const formExchangeRate = Number(form.exchange_rate);
  const originalCurrency = getExpenseOriginalCurrency(form);
  const needsExchangeRate = originalCurrency !== "CRC";
  const [fxHint, setFxHint] = useState("");
  const formRef = useRef(form);
  formRef.current = form;

  // Trae el tipo de cambio del dia y lo precarga si el campo esta vacio;
  // siempre editable por si se pago a un tipo distinto.
  useEffect(() => {
    if (!needsExchangeRate) {
      setFxHint("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/finance/exchange-rate?from=${originalCurrency}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { rate?: number; updated?: string; stale?: boolean };
        if (cancelled || !res.ok || !json.rate) return;
        const rate = Number(json.rate);
        setFxHint(
          `TC del dia: ${rate.toFixed(2)} CRC por 1 ${originalCurrency}${json.stale ? " (cacheado)" : ""}`
        );
        if (!formRef.current.exchange_rate) {
          setForm({ ...formRef.current, exchange_rate: rate.toFixed(2) });
        }
      } catch {
        if (!cancelled) setFxHint("");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalCurrency, needsExchangeRate]);
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
    typeExpenses
      .filter((expense) => expense.month === currentMonth)
      .map((expense) => Number(expense.amount || 0))
  );
  const total = sum(visibleExpenses.map((expense) => Number(expense.amount || 0)));

  function selectExpenseType(type: ExpenseType) {
    setActiveType(type);
    setForm(prepareExpenseFormForType(form, type));
    clearExpenseFilters();
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {activeType === "payroll" && (
              <Button type="button" variant="outline" onClick={() => setIsStaffModalOpen(true)}>
                Personal
              </Button>
            )}
            <Button type="button" onClick={() => openExpenseModal(activeType)} className="gap-2">
              <Plus className="h-4 w-4" />
              {activeView.buttonLabel}
            </Button>
          </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Filtros</span>
            <select
              value={filterMonth}
              onChange={(event) => setFilterMonth(event.target.value)}
              className="h-8 border border-input bg-background px-2 text-sm outline-none"
              aria-label="Filtrar por mes"
            >
              <option value="all">Mes: todos</option>
              {monthFilterOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
            <select
              value={filterPlatform}
              onChange={(event) => setFilterPlatform(event.target.value)}
              className="h-8 border border-input bg-background px-2 text-sm outline-none"
              aria-label="Filtrar por persona o plataforma"
            >
              <option value="all">
                {activeType === "payroll" ? "Persona: todas" : "Plataforma: todas"}
              </option>
              {platformFilterOptions.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <select
              value={filterCategory}
              onChange={(event) => setFilterCategory(event.target.value)}
              className="h-8 border border-input bg-background px-2 text-sm outline-none"
              aria-label="Filtrar por tipo o categoria"
            >
              <option value="all">{activeType === "payroll" ? "Tipo: todos" : "Categoria: todas"}</option>
              {categoryFilterOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {hasExpenseFilters && (
              <button
                type="button"
                onClick={clearExpenseFilters}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label={hasExpenseFilters ? "Registros (filtrados)" : "Registros"}
              value={visibleExpenses.length}
            />
            <MiniStat label="Mes actual" value={currency(currentMonthTotal)} />
            <MiniStat
              label={hasExpenseFilters ? "Total (filtrado)" : "Total"}
              value={currency(total)}
            />
          </div>
          <div className="overflow-auto border border-border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-card text-left text-xs text-muted-foreground">
                <tr>
                  {(
                    [
                      { key: "expense_date", label: "Fecha", numeric: false },
                      { key: "month", label: "Mes", numeric: false },
                      {
                        key: "platform",
                        label: activeType === "payroll" ? "Persona" : "Plataforma / proveedor",
                        numeric: false,
                      },
                      {
                        key: "category",
                        label: activeType === "payroll" ? "Tipo" : "Categoria",
                        numeric: false,
                      },
                      {
                        key: "description",
                        label: activeType === "payroll" ? "Funcion / detalle" : "Descripcion",
                        numeric: false,
                      },
                      { key: "amount", label: "Monto", numeric: true },
                    ] as const
                  ).map((column) => (
                    <th key={column.key} className={`px-3 py-2 ${column.numeric ? "text-right" : ""}`}>
                      <button
                        type="button"
                        onClick={() => toggleExpenseSort(column.key)}
                        className={`inline-flex w-full items-center gap-1 transition-colors hover:text-foreground ${
                          column.numeric ? "justify-end" : ""
                        }`}
                        title="Ordenar por esta columna"
                      >
                        {column.label}
                        {expenseSort.key === column.key &&
                          (expenseSort.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArrowDown className="h-3 w-3 shrink-0" />
                          ))}
                      </button>
                    </th>
                  ))}
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
        <ModalOverlay onClose={() => setIsExpenseModalOpen(false)} labelledBy="expense-modal-title">
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
                {activeType === "payroll" && staff.length > 0 ? (
                  <select
                    value={form.platform}
                    required
                    onChange={(e) => {
                      const member = staff.find((person) => person.name === e.target.value);
                      setForm({
                        ...form,
                        platform: e.target.value,
                        description: form.description || member?.role || "",
                        type: activeType,
                      });
                    }}
                    className="h-10 w-full border border-input bg-background px-3 text-sm outline-none"
                  >
                    <option value="">Selecciona persona...</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.name}>
                        {person.name}
                        {person.role ? ` - ${person.role}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder={activeView.platformPlaceholder}
                    value={form.platform}
                    list={activeType === "payroll" ? "payroll-people" : undefined}
                    onChange={(e) => setForm({ ...form, platform: e.target.value, type: activeType })}
                    required={activeType === "payroll"}
                  />
                )}
                {activeType === "payroll" && staff.length === 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Registra tu personal con el boton &quot;Personal&quot; para elegirlo de una lista.
                  </p>
                )}
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
                  {activeType === "payroll" ? (
                    <select
                      value={form.category}
                      required
                      onChange={(e) => setForm({ ...form, category: e.target.value, type: activeType })}
                      className="h-10 w-full border border-input bg-background px-3 text-sm outline-none"
                    >
                      <option value="">Selecciona tipo...</option>
                      {PAYROLL_PAYMENT_TYPES.map((paymentType) => (
                        <option key={paymentType} value={paymentType}>
                          {paymentType}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      placeholder={activeView.categoryPlaceholder}
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value, type: activeType })}
                    />
                  )}
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
                      {fxHint && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {fxHint} · autocompletado, editable
                        </p>
                      )}
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
                      {fxHint && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {fxHint} · autocompletado, editable
                        </p>
                      )}
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
        </ModalOverlay>
      )}
      {isStaffModalOpen && (
        <PayrollStaffModal
          staff={staff}
          onChange={setStaff}
          onClose={() => setIsStaffModalOpen(false)}
        />
      )}
    </div>
  );

function PayrollStaffModal({
  staff,
  onChange,
  onClose,
}: {
  staff: PayrollStaff[];
  onChange: (staff: PayrollStaff[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleAdd() {
    if (!name.trim()) {
      setMessage("Escribe el nombre de la persona.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/finance/payroll-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role: role.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo registrar la persona");
      onChange(
        [...staff, json.member as PayrollStaff].sort((a, b) => a.name.localeCompare(b.name))
      );
      setName("");
      setRole("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo registrar la persona");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(member: PayrollStaff) {
    const ok = window.confirm(`Eliminar a ${member.name} del catalogo de personal?`);
    if (!ok) return;
    setMessage("");
    try {
      const res = await fetch(`/api/finance/payroll-staff?id=${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "No se pudo eliminar");
      }
      onChange(staff.filter((person) => person.id !== member.id));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  }

  return (
    <ModalOverlay onClose={onClose} labelledBy="payroll-staff-title">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="payroll-staff-title" className="text-base font-semibold">
              Personal de planilla
            </h3>
            <p className="text-xs text-muted-foreground">
              Registra cada persona una vez; en los pagos solo la eliges de la lista.
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            placeholder="Nombre"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="Funcion (ej. Jefa de tienda)"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          />
          <Button type="button" disabled={saving} onClick={handleAdd} className="gap-2">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </Button>
        </div>
        {message && (
          <p className="mt-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
            {message}
          </p>
        )}

        <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-auto">
          {staff.length ? (
            staff.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 border border-border bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.role || "Sin funcion"}</p>
                </div>
                <button
                  type="button"
                  title="Eliminar"
                  aria-label={`Eliminar ${member.name}`}
                  onClick={() => handleDelete(member)}
                  className="text-muted-foreground transition-colors hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          ) : (
            <p className="border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Aun no hay personal registrado.
            </p>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
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
  loading,
  error,
  summary,
  costs,
  onSaveProductCost,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  rows: MonthlyCloseRow[];
  control: FinanceControlCenter;
  loading: boolean;
  error: string;
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
      to_claim_fresh: 0,
      to_claim_overdue: 0,
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
      acc.to_claim_fresh += row.to_claim_fresh;
      acc.to_claim_overdue += row.to_claim_overdue;
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

      {error && (
        <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando cierre mensual...
        </div>
      )}

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
            <span className="hidden text-right lg:block">Pend. liquidacion</span>
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
  const pendingOrders = monthOrders.filter((order) => isPendingLike(order.tracking_status));
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
    <ModalOverlay onClose={onClose} labelledBy="month-orders-title">
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
    </ModalOverlay>
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
    <ModalOverlay onClose={onClose} labelledBy="month-anomalies-title">
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
    </ModalOverlay>
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
    <ModalOverlay onClose={onClose} labelledBy="month-skus-title">
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
    </ModalOverlay>
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
  rematching,
  rematchMessage,
  onRematch,
}: {
  files: BoxfulFileControl[];
  logisticsImports: LogisticsImport[];
  rematching: boolean;
  rematchMessage: string;
  onRematch: () => void;
}) {
  const mergedFiles = useMemo(
    () => mergeLogisticsBoxfulFiles(files, logisticsImports),
    [files, logisticsImports]
  );
  const importById = useMemo(
    () => new Map(logisticsImports.map((imp): [number, LogisticsImport] => [imp.id, imp])),
    [logisticsImports]
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
            {logisticsImports.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rematching}
                onClick={onRematch}
                className="gap-2"
                title="Vuelve a cruzar los Boxful/liquidaciones ya cargados con la base actual de Shopify"
              >
                <RefreshCw className={`h-4 w-4 ${rematching ? "animate-spin" : ""}`} />
                {rematching ? "Re-emparejando..." : "Re-emparejar"}
              </Button>
            )}
          </div>
          {rematchMessage && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" /> {rematchMessage}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto border border-border">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Archivo</th>
                  <th className="px-3 py-2">Corte</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Import ID</th>
                  <th className="px-3 py-2">Filas</th>
                  <th className="px-3 py-2">Match</th>
                  <th className="px-3 py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {mergedFiles.map((file) => {
                  const imp = file.import_id ? importById.get(file.import_id) : undefined;
                  return (
                    <tr key={file.file_name} className="border-t border-border/50">
                      <td className="max-w-[360px] truncate px-3 py-2" title={file.file_name}>{file.file_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{file.cutoff_date ? formatDate(file.cutoff_date) : "-"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={file.status === "faltante" ? "destructive" : file.status === "esperado" ? "warning" : "success"}>
                          {file.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{file.import_id ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{imp ? imp.total_rows : "-"}</td>
                      <td className="px-3 py-2">
                        {imp ? (
                          <Badge
                            variant={
                              imp.matched_rows === 0
                                ? "destructive"
                                : imp.matched_rows < imp.total_rows
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {imp.matched_rows}/{imp.total_rows} match
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{file.notes || "-"}</td>
                    </tr>
                  );
                })}
                {!mergedFiles.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
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

type KpiRange = "today" | "7d" | "30d" | "month" | "all";
type KpiTone = "neutral" | "good" | "warn" | "bad";
type DeltaTone = "good" | "bad" | "muted";

const KPI_RANGE_OPTIONS: { value: KpiRange; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "month", label: "Mes" },
  { value: "all", label: "Todo" },
];

interface KpiWindow {
  curStart: number;
  curEnd: number;
  prevStart: number | null;
  prevEnd: number | null;
  rangeLabel: string;
  compareLabel: string;
  maturing: boolean;
}

interface OpMetrics {
  generated: number;
  dispatched: number;
  delivered: number;
  notDelivered: number;
  annulled: number;
  enRoute: number;
  enRouteRetry: number;
  resolved: number;
  deliveryRate: number;
  returnRate: number;
  dispatchRate: number;
  annulRate: number;
  leadAvg: number | null;
  leadSamples: number;
  ticket: number;
}

// Metrica vacia para pintar las tarjetas en cero mientras el endpoint responde.
const EMPTY_OP_METRICS: OpMetrics = {
  generated: 0,
  dispatched: 0,
  delivered: 0,
  notDelivered: 0,
  annulled: 0,
  enRoute: 0,
  enRouteRetry: 0,
  resolved: 0,
  deliveryRate: 0,
  returnRate: 0,
  dispatchRate: 0,
  annulRate: 0,
  leadAvg: null,
  leadSamples: 0,
  ticket: 0,
};

interface KpiCardVM {
  id: string;
  label: string;
  value: string;
  sub?: string;
  star?: boolean;
  tone: KpiTone;
  deltaLabel: string | null;
  deltaTone: DeltaTone;
}

function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Ventana actual + ventana previa "like-for-like" (mismo largo, inmediatamente
// anterior). "Mes" compara MTD contra el mismo tramo del mes anterior, no contra
// el mes completo. `maturing` marca rangos donde la tasa de entrega aun no madura
// por el lag logistico del COD (un pedido de hoy no se entrega hoy).
function getKpiWindows(range: KpiRange, now: Date): KpiWindow {
  const end = now.getTime();
  const dayStart = startOfDayMs(now);
  const DAY = 24 * 60 * 60 * 1000;
  if (range === "all") {
    return {
      curStart: 0,
      curEnd: end,
      prevStart: null,
      prevEnd: null,
      rangeLabel: "Todo el histórico",
      compareLabel: "sin comparativo",
      maturing: false,
    };
  }
  if (range === "today") {
    return {
      curStart: dayStart,
      curEnd: end,
      prevStart: dayStart - DAY,
      prevEnd: dayStart,
      rangeLabel: "Hoy",
      compareLabel: "vs. ayer",
      maturing: true,
    };
  }
  if (range === "month") {
    const curStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const elapsed = end - curStart;
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
    return {
      curStart,
      curEnd: end,
      prevStart,
      prevEnd: prevStart + elapsed,
      rangeLabel: "Mes actual",
      compareLabel: "vs. mes anterior (mismo tramo)",
      maturing: true,
    };
  }
  const days = range === "7d" ? 7 : 30;
  const curStart = dayStart - (days - 1) * DAY;
  const span = end - curStart;
  return {
    curStart,
    curEnd: end,
    prevStart: curStart - span,
    prevEnd: curStart,
    rangeLabel: `Últimos ${days} días`,
    compareLabel: `vs. ${days} días previos`,
    maturing: range === "7d",
  };
}

function isDispatchedStatus(status: string): boolean {
  return (
    status === "en_route" ||
    status === "en_route_retry" ||
    status === "incident" ||
    status === "delivered" ||
    status === "not_delivered" ||
    status === "returned"
  );
}

function diffDaysMs(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return -1;
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

// KPIs operativos de una cohorte de pedidos (agrupada por fecha de creacion).
function computeOpMetrics(orders: OrderProfitabilityRow[]): OpMetrics {
  let generated = 0;
  let dispatched = 0;
  let delivered = 0;
  let notDelivered = 0;
  let annulled = 0;
  let enRoute = 0;
  let enRouteRetry = 0;
  let revenue = 0;
  let valueOrders = 0;
  const leadDays: number[] = [];
  for (const order of orders) {
    generated += 1;
    const status = order.tracking_status;
    if (Boolean(order.guide_number) || isDispatchedStatus(status)) dispatched += 1;
    if (status === "delivered") delivered += 1;
    else if (status === "not_delivered" || status === "returned") notDelivered += 1;
    else if (status === "annulled") annulled += 1;
    else if (status === "en_route") enRoute += 1;
    else if (status === "en_route_retry") enRouteRetry += 1;
    const value = Number(order.order_value || 0);
    if (value > 0) {
      revenue += value;
      valueOrders += 1;
    }
    if (status === "delivered" && order.created_at && order.delivered_on) {
      const lead = diffDaysMs(order.created_at, order.delivered_on);
      if (lead >= 0 && lead <= 120) leadDays.push(lead);
    }
  }
  const resolved = delivered + notDelivered;
  return {
    generated,
    dispatched,
    delivered,
    notDelivered,
    annulled,
    enRoute,
    enRouteRetry,
    resolved,
    deliveryRate: resolved ? (delivered / resolved) * 100 : 0,
    returnRate: resolved ? (notDelivered / resolved) * 100 : 0,
    dispatchRate: generated ? (dispatched / generated) * 100 : 0,
    annulRate: generated ? (annulled / generated) * 100 : 0,
    leadAvg: leadDays.length ? leadDays.reduce((acc, value) => acc + value, 0) / leadDays.length : null,
    leadSamples: leadDays.length,
    ticket: valueOrders ? revenue / valueOrders : 0,
  };
}

// Nota (Carril 2 inc.2): computeOpMetricsFromTrackableRows se movio a
// lib/finance-orders.ts y ahora lo usa /api/finance/kpis. La UI ya no calcula los
// KPIs operativos en memoria.

function formatInt(value: number): string {
  return Number(value || 0).toLocaleString("es-CR");
}

function fmtPct1(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

// Variacion en puntos porcentuales (para tasas: no se compara como % relativo).
function ppDelta(cur: number, prev: number | null): string | null {
  if (prev == null) return null;
  const diff = cur - prev;
  const sign = diff >= 0 ? "+" : "−";
  return `${sign}${Math.abs(diff).toFixed(1)} pp`;
}

// Variacion porcentual relativa (para conteos / volumen / ticket).
function pctDelta(cur: number, prev: number | null): string | null {
  if (prev == null || prev === 0) return null;
  const diff = ((cur - prev) / prev) * 100;
  const sign = diff >= 0 ? "+" : "−";
  return `${sign}${Math.abs(diff).toFixed(0)}%`;
}

function dayDelta(cur: number | null, prev: number | null): string | null {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  const sign = diff >= 0 ? "+" : "−";
  return `${sign}${Math.abs(diff).toFixed(1)} d`;
}

// Color del comparativo: "up" = subir es mejor; "down" = bajar es mejor.
function deltaTone(cur: number | null, prev: number | null, better: "up" | "down"): DeltaTone {
  if (cur == null || prev == null) return "muted";
  const diff = cur - prev;
  if (Math.abs(diff) < 0.05) return "muted";
  const improving = better === "up" ? diff > 0 : diff < 0;
  return improving ? "good" : "bad";
}

function deliveryTone(rate: number): KpiTone {
  return rate >= 70 ? "good" : rate >= 55 ? "warn" : "bad";
}

function dispatchTone(rate: number): KpiTone {
  return rate >= 90 ? "good" : rate >= 75 ? "warn" : "bad";
}

function annulTone(rate: number): KpiTone {
  return rate <= 10 ? "good" : rate <= 20 ? "warn" : "bad";
}

// Fila operativa COD: embudo de izquierda a derecha (volumen -> despacho ->
// entrega -> anulacion -> reparto -> velocidad -> cesta). Cada card lleva valor,
// comparativo vs periodo anterior y semaforo contra meta.
function buildOperationalKpiCards(cur: OpMetrics, prev: OpMetrics | null): KpiCardVM[] {
  const prevLead = prev?.leadAvg ?? null;
  return [
    {
      id: "generated",
      label: "Pedidos generados",
      value: formatInt(cur.generated),
      tone: "neutral",
      deltaLabel: pctDelta(cur.generated, prev?.generated ?? null),
      deltaTone: deltaTone(cur.generated, prev?.generated ?? null, "up"),
      sub: "pedidos creados",
    },
    {
      id: "dispatch",
      label: "Tasa de despacho",
      value: fmtPct1(cur.dispatchRate),
      tone: dispatchTone(cur.dispatchRate),
      deltaLabel: ppDelta(cur.dispatchRate, prev?.dispatchRate ?? null),
      deltaTone: deltaTone(cur.dispatchRate, prev?.dispatchRate ?? null, "up"),
      sub: `${formatInt(cur.dispatched)}/${formatInt(cur.generated)} con guía`,
    },
    {
      id: "delivery",
      label: "Entrega efectiva",
      value: fmtPct1(cur.deliveryRate),
      star: true,
      tone: deliveryTone(cur.deliveryRate),
      deltaLabel: ppDelta(cur.deliveryRate, prev?.deliveryRate ?? null),
      deltaTone: deltaTone(cur.deliveryRate, prev?.deliveryRate ?? null, "up"),
      sub: `${formatInt(cur.delivered)}/${formatInt(cur.dispatched)} despachados - No entr. ${cur.returnRate.toFixed(1)}%`,
    },
    {
      id: "annul",
      label: "Tasa de anulación",
      value: fmtPct1(cur.annulRate),
      tone: annulTone(cur.annulRate),
      deltaLabel: ppDelta(cur.annulRate, prev?.annulRate ?? null),
      deltaTone: deltaTone(cur.annulRate, prev?.annulRate ?? null, "down"),
      sub: `${formatInt(cur.annulled)}/${formatInt(cur.generated)} anulados`,
    },
    {
      id: "wip",
      label: "En reparto",
      value: formatInt(cur.enRoute + cur.enRouteRetry),
      tone: cur.enRouteRetry > 0 ? "warn" : "neutral",
      deltaLabel: null,
      deltaTone: "muted",
      sub: cur.enRouteRetry > 0 ? `${formatInt(cur.enRouteRetry)} en reintento` : "en tránsito ahora",
    },
    {
      id: "lead",
      label: "Lead time entrega",
      value: cur.leadAvg == null ? "—" : `${cur.leadAvg.toFixed(1)} d`,
      tone: "neutral",
      deltaLabel: dayDelta(cur.leadAvg, prevLead),
      deltaTone: deltaTone(cur.leadAvg, prevLead, "down"),
      sub: cur.leadSamples ? `${formatInt(cur.leadSamples)} entregas` : "sin fecha de entrega",
    },
    {
      id: "ticket",
      label: "Ticket promedio",
      value: cur.ticket ? currency(cur.ticket) : "—",
      tone: "neutral",
      deltaLabel: pctDelta(cur.ticket, prev?.ticket ?? null),
      deltaTone: deltaTone(cur.ticket, prev?.ticket ?? null, "up"),
      sub: "valor por pedido",
    },
  ];
}

function OperationalKpiCard({
  label,
  value,
  sub,
  star = false,
  tone = "neutral",
  deltaLabel = null,
  deltaTone: deltaToneValue = "muted",
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  star?: boolean;
  tone?: KpiTone;
  deltaLabel?: string | null;
  deltaTone?: DeltaTone;
  loading?: boolean;
}) {
  const borderClass =
    tone === "good"
      ? "border-emerald-500/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : tone === "bad"
          ? "border-red-500/40"
          : "border-border";
  const valueClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "bad"
          ? "text-red-300"
          : "text-foreground";
  const deltaClass =
    deltaToneValue === "good"
      ? "text-emerald-400"
      : deltaToneValue === "bad"
        ? "text-red-400"
        : "text-muted-foreground";
  return (
    <Card className={borderClass}>
      <CardContent className="p-2.5 sm:p-3">
        <div className="flex items-baseline justify-between gap-1.5">
          <p className="truncate text-[11px] text-muted-foreground">{label}</p>
          <span className="flex shrink-0 items-baseline gap-1">
            {star && <span className="text-[9px] text-primary">★</span>}
            <span className={`text-base font-bold leading-none sm:text-xl ${valueClass}`}>{loading ? "..." : value}</span>
          </span>
        </div>
        {(sub || deltaLabel) && (
          <div className="mt-0.5 flex items-baseline justify-between gap-1.5">
            <p className="truncate text-[10px] leading-tight text-muted-foreground">{sub ?? ""}</p>
            {deltaLabel && !loading && (
              <span className={`shrink-0 text-[10px] font-medium ${deltaClass}`}>{deltaLabel}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertStat({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad" | "muted";
}) {
  const cls =
    tone === "bad"
      ? "border-red-500/40 text-red-200"
      : tone === "warn"
        ? "border-amber-500/40 text-amber-200"
        : "border-border text-muted-foreground";
  return (
    <span className={`inline-flex items-center justify-between gap-1.5 rounded-md border bg-card px-2 py-1 text-[11px] ${cls}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </span>
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
  if (status === "en_route") return <Badge variant="info">{label || "En ruta"}</Badge>;
  if (status === "en_route_retry")
    return (
      <Badge variant="warning" className="border-orange-500/40 bg-orange-500/20 text-orange-300">
        {label || "Reintento"}
      </Badge>
    );
  if (status === "incident") return <Badge variant="destructive">{label || "Incidencia"}</Badge>;
  return <Badge variant="muted">{label || "Pendiente"}</Badge>;
}

function currency(value: number, store = FINANCE_STORES[0]): string {
  return new Intl.NumberFormat(store.locale, {
    style: "currency",
    currency: store.currency,
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

function withStore(path: string, storeCode: FinanceStoreCode): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}store=${encodeURIComponent(storeCode)}`;
}

function buildLiveShopifyOrdersUrl(storeCode: FinanceStoreCode): string {
  return withStore(
    `/api/shopify/orders?status=any&limit=250&created_at_min=${encodeURIComponent(getShopifyCreatedAtMin(storeCode))}`,
    storeCode
  );
}

function getShopifyCreatedAtMin(storeCode: FinanceStoreCode): string {
  return FINANCE_SHOPIFY_CREATED_AT_MIN_BY_STORE[storeCode] ?? FINANCE_SHOPIFY_CREATED_AT_MIN_BY_STORE["mireva-cr"];
}

function getShopifyNotesCreatedAtMin(storeCode: FinanceStoreCode): string {
  const storeMin = new Date(getShopifyCreatedAtMin(storeCode)).getTime();
  const lookbackMin = Date.now() - FINANCE_SHOPIFY_NOTES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Math.max(storeMin, lookbackMin)).toISOString();
}

async function readApiJson(res: Response) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      sanitizeExternalError(
        text,
        `El servidor devolvio una respuesta invalida (${res.status}).`
      )
    );
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = FINANCE_BACKGROUND_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`La solicitud supero ${Math.round(timeoutMs / 1000)}s de espera.`);
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatFinancePageError(error: string): string {
  if (
    error.includes("Could not find the table") ||
    error.includes("schema cache") ||
    (error.includes("store_id") && error.toLowerCase().includes("column"))
  ) {
    return "Faltan tablas financieras en Supabase. Ejecuta supabase/migrations/0002_finance_schema.sql y supabase/migrations/0010_multi_store_finance.sql en SQL Editor.";
  }
  return sanitizeExternalError(error, "Error al cargar finanzas.");
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

// XLSX se carga de forma diferida (solo al exportar) para no sumar la libreria
// al bundle inicial.
async function exportXlsx(
  filename: string,
  rows: Array<Record<string, unknown>>,
  sheetName = "Datos"
) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
    last_name: String(order.last_name ?? ""),
    phone: (order.phone as string | null) ?? null,
    products: lineItems.map((item) => `${item.quantity}x ${item.title}`).join(", "),
    total: `${order.total_price ?? 0} ${order.currency ?? "CRC"}`,
    total_price: Number(order.total_price ?? 0),
    currency: String(order.currency ?? "CRC"),
    financial_status: String(order.financial_status ?? ""),
    fulfillment_status: String(order.fulfillment_status ?? ""),
    cancelled_at: (order.cancelled_at as string | null) ?? null,
    tracking_number: String(order.tracking_number ?? ""),
    tracking_company: String(order.tracking_company ?? ""),
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
  if (filter === "pending") return isPendingLike(order.tracking_status);
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
      store_id: item.store_id,
      file_name: item.file_name,
      file_type: "logistica",
      cutoff_date: item.period_end,
      status: "importado",
      import_id: item.id,
      notes: "",
      imported_at: item.created_at,
      created_at: item.created_at,
      updated_at: item.created_at,
    });
  }
  return Array.from(byName.values()).sort((a, b) =>
    String(b.cutoff_date || b.imported_at || "").localeCompare(String(a.cutoff_date || a.imported_at || ""))
  );
}

function uniqueKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

function mergeProductAnalysisWithCatalog(
  rows: ProductAnalysisRow[],
  products: ShopifyProductOption[]
): ProductAnalysisRow[] {
  const catalogRows = rows.map((row) => {
    const catalogProduct = findCatalogProductForAnalysisRow(row, products);
    if (!catalogProduct) return { ...row, sample_orders: [...row.sample_orders] };
    return {
      ...row,
      product_name: getBetterProductName(row.product_name, catalogProduct.display_name),
      sku: row.sku || catalogProduct.sku || "",
      sample_orders: [...row.sample_orders],
    };
  });
  const merged = consolidateProductAnalysisRows(catalogRows);
  const seenSkus = new Set(merged.map((row) => row.sku.trim().toLowerCase()).filter(Boolean));

  for (const product of products) {
    const sku = String(product.sku || "").trim();
    const skuKey = sku.toLowerCase();
    const titleKey = getProductTitleCostKey(product.display_name);
    if (skuKey && seenSkus.has(skuKey)) continue;

    const compatibleRow = merged.find(
      (row) =>
        !row.sku &&
        row.product_name !== UNKNOWN_PRODUCT_LABEL &&
        areCompatibleProductTitles(row.product_name, product.display_name)
    );
    if (compatibleRow) {
      compatibleRow.sku = sku;
      compatibleRow.product_name = getBetterProductName(compatibleRow.product_name, product.display_name);
      if (skuKey) seenSkus.add(skuKey);
      continue;
    }

    const row = {
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
    };
    merged.push(row);
    if (skuKey) seenSkus.add(skuKey);
  }

  return merged;
}

function consolidateProductAnalysisRows(rows: ProductAnalysisRow[]): ProductAnalysisRow[] {
  const consolidated: ProductAnalysisRow[] = [];
  const bySku = new Map<string, ProductAnalysisRow>();

  for (const row of rows) {
    const skuKey = row.sku.trim().toLowerCase();
    const target =
      (skuKey ? bySku.get(skuKey) : undefined) ??
      consolidated.find((candidate) => canMergeProductAnalysisRows(candidate, row));

    if (!target) {
      const clone = { ...row, sample_orders: [...row.sample_orders] };
      clone.key = getConsolidatedProductAnalysisKey(clone);
      consolidated.push(clone);
      if (clone.sku) bySku.set(clone.sku.trim().toLowerCase(), clone);
      continue;
    }

    mergeProductAnalysisRow(target, row);
    if (target.sku) bySku.set(target.sku.trim().toLowerCase(), target);
  }

  return consolidated.sort(
    (a, b) =>
      b.orders - a.orders ||
      a.delivery_effectiveness - b.delivery_effectiveness ||
      a.product_name.localeCompare(b.product_name)
  );
}

function canMergeProductAnalysisRows(current: ProductAnalysisRow, incoming: ProductAnalysisRow): boolean {
  if (current === incoming) return true;
  if (current.product_name === UNKNOWN_PRODUCT_LABEL || incoming.product_name === UNKNOWN_PRODUCT_LABEL) {
    return current.product_name === incoming.product_name;
  }

  const currentSku = current.sku.trim().toLowerCase();
  const incomingSku = incoming.sku.trim().toLowerCase();
  if (currentSku && incomingSku) return currentSku === incomingSku;
  if (currentSku || incomingSku) {
    return areCompatibleProductTitles(current.product_name, incoming.product_name);
  }
  return areCompatibleProductTitles(current.product_name, incoming.product_name);
}

function mergeProductAnalysisRow(target: ProductAnalysisRow, incoming: ProductAnalysisRow): void {
  target.product_name = getBetterProductName(target.product_name, incoming.product_name);
  if (!target.sku && incoming.sku) target.sku = incoming.sku;
  target.sample_orders = uniqueKeys([...target.sample_orders, ...incoming.sample_orders]).slice(0, 5);
  target.orders += incoming.orders;
  target.units += incoming.units;
  target.dispatched += incoming.dispatched;
  target.delivered += incoming.delivered;
  target.not_delivered += incoming.not_delivered;
  target.annulled += incoming.annulled;
  target.pending += incoming.pending;
  target.dispatch_rate = target.orders ? (target.dispatched / target.orders) * 100 : 0;
  target.delivery_effectiveness = target.dispatched ? (target.delivered / target.dispatched) * 100 : 0;
  target.key = getConsolidatedProductAnalysisKey(target);
}

function getConsolidatedProductAnalysisKey(row: Pick<ProductAnalysisRow, "sku" | "product_name" | "key">): string {
  const sku = row.sku.trim().toLowerCase();
  if (sku) return `sku:${sku}`;
  return getProductTitleCostKey(row.product_name) || row.key;
}

function findCatalogProductForAnalysisRow(
  row: Pick<ProductAnalysisRow, "sku" | "product_name">,
  products: ShopifyProductOption[]
): ShopifyProductOption | undefined {
  const sku = row.sku.trim().toLowerCase();
  if (sku) {
    const bySku = products.find((product) => String(product.sku || "").trim().toLowerCase() === sku);
    if (bySku) return bySku;
  }
  if (row.product_name === UNKNOWN_PRODUCT_LABEL) return undefined;
  return products.find((product) => areCompatibleProductTitles(row.product_name, product.display_name));
}

function areCompatibleProductTitles(a: string, b: string): boolean {
  const left = normalizeComparableProductTitle(a);
  const right = normalizeComparableProductTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length < 28 || longer.length > shorter.length * 1.6) return false;
  return longer.startsWith(shorter);
}

function normalizeComparableProductTitle(value: string): string {
  return cleanProductTitle(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getBetterProductName(current: string, incoming: string): string {
  if (current === UNKNOWN_PRODUCT_LABEL) return incoming;
  if (!incoming || incoming === UNKNOWN_PRODUCT_LABEL) return current;
  return incoming.length > current.length ? incoming : current;
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
  if (filter === "dispatched") return row.dispatched > 0;
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
    dispatched: rows.filter((row) => row.dispatched > 0).length,
    pending: rows.filter((row) => row.pending > 0).length,
    annulled: rows.filter((row) => row.annulled > 0).length,
    delivered: rows.filter((row) => row.delivered > 0).length,
    not_delivered: rows.filter((row) => row.not_delivered > 0).length,
  };
}

function daysSince(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  const diff = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
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

// Nota (Carril 2 inc.2): el filtro de periodo del tab Pedidos (matchesOrderPeriod)
// ahora vive en /api/finance/orders; la tabla pagina server-side.

function getEffectiveTrackingStatus(
  row: Pick<TrackableOrderRow, "source" | "boxful_status" | "internal_status" | "shopify_cancelled_at" | "shopify_financial_status" | "moovin_group" | "moovin_incidents" | "forza_group" | "forza_incidents" | "guide_number">,
  traces: SettlementTrace[]
): string {
  // Moovin manda para sus envios: su ultimo evento define el estado en vivo.
  const moovinStatus = moovinGroupToStatus(row.moovin_group);
  if (moovinStatus) {
    if ((row.moovin_incidents ?? 0) >= 1 && !isFinalTrackingStatus(moovinStatus)) {
      // Hubo "Incidencia en la entrega": si el ultimo evento volvio a "En ruta
      // para entregar" (in_progress -> en_route) es un reintento; si el ultimo
      // evento sigue siendo la incidencia (FAILED -> incident) queda como
      // incidencia activa.
      return moovinStatus === "en_route" ? "en_route_retry" : "incident";
    }
    return moovinStatus;
  }

  const forzaStatus = forzaGroupToStatus(row.forza_group);
  if (forzaStatus) {
    if ((row.forza_incidents ?? 0) >= 1 && !isFinalTrackingStatus(forzaStatus)) {
      return forzaStatus === "en_route" ? "en_route_retry" : "incident";
    }
    return forzaStatus;
  }

  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  const boxfulStatus = inferTrackingStatusFromText(row.boxful_status);
  if (isFinalTrackingStatus(boxfulStatus)) return boxfulStatus;

  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

  // Tiene guia (Boxful, liquidacion o el fulfillment de Shopify) = despachado.
  const hasOperationalMovement = row.source !== "shopify" || traces.length > 0 || Boolean(row.guide_number);
  if (isShopifyCancelled(row) && !hasOperationalMovement) return "annulled";
  // Con guia/courier (movimiento logistico) y sin estado final = en reparto.
  if (hasOperationalMovement) return "en_route";

  return "pending";
}

// "Pendiente operativo" para agregaciones: incluye en ruta (despachado pero
// aun sin entregar) y pendiente (sin despachar).
function isPendingLike(status: string): boolean {
  return (
    status === "pending" ||
    status === "en_route" ||
    status === "en_route_retry" ||
    status === "incident"
  );
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
  if (status === "en_route") return "en_route";
  if (status === "en_route_retry") return "en_route_retry";
  if (status === "incident") return "incident";
  return "pending";
}

function getTrackingStatusLabel(
  row: Pick<TrackableOrderRow, "internal_status" | "boxful_status" | "moovin_incidents" | "forza_incidents">,
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
  if (status === "en_route") return row.boxful_status || "En ruta";
  if (status === "en_route_retry") {
    const retries = Math.max(row.moovin_incidents ?? 0, row.forza_incidents ?? 0, 1);
    return retries > 1 ? `Reintento (${retries})` : "Reintento";
  }
  if (status === "incident") return "Incidencia";
  return "Pendiente";
}

function isFinalTrackingStatus(status: string): boolean {
  return status === "delivered" || status === "not_delivered" || status === "returned";
}

// Mapea el ultimo grupo de Moovin al estado de seguimiento. Vacio si no hay
// dato de Moovin (cae a la logica de Boxful/sistema).
function moovinGroupToStatus(group: string | undefined): string {
  switch (group) {
    case "delivered":
      return "delivered";
    case "returned":
      return "not_delivered";
    case "failed":
      return "incident";
    case "in_progress":
      return "en_route";
    default:
      return "";
  }
}

function forzaGroupToStatus(group: string | undefined): string {
  switch (group) {
    case "delivered":
      return "delivered";
    case "returned":
      return "not_delivered";
    case "failed":
      return "incident";
    case "in_progress":
      return "en_route";
    default:
      return "";
  }
}

// Cuenta las incidencias de entrega ("Incidencia en la entrega", codigo FAILED)
// de Moovin. Con >=1 incidencia sin cierre final: queda como "Incidencia" si el
// ultimo evento sigue siendo la incidencia, o como "Reintento" si el ultimo
// evento volvio a "En ruta para entregar" (ver getEffectiveTrackingStatus).
function countMoovinIncidents(events: MoovinTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter(
    (event) =>
      String(event.code ?? "").toUpperCase() === "FAILED" ||
      String(event.title ?? "").toLowerCase().includes("incidencia en la entrega")
  ).length;
}

function countForzaIncidents(events: ForzaTrackingRow["events"] | undefined): number {
  if (!events?.length) return 0;
  return events.filter((event) => {
    const text = `${event.code ?? ""} ${event.title ?? ""} ${event.description ?? ""}`.toLowerCase();
    return text.includes("fall") || text.includes("incid") || text.includes("no entreg");
  }).length;
}

// Reclasifica el ultimo estado de Moovin corrigiendo cache viejo: "Cancelado"
// (p.ej. supera intentos de entrega) quedaba como en ruta y debe ser No
// entregado. Los demas estados conservan su grupo ya calculado.
function deriveMoovinGroup(row: MoovinTrackingRow | undefined): string {
  if (!row) return "";
  const code = String(row.latest_code ?? "").toUpperCase();
  const title = String(row.latest_status ?? "").toLowerCase();
  if (code.startsWith("CANCEL") || title.includes("cancelado")) return "returned";
  return row.latest_group ?? "";
}

function deriveForzaGroup(row: ForzaTrackingRow | undefined): string {
  if (!row) return "";
  return row.latest_group ?? "";
}

function isShopifyCancelled(
  row: Pick<TrackableOrderRow, "shopify_cancelled_at" | "shopify_financial_status"> | Pick<OrderProfitabilityRow, "shopify_cancelled_at" | "shopify_financial_status">
): boolean {
  return Boolean(row.shopify_cancelled_at || row.shopify_financial_status === "voided");
}
