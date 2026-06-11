"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Database,
  Download,
  FileSpreadsheet,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "orders" | "settlements" | "costs" | "expenses" | "profit" | "monthly" | "files";
type ExpenseType = "ads" | "payroll" | "misc";
type FinancialAnomalySeverity = "high" | "medium" | "low";

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
  amount_to_liquidate: number;
  shopify_order_name: string;
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  order_items: Array<{ sku: string; title: string; quantity: number; price: number }>;
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
  created_at: string;
  line_items: Array<{ sku: string; title: string; quantity: number; price: number }>;
}

interface TrackableOrderRow {
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
  shopify_created_at: string | null;
  package_items: Array<{ sku?: string; title: string; quantity: number; price: number }>;
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
  tracking_status: string;
  tracking_label: string;
  settlement_status: string;
  settlement_files: string[];
  amount_to_liquidate: number;
  expected_cod: number;
  product_cost: number;
  contribution_margin: number;
  missing_cost_skus: string[];
  items_summary: string;
  cash_status: "cobrado" | "por_cobrar" | "sin_caja";
  issue_count: number;
  created_at: string | null;
  days_since_order: number | null;
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
  cash_received: number;
  cash_pending: number;
  product_costs: number;
  ads: number;
  payroll: number;
  misc: number;
  contribution_margin: number;
  net_profit: number;
}

const emptyExpense = {
  type: "ads" as ExpenseType,
  expense_date: new Date().toISOString().slice(0, 10),
  month: new Date().toISOString().slice(0, 7),
  platform: "",
  category: "",
  description: "",
  amount: "",
  notes: "",
};

const FINANCE_SHOPIFY_ORDERS_URL =
  "/api/shopify/orders?status=any&limit=250&created_at_min=2026-03-01T00%3A00%3A00-06%3A00";

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [imports, setImports] = useState<SettlementImport[]>([]);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [logisticsImports, setLogisticsImports] = useState<LogisticsImport[]>([]);
  const [logisticsRows, setLogisticsRows] = useState<LogisticsRow[]>([]);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderSummary[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [costVersions, setCostVersions] = useState<ProductCostVersion[]>([]);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductOption[]>([]);
  const [claims, setClaims] = useState<FinanceClaim[]>([]);
  const [boxfulFiles, setBoxfulFiles] = useState<BoxfulFileControl[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingLogistics, setImportingLogistics] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [boxfulFileForm, setBoxfulFileForm] = useState({
    file_name: "",
    file_type: "liquidacion" as "logistica" | "liquidacion",
    cutoff_date: "",
    status: "esperado" as "esperado" | "importado" | "faltante" | "ignorado",
    notes: "",
  });
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const latestImport = imports[0];
  const latestLogisticsImport = logisticsImports[0];
  const liquidationAlertRows = useMemo(
    () => getDeliveredWithoutSettlement(logisticsRows, rows),
    [logisticsRows, rows]
  );
  const settlementTraceByKey = useMemo(
    () => buildSettlementTraceByKey(rows, imports),
    [rows, imports]
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
    () => buildFinanceControlCenter(visibleOrderRows, rows, imports, costs, costVersions, settlementTraceByKey),
    [visibleOrderRows, rows, imports, costs, costVersions, settlementTraceByKey]
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
        const persistedShopifyRes = await fetch("/api/finance/shopify-sync?limit=5000", { cache: "no-store" });
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
      const persistedShopifyOrders = Array.isArray(persistedShopifyJson.orders)
        ? (persistedShopifyJson.orders as Array<Record<string, unknown>>).map(persistedOrderToSummary)
        : [];
      setShopifyOrders(mergeShopifyOrderSummaries(liveShopifyOrders, persistedShopifyOrders));
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

  async function handleLogisticsImport(event: FormEvent<HTMLFormElement>): Promise<boolean> {
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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar logistica");
      return false;
    } finally {
      setImportingLogistics(false);
    }
  }

  async function saveProductCost(input: {
    sku: string;
    product_name: string;
    unit_cost: number;
    packaging_cost: number;
  }) {
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
    try {
      let nextUrl: string | null = null;
      let totalSynced = 0;
      for (let batch = 0; batch < 8; batch++) {
        const res = await fetch("/api/finance/shopify-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            created_at_min: "2026-03-01T00:00:00-06:00",
            max_pages: 4,
            next_url: nextUrl,
          }),
        });
        const json = await readApiJson(res);
        if (!res.ok) throw new Error(json.error ?? "No se pudo sincronizar Shopify");
        totalSynced += Number(json.synced ?? 0);
        nextUrl = typeof json.next_url === "string" ? json.next_url : null;
        setSyncMessage(`Sincronizados ${totalSynced} pedidos...`);
        if (!nextUrl) break;
      }
      setSyncMessage(`Sync listo: ${totalSynced} pedidos procesados.`);
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

  async function saveBoxfulFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch("/api/finance/boxful-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(boxfulFileForm),
    });
    const json = await readApiJson(res);
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar archivo Boxful");
      return;
    }
    const savedFile = json.file as BoxfulFileControl;
    setBoxfulFiles((current) => [
      savedFile,
      ...current.filter((file) => file.file_name !== savedFile.file_name),
    ]);
    setBoxfulFileForm({
      file_name: "",
      file_type: "liquidacion",
      cutoff_date: "",
      status: "esperado",
      notes: "",
    });
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expenseForm),
    });
    const json = await readApiJson(res);
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar gasto");
      return;
    }
    setExpenseForm({ ...emptyExpense, type: expenseForm.type });
    await refresh();
  }

  async function deleteCost(id: number) {
    await fetch(`/api/finance/product-costs?id=${id}`, { method: "DELETE" });
    await refresh();
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
          <TabButton active={tab === "settlements"} onClick={() => setTab("settlements")} icon={<ReceiptText />}>
            Liquidaciones
          </TabButton>
          <TabButton active={tab === "costs"} onClick={() => setTab("costs")} icon={<Package />}>
            Costos SKU
          </TabButton>
          <TabButton active={tab === "expenses"} onClick={() => setTab("expenses")} icon={<ReceiptText />}>
            Gastos
          </TabButton>
          <TabButton active={tab === "profit"} onClick={() => setTab("profit")} icon={<Banknote />}>
            Rentabilidad
          </TabButton>
          <TabButton active={tab === "monthly"} onClick={() => setTab("monthly")} icon={<FileSpreadsheet />}>
            Cierre mensual
          </TabButton>
          <TabButton active={tab === "files"} onClick={() => setTab("files")} icon={<Database />}>
            Archivos Boxful
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
                syncingShopify={syncingShopify}
                syncMessage={syncMessage}
                onSyncShopify={syncShopifyHistory}
                importingLogistics={importingLogistics}
                onLogisticsImport={handleLogisticsImport}
              />
            )}
            {tab === "settlements" && (
              <SettlementsTab
                imports={imports}
                rows={rows}
                latestImport={latestImport}
                liquidationAlertRows={liquidationAlertRows}
                doubleSettlementAnomalies={doubleSettlementAnomalies}
                importing={importing}
                onImport={handleImport}
              />
            )}
            {tab === "costs" && (
              <CostsTab
                costs={costs}
                products={shopifyProducts}
                productsLoading={productsLoading}
                productsError={productsError}
                productSearch={productSearch}
                setProductSearch={setProductSearch}
                versions={costVersions}
                onSaveProductCost={saveProductCost}
                onDelete={deleteCost}
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
            {tab === "profit" && (
              <ProfitTab
                summary={summary}
                control={financeControl}
                claimByAnomalyKey={claimByAnomalyKey}
                onSaveClaim={saveClaim}
              />
            )}
            {tab === "monthly" && (
              <MonthlyCloseTab rows={monthlyCloseRows} control={financeControl} />
            )}
            {tab === "files" && (
              <BoxfulFilesTab
                files={boxfulFiles}
                imports={imports}
                logisticsImports={logisticsImports}
                form={boxfulFileForm}
                setForm={setBoxfulFileForm}
                onSave={saveBoxfulFile}
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
  syncingShopify: boolean;
  syncMessage: string;
  onSyncShopify: () => void;
  importingLogistics: boolean;
  onLogisticsImport: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
}) {
  const [isLogisticsModalOpen, setIsLogisticsModalOpen] = useState(false);

  async function handleModalLogisticsImport(event: FormEvent<HTMLFormElement>) {
    const didImport = await onLogisticsImport(event);
    if (didImport) setIsLogisticsModalOpen(false);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-base">
              {latestLogisticsImport ? latestLogisticsImport.file_name : "Pedidos Shopify"}
            </CardTitle>
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
              onClick={() => setIsLogisticsModalOpen(true)}
              className="gap-2"
            >
              {importingLogistics ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importingLogistics ? "Importando..." : "Importar Boxful"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <MiniStat label="Pedidos Shopify" value={shopifyOrderCount} />
            <MiniStat label="Filas Boxful" value={latestLogisticsImport?.total_rows ?? 0} />
            <MiniStat label="Match Shopify" value={latestLogisticsImport?.matched_rows ?? 0} />
            <MiniStat label="Sin match" value={latestLogisticsImport?.unmatched_rows ?? 0} />
            <MiniStat label="Pedidos visibles" value={rows.length} />
          </div>
          <OrdersTable rows={rows} settlementTraceByKey={settlementTraceByKey} />
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
                onClick={() => setIsLogisticsModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={handleModalLogisticsImport} className="space-y-3">
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
                  onClick={() => setIsLogisticsModalOpen(false)}
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
}: {
  rows: TrackableOrderRow[];
  settlementTraceByKey: Map<string, SettlementTrace[]>;
}) {
  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Origen</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Estado seguimiento</th>
            <th className="px-3 py-2">Shopify</th>
            <th className="px-3 py-2">Estado liquidacion</th>
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
                  <SettlementTraceBadge traces={traces} />
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
        </tbody>
      </table>
    </div>
  );
}

function SettlementsTab({
  imports,
  rows,
  latestImport,
  liquidationAlertRows,
  doubleSettlementAnomalies,
  importing,
  onImport,
}: {
  imports: SettlementImport[];
  rows: SettlementRow[];
  latestImport?: SettlementImport;
  liquidationAlertRows: LogisticsRow[];
  doubleSettlementAnomalies: DoubleSettlementAnomaly[];
  importing: boolean;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const fileByImportId = useMemo(
    () => new Map(imports.map((item) => [item.id, item.file_name])),
    [imports]
  );

  return (
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {latestImport ? latestImport.file_name : "Sin liquidaciones importadas"}
          </CardTitle>
          {latestImport?.file_name && (
            <p className="text-xs text-muted-foreground">
              Archivo registrado en Boxful: {latestImport.file_name}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <MiniStat label="Corte" value={latestImport?.period_end ? formatDate(latestImport.period_end) : "-"} />
            <MiniStat label="Filas" value={latestImport?.total_rows ?? 0} />
            <MiniStat label="Match Shopify" value={latestImport?.matched_rows ?? 0} />
            <MiniStat label="Sin match" value={latestImport?.unmatched_rows ?? 0} />
            <MiniStat label="A liquidar" value={currency(latestImport?.total_to_liquidate ?? 0)} />
          </div>
          {liquidationAlertRows.length > 0 && (
            <div className="border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-semibold">Entregados sin liquidacion</span>
                </div>
                <Badge variant="warning">{liquidationAlertRows.length} por reclamar</Badge>
              </div>
              <ClaimAlertsTable rows={liquidationAlertRows} />
            </div>
          )}
          {doubleSettlementAnomalies.length > 0 && (
            <div className="border border-red-500/40 bg-red-500/10 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-red-100">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-semibold">Doble liquidacion detectada</span>
                </div>
                <Badge variant="destructive">{doubleSettlementAnomalies.length} anomalias</Badge>
              </div>
              <DoubleSettlementTable anomalies={doubleSettlementAnomalies} />
            </div>
          )}
          <SettlementRowsTable rows={rows} fileByImportId={fileByImportId} />
          {imports.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Historial de liquidaciones</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {imports.slice(0, 6).map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-3">
                    <span className="truncate" title={item.file_name}>{item.file_name}</span>
                    <span>{item.period_end ? formatDate(item.period_end) : "Sin corte"}</span>
                    <span>{currency(item.total_to_liquidate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettlementRowsTable({
  rows,
  fileByImportId,
}: {
  rows: SettlementRow[];
  fileByImportId: Map<number, string>;
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
        </tbody>
      </table>
    </div>
  );
}

function SettlementTraceBadge({ traces }: { traces: SettlementTrace[] }) {
  if (!traces.length) {
    return <Badge variant="muted">Sin liquidacion</Badge>;
  }

  const [firstTrace, ...extraTraces] = traces;
  return (
    <div className="max-w-[260px] space-y-1">
      <div className="truncate text-xs font-medium" title={firstTrace.file_name}>
        {firstTrace.file_name}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="success">{currency(firstTrace.amount_to_liquidate)}</Badge>
        {firstTrace.settlement_status && <Badge variant="muted">{firstTrace.settlement_status}</Badge>}
        {extraTraces.length > 0 && <Badge variant="warning">+{extraTraces.length}</Badge>}
      </div>
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
                      {trace.file_name} · {trace.settlement_status || "sin estado"} · {currency(trace.amount_to_liquidate)}
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
  onDelete,
}: {
  costs: ProductCost[];
  products: ShopifyProductOption[];
  productsLoading: boolean;
  productsError: string;
  productSearch: string;
  setProductSearch: (value: string) => void;
  versions: ProductCostVersion[];
  onSaveProductCost: (input: {
    sku: string;
    product_name: string;
    unit_cost: number;
    packaging_cost: number;
  }) => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const costBySku = useMemo(
    () => new Map(costs.map((cost) => [cost.sku.toLowerCase(), cost])),
    [costs]
  );
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter(
      (product) =>
        product.display_name.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query)
    );
  }, [productSearch, products]);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Productos Shopify</CardTitle>
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
            <div className="max-h-[360px] overflow-auto border border-border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Precio Shopify</th>
                    <th className="px-3 py-2">Costo unitario</th>
                    <th className="px-3 py-2">Empaque</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {productsLoading ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Cargando productos Shopify...
                      </td>
                    </tr>
                  ) : filteredProducts.length ? (
                    filteredProducts.slice(0, 250).map((product) => {
                      const savedCost = product.sku ? costBySku.get(product.sku.toLowerCase()) : undefined;
                      return (
                        <tr key={product.variant_id} className="border-t border-border/50">
                          <td className="px-3 py-2">{product.display_name}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {product.sku || <span className="text-amber-300">Sin SKU</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{currency(product.price)}</td>
                          <td className="px-3 py-2">
                            <InlineCostEditor
                              product={product}
                              savedCost={savedCost}
                              field="unit_cost"
                              disabled={!product.sku}
                              onSave={onSaveProductCost}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <InlineCostEditor
                              product={product}
                              savedCost={savedCost}
                              field="packaging_cost"
                              disabled={!product.sku}
                              onSave={onSaveProductCost}
                            />
                          </td>
                          <td className="px-3 py-2">
                            {!product.sku ? (
                              <Badge variant="warning">Sin SKU</Badge>
                            ) : savedCost ? (
                              <Badge variant="success">Guardado</Badge>
                            ) : (
                              <Badge variant="warning">Sin costo</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No hay productos para mostrar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">SKUs con costo guardado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2 text-right">Unitario</th>
                    <th className="px-3 py-2 text-right">Empaque</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {costs.map((cost) => (
                    <tr key={cost.id} className="border-t border-border/50">
                      <td className="px-3 py-2 font-mono text-xs">{cost.sku}</td>
                      <td className="px-3 py-2">{cost.product_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{currency(cost.unit_cost)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{currency(cost.packaging_cost)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => onDelete(cost.id)} className="text-muted-foreground hover:text-red-400">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historial de costos SKU</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-auto border border-border">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Fecha efectiva</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2 text-right">Unitario</th>
                    <th className="px-3 py-2 text-right">Empaque</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.slice(0, 300).map((version) => (
                    <tr key={`${version.id}-${version.created_at}`} className="border-t border-border/50">
                      <td className="px-3 py-2 font-mono text-xs">{formatDate(version.effective_from)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{version.sku}</td>
                      <td className="px-3 py-2">{version.product_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{currency(version.unit_cost)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{currency(version.packaging_cost)}</td>
                    </tr>
                  ))}
                  {!versions.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        Aun no hay versiones registradas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InlineCostEditor({
  product,
  savedCost,
  field,
  disabled,
  onSave,
}: {
  product: ShopifyProductOption;
  savedCost?: ProductCost;
  field: "unit_cost" | "packaging_cost";
  disabled: boolean;
  onSave: (input: {
    sku: string;
    product_name: string;
    unit_cost: number;
    packaging_cost: number;
  }) => Promise<void>;
}) {
  const initialValue =
    field === "unit_cost" ? savedCost?.unit_cost ?? 0 : savedCost?.packaging_cost ?? 0;
  const [value, setValue] = useState(String(initialValue || ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(String(initialValue || ""));
  }, [initialValue]);

  async function persist() {
    if (disabled || !product.sku) return;
    const numericValue = Number(value || 0);
    const currentValue = field === "unit_cost" ? savedCost?.unit_cost ?? 0 : savedCost?.packaging_cost ?? 0;
    if (numericValue === currentValue && savedCost) return;

    setSaving(true);
    setSaved(false);
    try {
      await onSave({
        sku: product.sku,
        product_name: product.display_name,
        unit_cost: field === "unit_cost" ? numericValue : savedCost?.unit_cost ?? 0,
        packaging_cost: field === "packaging_cost" ? numericValue : savedCost?.packaging_cost ?? 0,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min="0"
        step="1"
        disabled={disabled || saving}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={persist}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="h-8 w-28 px-2 text-right font-mono text-xs"
        placeholder="0"
      />
      {saving && <span className="text-xs text-muted-foreground">Guardando</span>}
      {saved && <span className="text-xs text-emerald-300">OK</span>}
    </div>
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
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar gasto</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-3">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ExpenseType })}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="ads">Ads</option>
              <option value="payroll">Planilla</option>
              <option value="misc">Varios</option>
            </select>
            <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
            <Input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
            <Input placeholder="Plataforma / proveedor" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} />
            <Input placeholder="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <Input placeholder="Descripcion" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input type="number" placeholder="Monto" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            <Button type="submit" className="w-full gap-2">
              <Plus className="h-4 w-4" /> Guardar gasto
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gastos registrados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto border border-border">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2">Descripcion</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-t border-border/50">
                    <td className="px-3 py-2"><Badge variant="muted">{expense.type}</Badge></td>
                    <td className="px-3 py-2 font-mono text-xs">{expense.expense_date}</td>
                    <td className="px-3 py-2 font-mono text-xs">{expense.month}</td>
                    <td className="px-3 py-2">{expense.description || expense.category || expense.platform}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(expense.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => onDelete(expense.id)} className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfitTab({
  summary,
  control,
  claimByAnomalyKey,
  onSaveClaim,
}: {
  summary: ProfitabilitySummary | null;
  control: FinanceControlCenter;
  claimByAnomalyKey: Map<string, FinanceClaim>;
  onSaveClaim: (anomaly: FinancialAnomaly, status: FinanceClaim["status"], notes?: string) => void;
}) {
  const items = [
    ["COD cobrado", summary?.cod_collected ?? 0],
    ["Costos cobrados en liquidacion", -(summary?.settlement_charged_costs ?? 0)],
    ["A liquidar neto", summary?.settlement_total ?? 0],
    ["Costo producto", -(summary?.product_costs ?? 0)],
    ["Ads", -(summary?.ads ?? 0)],
    ["Planilla", -(summary?.payroll ?? 0)],
    ["Gastos varios", -(summary?.misc ?? 0)],
    ["Utilidad neta", summary?.net_profit ?? 0],
  ];
  const criticalAnomalies = control.anomalies.filter((anomaly) => anomaly.severity === "high").length;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-4">
        <MiniStat label="Caja liquidada" value={currency(control.cash_received)} />
        <MiniStat label="Caja por reclamar" value={currency(control.cash_pending)} />
        <MiniStat label="Margen pedido" value={currency(control.contribution_margin)} />
        <MiniStat label="Alertas criticas" value={criticalAnomalies} />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("anomalias-financieras.csv", control.anomalies)}>
          <Download className="h-4 w-4" /> Exportar anomalias
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("rentabilidad-pedidos.csv", control.orders)}>
          <Download className="h-4 w-4" /> Exportar pedidos
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Formula de utilidad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="border border-border bg-background p-3 text-xs text-muted-foreground">
              Los costos de entrega, Pick&Pack, empaque y comisiones vienen de la liquidacion.
              Ya estan incluidos dentro de `A liquidar`, asi que se muestran como desglose y no se restan dos veces.
            </div>
            {items.map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between border-b border-border/50 py-3">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className={`font-mono text-sm ${Number(value) < 0 ? "text-red-300" : "text-foreground"}`}>
                  {currency(Number(value))}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desglose liquidacion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <BreakdownLine label="Comision COD" value={summary?.cod_commission ?? 0} />
            <BreakdownLine label="Comision tarjeta" value={summary?.card_commission ?? 0} />
            <BreakdownLine label="Costo entrega" value={summary?.delivery_cost ?? 0} />
            <BreakdownLine label="Pick&Pack" value={summary?.pick_pack_cost ?? 0} />
            <BreakdownLine label="Empaque liquidacion" value={summary?.settlement_packaging_cost ?? 0} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Centro de anomalias</CardTitle>
        </CardHeader>
        <CardContent>
          <FinancialAnomaliesTable
            anomalies={control.anomalies}
            claimByAnomalyKey={claimByAnomalyKey}
            onSaveClaim={onSaveClaim}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rentabilidad por pedido</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderProfitabilityTable rows={control.orders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SKUs sin costo</CardTitle>
        </CardHeader>
        <CardContent>
          {summary?.missing_cost_skus?.length ? (
            <div className="flex flex-wrap gap-2">
              {summary.missing_cost_skus.slice(0, 40).map((sku) => (
                <Badge key={sku} variant="warning">{sku}</Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hay SKUs pendientes de costo.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
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

function OrderProfitabilityTable({ rows }: { rows: OrderProfitabilityRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No hay pedidos para calcular rentabilidad.</p>;
  }

  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1260px] text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Seguimiento</th>
            <th className="px-3 py-2">Caja</th>
            <th className="px-3 py-2">Liquidacion</th>
            <th className="px-3 py-2 text-right">A liquidar</th>
            <th className="px-3 py-2 text-right">Costo producto</th>
            <th className="px-3 py-2 text-right">Margen</th>
            <th className="px-3 py-2">SKUs</th>
            <th className="px-3 py-2">Archivo</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row) => (
            <tr key={row.order_key} className="border-t border-border/50">
              <td className="px-3 py-2">
                <div className="font-mono text-xs">{row.order_name || "-"}</div>
                <div className="text-xs text-muted-foreground">{row.guide_number || row.source}</div>
              </td>
              <td className="px-3 py-2">{row.customer_name || "Sin nombre"}</td>
              <td className="px-3 py-2">
                <StatusBadge status={row.tracking_status} label={row.tracking_label} />
              </td>
              <td className="px-3 py-2">
                <Badge
                  variant={
                    row.cash_status === "cobrado"
                      ? "success"
                      : row.cash_status === "por_cobrar"
                        ? "warning"
                        : "muted"
                  }
                >
                  {row.cash_status === "cobrado" ? "Liquidado" : row.cash_status === "por_cobrar" ? "Por cobrar" : "Sin caja"}
                </Badge>
              </td>
              <td className="px-3 py-2">{row.settlement_status}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.amount_to_liquidate)}</td>
              <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.product_cost)}</td>
              <td className={`px-3 py-2 text-right font-mono text-xs ${row.contribution_margin < 0 ? "text-red-300" : "text-emerald-300"}`}>
                {currency(row.contribution_margin)}
              </td>
              <td className="px-3 py-2 text-xs">
                {row.missing_cost_skus.length ? (
                  <div className="flex flex-wrap gap-1">
                    {row.missing_cost_skus.slice(0, 3).map((sku) => (
                      <Badge key={sku} variant="warning">{sku}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">{row.items_summary || "-"}</span>
                )}
              </td>
              <td className="max-w-[260px] truncate px-3 py-2 text-xs text-muted-foreground" title={row.settlement_files.join(", ")}>
                {row.settlement_files.join(", ") || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 500 && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Mostrando 500 de {rows.length} pedidos.
        </div>
      )}
    </div>
  );
}

function MonthlyCloseTab({
  rows,
  control,
}: {
  rows: MonthlyCloseRow[];
  control: FinanceControlCenter;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Cierre mensual</h2>
          <p className="text-xs text-muted-foreground">
            Vista devengada por mes: caja, costos, gastos y utilidad estimada.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("cierre-mensual.csv", rows)}>
          <Download className="h-4 w-4" /> Exportar cierre
        </Button>
      </div>
      <section className="grid gap-3 md:grid-cols-3">
        <MiniStat label="Pedidos analizados" value={control.orders.length} />
        <MiniStat label="Caja por reclamar" value={currency(control.cash_pending)} />
        <MiniStat label="Margen antes de gastos" value={currency(control.contribution_margin)} />
      </section>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto border border-border">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Mes</th>
                  <th className="px-3 py-2 text-right">Pedidos</th>
                  <th className="px-3 py-2 text-right">Entregados</th>
                  <th className="px-3 py-2 text-right">No entregados</th>
                  <th className="px-3 py-2 text-right">Anulados</th>
                  <th className="px-3 py-2 text-right">Liquidado</th>
                  <th className="px-3 py-2 text-right">Por reclamar</th>
                  <th className="px-3 py-2 text-right">Costo producto</th>
                  <th className="px-3 py-2 text-right">Ads</th>
                  <th className="px-3 py-2 text-right">Planilla</th>
                  <th className="px-3 py-2 text-right">Varios</th>
                  <th className="px-3 py-2 text-right">Utilidad neta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month} className="border-t border-border/50">
                    <td className="px-3 py-2 font-mono text-xs">{row.month}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{row.orders}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{row.delivered}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{row.not_delivered}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{row.annulled}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.cash_received)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.cash_pending)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.product_costs)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.ads)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.payroll)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{currency(row.misc)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${row.net_profit < 0 ? "text-red-300" : "text-emerald-300"}`}>
                      {currency(row.net_profit)}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No hay datos suficientes para cierre mensual.
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

function BoxfulFilesTab({
  files,
  imports,
  logisticsImports,
  form,
  setForm,
  onSave,
}: {
  files: BoxfulFileControl[];
  imports: SettlementImport[];
  logisticsImports: LogisticsImport[];
  form: {
    file_name: string;
    file_type: "logistica" | "liquidacion";
    cutoff_date: string;
    status: "esperado" | "importado" | "faltante" | "ignorado";
    notes: string;
  };
  setForm: (form: {
    file_name: string;
    file_type: "logistica" | "liquidacion";
    cutoff_date: string;
    status: "esperado" | "importado" | "faltante" | "ignorado";
    notes: string;
  }) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const mergedFiles = useMemo(
    () => mergeBoxfulFiles(files, imports, logisticsImports),
    [files, imports, logisticsImports]
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registrar archivo Boxful</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-3">
            <Input
              value={form.file_name}
              onChange={(event) => setForm({ ...form, file_name: event.target.value })}
              placeholder="Nombre exacto del archivo"
              required
            />
            <select
              value={form.file_type}
              onChange={(event) => setForm({ ...form, file_type: event.target.value as "logistica" | "liquidacion" })}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="liquidacion">Liquidacion</option>
              <option value="logistica">Logistica</option>
            </select>
            <Input
              type="date"
              value={form.cutoff_date}
              onChange={(event) => setForm({ ...form, cutoff_date: event.target.value })}
            />
            <select
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value as BoxfulFileControl["status"] })}
              className="h-10 w-full border border-input bg-background px-3 text-sm"
            >
              <option value="esperado">Esperado</option>
              <option value="faltante">Faltante</option>
              <option value="importado">Importado</option>
              <option value="ignorado">Ignorado</option>
            </select>
            <Input
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Notas"
            />
            <Button type="submit" className="w-full gap-2">
              <Plus className="h-4 w-4" /> Guardar archivo
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Control de archivos</CardTitle>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCsv("archivos-boxful.csv", mergedFiles)}>
              <Download className="h-4 w-4" /> Exportar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[620px] overflow-auto border border-border">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Archivo</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Corte</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Import ID</th>
                  <th className="px-3 py-2">Notas</th>
                </tr>
              </thead>
              <tbody>
                {mergedFiles.map((file) => (
                  <tr key={`${file.file_type}-${file.file_name}`} className="border-t border-border/50">
                    <td className="max-w-[360px] truncate px-3 py-2" title={file.file_name}>{file.file_name}</td>
                    <td className="px-3 py-2"><Badge variant="muted">{file.file_type}</Badge></td>
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
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No hay archivos registrados.
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
  const lineItems = (order.line_items as ShopifyOrderSummary["line_items"]) ?? [];
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
    created_at: String(order.shopify_created_at ?? ""),
    line_items: lineItems,
  };
}

function mergeShopifyOrderSummaries(
  liveOrders: ShopifyOrderSummary[],
  persistedOrders: ShopifyOrderSummary[]
): ShopifyOrderSummary[] {
  const byKey = new Map<string, ShopifyOrderSummary>();
  for (const order of persistedOrders) byKey.set(order.id || order.name, order);
  for (const order of liveOrders) byKey.set(order.id || order.name, order);
  return Array.from(byKey.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
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
      cash_received: 0,
      cash_pending: 0,
      product_costs: 0,
      ads: 0,
      payroll: 0,
      misc: 0,
      contribution_margin: 0,
      net_profit: 0,
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
    if (order.cash_status === "cobrado") row.cash_received += order.amount_to_liquidate;
    if (order.cash_status === "por_cobrar") row.cash_pending += order.expected_cod;
    row.product_costs += order.product_cost;
    row.contribution_margin += order.contribution_margin;
  }

  for (const expense of expenses) {
    const month = expense.month || getMonthKey(expense.expense_date) || "sin-fecha";
    const row = ensureMonth(month);
    if (expense.type === "ads") row.ads += Number(expense.amount || 0);
    if (expense.type === "payroll") row.payroll += Number(expense.amount || 0);
    if (expense.type === "misc") row.misc += Number(expense.amount || 0);
  }

  return Array.from(byMonth.values())
    .map((row) => ({
      ...row,
      cash_received: roundMoney(row.cash_received),
      cash_pending: roundMoney(row.cash_pending),
      product_costs: roundMoney(row.product_costs),
      ads: roundMoney(row.ads),
      payroll: roundMoney(row.payroll),
      misc: roundMoney(row.misc),
      contribution_margin: roundMoney(row.contribution_margin),
      net_profit: roundMoney(row.contribution_margin - row.ads - row.payroll - row.misc),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function getMonthKey(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 7);
}

function mergeBoxfulFiles(
  files: BoxfulFileControl[],
  imports: SettlementImport[],
  logisticsImports: LogisticsImport[]
): BoxfulFileControl[] {
  const byName = new Map<string, BoxfulFileControl>();
  for (const file of files) byName.set(file.file_name, file);
  for (const item of imports) {
    if (byName.has(item.file_name)) continue;
    byName.set(item.file_name, {
      id: -item.id,
      file_name: item.file_name,
      file_type: "liquidacion",
      cutoff_date: item.period_end,
      status: "importado",
      import_id: item.id,
      notes: "",
      imported_at: item.created_at,
    });
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
  const existingKeys = new Set<string>();
  const logisticsDisplayRows = logisticsRows.map((row) => {
    for (const key of getOrderMatchKeys(row)) existingKeys.add(key);
    return {
      ...row,
      row_key: `boxful-${row.id}`,
      source: "boxful" as const,
    };
  });

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
      shopify_created_at: order.created_at,
      package_items: (order.line_items ?? []).map((item) => ({
        sku: item.sku,
        title: `${item.quantity}x ${item.title}`,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
      })),
    }));

  return [...logisticsDisplayRows, ...shopifyOnlyRows].sort((a, b) =>
    String(b.shopify_created_at || "").localeCompare(String(a.shopify_created_at || ""))
  );
}

function getOrderMatchKeys(row: Pick<TrackableOrderRow, "order_name" | "shopify_order_name" | "shopify_order_number">): string[] {
  return uniqueKeys([
    normalizeMatchKey(row.order_name),
    normalizeMatchKey(row.shopify_order_name),
    row.shopify_order_number ? normalizeMatchKey(String(row.shopify_order_number)) : "",
    row.shopify_order_number ? normalizeMatchKey(`#MCRC${row.shopify_order_number}`) : "",
  ]);
}

function getShopifyOrderMatchKeys(order: ShopifyOrderSummary): string[] {
  return uniqueKeys([
    normalizeMatchKey(order.name),
    normalizeMatchKey(String(order.order_number ?? "")),
    normalizeMatchKey(`#MCRC${order.order_number ?? ""}`),
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
  const expectedCod = order.cod_amount || sum(settlementRows.map((row) => row.cod_amount));
  const items = getProfitabilityItems(order, settlementRows);
  const productCostResult = calculateProductCost(items, costVersionsBySku, trackingStatus, order.shopify_created_at);
  const hasSettlement = settlementRows.length > 0;
  const cashStatus =
    hasSettlement ? "cobrado" : trackingStatus === "delivered" ? "por_cobrar" : "sin_caja";

  const issueCount =
    (trackingStatus === "delivered" && !hasSettlement ? 1 : 0) +
    (settlementRows.length > 1 ? 1 : 0) +
    (productCostResult.missingCostSkus.length ? 1 : 0) +
    (hasSettlement && amountToLiquidate - productCostResult.productCost < 0 ? 1 : 0);

  return {
    order_key: order.row_key,
    order_name: order.order_name || order.shopify_order_name,
    guide_number: order.guide_number,
    customer_name: order.customer_name,
    source: order.source,
    tracking_status: trackingStatus,
    tracking_label: trackingLabel,
    settlement_status: settlementStatuses.join(", ") || "Sin liquidacion",
    settlement_files: settlementFiles,
    amount_to_liquidate: roundMoney(amountToLiquidate),
    expected_cod: roundMoney(expectedCod),
    product_cost: productCostResult.productCost,
    contribution_margin: roundMoney(amountToLiquidate - productCostResult.productCost),
    missing_cost_skus: productCostResult.missingCostSkus,
    items_summary: summarizeItems(items),
    cash_status: cashStatus,
    issue_count: issueCount,
    created_at: order.shopify_created_at,
    days_since_order: order.shopify_created_at ? daysSince(order.shopify_created_at) : null,
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
    shopify_created_at: null,
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
    const sku = String(item.sku ?? "").trim().toLowerCase();
    if (!sku) continue;
    const cost = pickCostVersion(costVersionsBySku.get(sku) ?? [], orderDate);
    if (!cost) {
      missingCostSkus.add(sku);
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

  if (row.tracking_status === "annulled" && hasSettlement) {
    anomalies.push({
      id: `${row.order_key}-annulled-settled`,
      severity: "high",
      type: "Anulado con liquidacion",
      order_name: row.order_name,
      guide_number: row.guide_number,
      amount: row.amount_to_liquidate,
      source_file: sourceFile,
      message: "Shopify indica anulado/cancelado, pero el pedido aparece liquidado.",
      action: "Revisar si el pedido se despacho por error o si Shopify esta desactualizado.",
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

  if (hasSettlement && row.contribution_margin < 0) {
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
  row: Pick<TrackableOrderRow, "order_name" | "shopify_order_name" | "guide_number">,
  settlementTraceByKey: Map<string, SettlementTrace[]>
): SettlementTrace[] {
  const seen = new Set<string>();
  const traces: SettlementTrace[] = [];
  const keys = [
    normalizeMatchKey(row.order_name || row.shopify_order_name),
    normalizeMatchKey(row.guide_number),
  ];

  for (const key of keys) {
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

function getEffectiveTrackingStatus(
  row: Pick<TrackableOrderRow, "internal_status" | "shopify_cancelled_at" | "shopify_financial_status">,
  traces: SettlementTrace[]
): string {
  if (row.shopify_cancelled_at || row.shopify_financial_status === "voided") return "annulled";
  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

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
