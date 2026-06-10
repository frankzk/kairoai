"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  FileSpreadsheet,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "orders" | "costs" | "expenses" | "profit";
type ExpenseType = "ads" | "payroll" | "misc";

interface SettlementImport {
  id: number;
  file_name: string;
  period_label: string;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  total_to_liquidate: number;
  created_at: string;
}

interface SettlementRow {
  id: number;
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

interface ProductCost {
  id: number;
  sku: string;
  product_name: string;
  unit_cost: number;
  packaging_cost: number;
  currency: string;
  active: boolean;
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

const emptyCost = {
  sku: "",
  product_name: "",
  unit_cost: "",
  packaging_cost: "0",
};

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
  const [costs, setCosts] = useState<ProductCost[]>([]);
  const [expenses, setExpenses] = useState<BusinessExpense[]>([]);
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [costForm, setCostForm] = useState(emptyCost);
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const latestImport = imports[0];

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [settlementsRes, costsRes, expensesRes, summaryRes] = await Promise.all([
        fetch("/api/finance/settlements", { cache: "no-store" }),
        fetch("/api/finance/product-costs", { cache: "no-store" }),
        fetch("/api/finance/expenses", { cache: "no-store" }),
        fetch("/api/finance/summary", { cache: "no-store" }),
      ]);

      const settlementsJson = await settlementsRes.json();
      const costsJson = await costsRes.json();
      const expensesJson = await expensesRes.json();
      const summaryJson = await summaryRes.json();

      setImports(settlementsJson.imports ?? []);
      setRows(settlementsJson.rows ?? []);
      setCosts(costsJson.costs ?? []);
      setExpenses(expensesJson.expenses ?? []);
      setSummary(summaryJson.summary ?? null);

      const firstError =
        settlementsJson.error ?? costsJson.error ?? expensesJson.error ?? summaryJson.error;
      if (firstError) setError(firstError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando gestion financiera");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo importar");
      form.reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar");
    } finally {
      setImporting(false);
    }
  }

  async function saveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch("/api/finance/product-costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(costForm),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "No se pudo guardar costo");
      return;
    }
    setCostForm(emptyCost);
    await refresh();
  }

  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const res = await fetch("/api/finance/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expenseForm),
    });
    const json = await res.json();
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
    return {
      delivered: rows.filter((row) => row.internal_status === "delivered").length,
      notDelivered: rows.filter((row) => row.internal_status === "not_delivered").length,
      unmatched: rows.filter((row) => row.match_status === "unmatched").length,
      total: money(rows.reduce((acc, row) => acc + Number(row.amount_to_liquidate || 0), 0)),
    };
  }, [rows]);

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
          <Button variant="outline" size="sm" onClick={refresh} className="ml-auto gap-2">
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

        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="A liquidar" value={currency(summary?.settlement_total ?? orderStats.total)} />
          <MetricCard label="Entregados" value={String(summary?.delivered_orders ?? orderStats.delivered)} />
          <MetricCard label="No entregados" value={String(summary?.not_delivered_orders ?? orderStats.notDelivered)} />
          <MetricCard label="Utilidad neta" value={currency(summary?.net_profit ?? 0)} accent />
        </section>

        <div className="flex gap-2 overflow-x-auto border-b border-border">
          <TabButton active={tab === "orders"} onClick={() => setTab("orders")} icon={<FileSpreadsheet />}>
            Pedidos
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
                imports={imports}
                rows={rows}
                latestImport={latestImport}
                importing={importing}
                onImport={handleImport}
              />
            )}
            {tab === "costs" && (
              <CostsTab
                costs={costs}
                form={costForm}
                setForm={setCostForm}
                onSave={saveCost}
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
  imports,
  rows,
  latestImport,
  importing,
  onImport,
}: {
  imports: SettlementImport[];
  rows: SettlementRow[];
  latestImport?: SettlementImport;
  importing: boolean;
  onImport: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Importar liquidacion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onImport} className="space-y-3">
            <Input name="file" type="file" accept=".xlsx,.xls" required />
            <Input name="period_label" placeholder="Semana o periodo, ej: 3-9 junio" />
            <div className="grid grid-cols-2 gap-2">
              <Input name="period_start" type="date" />
              <Input name="period_end" type="date" />
            </div>
            <Button type="submit" disabled={importing} className="w-full gap-2">
              {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Importando..." : "Subir Excel"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {latestImport ? latestImport.file_name : "Sin liquidaciones importadas"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <MiniStat label="Filas" value={latestImport?.total_rows ?? 0} />
            <MiniStat label="Match" value={latestImport?.matched_rows ?? 0} />
            <MiniStat label="Sin match" value={latestImport?.unmatched_rows ?? 0} />
            <MiniStat label="A liquidar" value={currency(latestImport?.total_to_liquidate ?? 0)} />
          </div>
          <OrdersTable rows={rows} />
          {imports.length > 1 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Historial de imports</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {imports.slice(0, 6).map((item) => (
                  <div key={item.id} className="flex justify-between gap-3">
                    <span>{item.file_name}</span>
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

function OrdersTable({ rows }: { rows: SettlementRow[] }) {
  return (
    <div className="max-h-[620px] overflow-auto border border-border">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">Orden</th>
            <th className="px-3 py-2">Guia</th>
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Shopify</th>
            <th className="px-3 py-2">Items</th>
            <th className="px-3 py-2 text-right">A liquidar</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((row) => (
            <tr key={row.id} className="border-b border-border/50">
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
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {(row.order_items ?? []).slice(0, 2).map((item) => item.sku || item.title).join(", ") || "-"}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs">
                {currency(row.amount_to_liquidate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostsTab({
  costs,
  form,
  setForm,
  onSave,
  onDelete,
}: {
  costs: ProductCost[];
  form: typeof emptyCost;
  setForm: (form: typeof emptyCost) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Costo por SKU</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-3">
            <Input placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
            <Input placeholder="Producto" value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
            <Input type="number" placeholder="Costo unitario" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} required />
            <Input type="number" placeholder="Costo empaque" value={form.packaging_cost} onChange={(e) => setForm({ ...form, packaging_cost: e.target.value })} />
            <Button type="submit" className="w-full gap-2">
              <Plus className="h-4 w-4" /> Guardar costo
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Costos activos</CardTitle>
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
    ["Resultado logistico", summary?.settlement_total ?? 0],
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

function MetricCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary/40" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={accent ? "mt-2 text-2xl font-bold text-primary" : "mt-2 text-2xl font-bold"}>
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
  if (status === "not_delivered") return <Badge variant="destructive">{label || "No entregado"}</Badge>;
  if (status === "unmatched") return <Badge variant="warning">Sin match</Badge>;
  return <Badge variant="muted">{label || status}</Badge>;
}

function currency(value: number): string {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function money(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}
