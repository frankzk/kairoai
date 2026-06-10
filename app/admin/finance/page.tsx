"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  FileSpreadsheet,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "orders" | "settlements" | "costs" | "expenses" | "profit";
type ExpenseType = "ads" | "payroll" | "misc";

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
  shopify_financial_status: string;
  shopify_fulfillment_status: string;
  shopify_cancelled_at: string | null;
  package_items: Array<{ title: string; quantity: number; price: number }>;
}

interface ProductCost {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  active: boolean;
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

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("orders");
  const [imports, setImports] = useState<SettlementImport[]>([]);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [logisticsImports, setLogisticsImports] = useState<LogisticsImport[]>([]);
  const [logisticsRows, setLogisticsRows] = useState<LogisticsRow[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importingLogistics, setImportingLogistics] = useState(false);
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
  const doubleSettlementAnomalies = useMemo(
    () => getDoubleSettlementAnomalies(settlementTraceByKey),
    [settlementTraceByKey]
  );

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [settlementsRes, logisticsRes, costsRes, expensesRes, summaryRes] = await Promise.all([
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

      setImports(settlementsJson.imports ?? []);
      setRows(settlementsJson.rows ?? []);
      setLogisticsImports(logisticsJson.imports ?? []);
      setLogisticsRows(logisticsJson.rows ?? []);
      setCosts(costsJson.costs ?? []);
      setExpenses(expensesJson.expenses ?? []);
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

  async function handleLogisticsImport(event: FormEvent<HTMLFormElement>) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar logistica");
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
    const summaryRes = await fetch("/api/finance/summary", { cache: "no-store" });
    const summaryJson = await readApiJson(summaryRes);
    if (summaryRes.ok) setSummary(summaryJson.summary ?? null);
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
    const effectiveStatuses = logisticsRows.map((row) =>
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
          <MetricCard label="Anomalias" value={String(orderStats.anomalies)} warning />
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
        </div>

        {loading ? (
          <div className="h-80 animate-pulse border border-border bg-card" />
        ) : (
          <>
            {tab === "orders" && (
              <OrdersTab
                logisticsImports={logisticsImports}
                logisticsRows={logisticsRows}
                latestLogisticsImport={latestLogisticsImport}
                settlementTraceByKey={settlementTraceByKey}
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
            {tab === "profit" && <ProfitTab summary={summary} />}
          </>
        )}
      </main>
    </div>
  );
}

function OrdersTab({
  logisticsImports,
  logisticsRows,
  latestLogisticsImport,
  settlementTraceByKey,
  importingLogistics,
  onLogisticsImport,
}: {
  logisticsImports: LogisticsImport[];
  logisticsRows: LogisticsRow[];
  latestLogisticsImport?: LogisticsImport;
  settlementTraceByKey: Map<string, SettlementTrace[]>;
  importingLogistics: boolean;
  onLogisticsImport: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importar Boxful logistico</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onLogisticsImport} className="space-y-3">
              <Input name="file" type="file" accept=".xlsx,.xls" required />
              <Input name="period_label" placeholder="Periodo, ej: 13 marzo - 10 junio" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="period_start" type="date" />
                <Input name="period_end" type="date" />
              </div>
              <Button type="submit" disabled={importingLogistics} className="w-full gap-2">
                {importingLogistics ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importingLogistics ? "Importando..." : "Subir Boxful"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {latestLogisticsImport ? latestLogisticsImport.file_name : "Sin Boxful importado"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniStat label="Filas Boxful" value={latestLogisticsImport?.total_rows ?? 0} />
            <MiniStat label="Match Shopify" value={latestLogisticsImport?.matched_rows ?? 0} />
            <MiniStat label="Sin match" value={latestLogisticsImport?.unmatched_rows ?? 0} />
            <MiniStat label="Pedidos visibles" value={logisticsRows.length} />
          </div>
          <OrdersTable rows={logisticsRows} settlementTraceByKey={settlementTraceByKey} />
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
    </div>
  );
}

function OrdersTable({
  rows,
  settlementTraceByKey,
}: {
  rows: LogisticsRow[];
  settlementTraceByKey: Map<string, SettlementTrace[]>;
}) {
  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[1120px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Orden</th>
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
              <tr key={row.id} className="border-b border-border/50">
                <td className="px-3 py-2 font-mono text-xs">{row.order_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.guide_number}</td>
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
  onSaveProductCost,
  onDelete,
}: {
  costs: ProductCost[];
  products: ShopifyProductOption[];
  productsLoading: boolean;
  productsError: string;
  productSearch: string;
  setProductSearch: (value: string) => void;
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

function ProfitTab({ summary }: { summary: ProfitabilitySummary | null }) {
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

  return (
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
  row: LogisticsRow,
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

function getEffectiveTrackingStatus(row: LogisticsRow, traces: SettlementTrace[]): string {
  if (row.shopify_cancelled_at || row.shopify_financial_status === "voided") return "annulled";
  if (isFinalTrackingStatus(row.internal_status)) return row.internal_status;

  const settlementStatus = traces.find((trace) => isFinalTrackingStatus(trace.internal_status));
  if (settlementStatus) return settlementStatus.internal_status;

  return "pending";
}

function getTrackingStatusLabel(
  row: LogisticsRow,
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
