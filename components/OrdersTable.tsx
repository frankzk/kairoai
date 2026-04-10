"use client";

import { useEffect, useState } from "react";
import { Phone, RefreshCw, AlertCircle, PhoneOff, ShoppingCart, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ShopifyOrderSummary {
  id: string; order_number: number; name: string;
  customer_name: string; phone: string | null; products: string;
  total: string; financial_status: string; fulfillment_status: string | null; created_at: string;
}
interface ShopifyCartSummary {
  id: string; token: string; customer_name: string;
  phone: string | null; email: string | null; products: string;
  total: string; checkout_url: string; created_at: string; updated_at: string;
}

function normalizePhone(phone: string): string {
  let c = phone.replace(/[\s\-().]/g, "");
  if (!c.startsWith("+")) {
    if (c.length === 8) c = `+506${c}`;
    else if (!c.startsWith("506")) c = `+${c}`;
    else c = `+${c}`;
  }
  return c;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-CR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function CallBtn({ id, phone, onCall, calling, result }: {
  id: string; phone: string | null;
  onCall: (id: string) => void; calling: boolean; result?: "ok" | "err";
}) {
  if (result === "ok") return <Badge variant="success" className="text-xs whitespace-nowrap">Llamando</Badge>;
  if (result === "err") return <Badge variant="destructive" className="text-xs">Error</Badge>;
  return (
    <Button size="sm" disabled={calling || !phone} onClick={() => onCall(id)}
      className="gap-1.5 text-xs h-7 px-3" title={!phone ? "Sin teléfono" : ""}>
      <Phone className={`h-3 w-3 ${calling ? "animate-pulse" : ""}`} />
      {calling ? "..." : "Llamar"}
    </Button>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<ShopifyOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [calling, setCalling] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, "ok" | "err">>({});

  async function load(r = false) {
    if (r) setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/shopify/orders", { cache: "no-store" });
      const d = await res.json();
      if (d.error) setError(d.error); else setOrders(d.orders ?? []);
    } catch { setError("Error al cargar pedidos"); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  async function call(id: string) {
    const o = orders.find((x) => x.id === id);
    if (!o?.phone) return;
    setCalling((c) => ({ ...c, [id]: true }));
    try {
      const res = await fetch("/api/calls/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(o.phone!), order_id: id, force: true }),
      });
      setResults((r) => ({ ...r, [id]: res.ok ? "ok" : "err" }));
    } catch { setResults((r) => ({ ...r, [id]: "err" })); }
    finally { setCalling((c) => ({ ...c, [id]: false })); }
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground">{orders.length > 0 ? `${orders.length} pedidos abiertos` : ""}</span>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 text-xs h-7">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>
      {loading ? <div className="h-40 animate-pulse bg-muted/20 m-4 rounded-lg" />
        : error ? <div className="flex items-start gap-2 px-4 py-6 text-sm text-amber-400"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>
        : orders.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">No hay pedidos abiertos.</p>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs">Pedido</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs">Cliente</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">Productos</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs">Total</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs hidden lg:table-cell">Fecha</th>
              <th className="py-2.5 px-4" />
            </tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="py-3 px-4"><span className="font-mono text-xs text-primary">{o.name}</span></td>
                <td className="py-3 px-4">
                  <p className="font-medium text-xs">{o.customer_name}</p>
                  {o.phone ? <p className="text-xs text-muted-foreground font-mono">{o.phone}</p>
                    : <p className="text-xs text-red-400 flex items-center gap-1"><PhoneOff className="h-3 w-3" /> Sin tel</p>}
                </td>
                <td className="py-3 px-4 hidden md:table-cell"><p className="text-xs text-muted-foreground truncate max-w-[180px]" title={o.products}>{o.products}</p></td>
                <td className="py-3 px-4 font-mono text-xs">{o.total}</td>
                <td className="py-3 px-4 hidden lg:table-cell"><span className="text-xs text-muted-foreground">{fmtDate(o.created_at)}</span></td>
                <td className="py-3 px-4"><CallBtn id={o.id} phone={o.phone} onCall={call} calling={!!calling[o.id]} result={results[o.id]} /></td>
              </tr>
            ))}</tbody>
          </table></div>}
    </div>
  );
}

function CartsTab() {
  const [carts, setCarts] = useState<ShopifyCartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [calling, setCalling] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, "ok" | "err">>({});

  async function load(r = false) {
    if (r) setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/shopify/checkouts", { cache: "no-store" });
      const d = await res.json();
      if (d.error) setError(d.error); else setCarts(d.carts ?? []);
    } catch { setError("Error al cargar carritos"); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  async function call(id: string) {
    const cart = carts.find((c) => c.id === id);
    if (!cart?.phone) return;
    setCalling((c) => ({ ...c, [id]: true }));
    try {
      const res = await fetch("/api/calls/trigger", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(cart.phone!), order_id: `checkout-${cart.token}`, force: true }),
      });
      setResults((r) => ({ ...r, [id]: res.ok ? "ok" : "err" }));
    } catch { setResults((r) => ({ ...r, [id]: "err" })); }
    finally { setCalling((c) => ({ ...c, [id]: false })); }
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground">{carts.length > 0 ? `${carts.length} carritos pendientes` : ""}</span>
        <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 text-xs h-7">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>
      {loading ? <div className="h-40 animate-pulse bg-muted/20 m-4 rounded-lg" />
        : error ? <div className="flex items-start gap-2 px-4 py-6 text-sm text-amber-400"><AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span></div>
        : carts.length === 0 ? <p className="text-center text-sm text-muted-foreground py-12">No hay carritos abandonados.</p>
        : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs">Cliente</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs hidden md:table-cell">Productos</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs">Total</th>
              <th className="text-left py-2.5 px-4 text-muted-foreground font-medium text-xs hidden lg:table-cell">Abandonado</th>
              <th className="py-2.5 px-4" />
            </tr></thead>
            <tbody>{carts.map((c) => (
              <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="py-3 px-4">
                  <p className="font-medium text-xs">{c.customer_name}</p>
                  {c.phone ? <p className="text-xs text-muted-foreground font-mono">{c.phone}</p>
                    : c.email ? <p className="text-xs text-muted-foreground">{c.email}</p>
                    : <p className="text-xs text-red-400 flex items-center gap-1"><PhoneOff className="h-3 w-3" /> Sin tel</p>}
                </td>
                <td className="py-3 px-4 hidden md:table-cell"><p className="text-xs text-muted-foreground truncate max-w-[180px]" title={c.products}>{c.products}</p></td>
                <td className="py-3 px-4 font-mono text-xs">{c.total}</td>
                <td className="py-3 px-4 hidden lg:table-cell"><span className="text-xs text-muted-foreground">{fmtDate(c.updated_at)}</span></td>
                <td className="py-3 px-4"><CallBtn id={c.id} phone={c.phone} onCall={call} calling={!!calling[c.id]} result={results[c.id]} /></td>
              </tr>
            ))}</tbody>
          </table></div>}
    </div>
  );
}

export function OrdersTable() {
  const [tab, setTab] = useState<"orders" | "carts">("orders");
  const tabCls = (active: boolean) =>
    `flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
      active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
    }`;
  return (
    <Card>
      <CardHeader className="pb-0 pt-0 px-0">
        <div className="flex border-b border-border">
          <button onClick={() => setTab("orders")} className={tabCls(tab === "orders")}>
            <Package className="h-3.5 w-3.5" /> Pedidos
          </button>
          <button onClick={() => setTab("carts")} className={tabCls(tab === "carts")}>
            <ShoppingCart className="h-3.5 w-3.5" /> Carritos
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {tab === "orders" ? <OrdersTab /> : <CartsTab />}
      </CardContent>
    </Card>
  );
}
