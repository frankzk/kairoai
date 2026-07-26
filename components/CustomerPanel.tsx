"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, MapPin, Package, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import LeadHistory from "@/components/LeadHistory";
import {
  groupOrdersByState,
  type CustomerOrder,
  type CustomerOrderState,
  type CustomerSummary,
} from "@/lib/customer-history";

interface CartRow {
  id: string;
  products: string;
  total: number;
  currency: string;
  created_at: string;
  checkout_url: string;
}

function fmtMoney(total: number, currency: string): string {
  const symbol = currency === "HNL" ? "L" : "₡";
  return `${symbol}${Math.round(total).toLocaleString("es-CR")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type BadgeVariant = "success" | "warning" | "destructive" | "info" | "muted";

const STATE_BADGE: Record<CustomerOrderState, BadgeVariant> = {
  delivered: "success",
  in_transit: "info",
  returned: "destructive",
  cancelled: "muted",
  pending: "warning",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard no disponible (contexto no seguro): ignora en silencio.
        }
      }}
      title={copied ? "Copiado" : label}
      aria-label={label}
      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// Columna derecha del drawer: todo lo que NO es el chat, apilado en un solo
// scroll (sin acordeones) para que la asesora vea el historial de un vistazo.
export default function CustomerPanel({
  leadId,
  store,
  historyKey,
}: {
  leadId: number;
  store: string;
  historyKey: number;
}) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [lastAddress, setLastAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [cartsUnavailable, setCartsUnavailable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/orders?store=${store}`);
      const data = await res.json();
      setOrders(data.orders ?? []);
      setSummary(data.summary ?? null);
      setLastAddress(data.last_address ?? "");
    } catch {
      setOrders([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [leadId, store]);

  useEffect(() => {
    load();
  }, [load, historyKey]);

  // Los carritos van aparte: dependen de un scope de Shopify que puede faltar
  // y no deben retrasar el historial de pedidos.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/carts?store=${store}`);
        const data = await res.json();
        if (!alive) return;
        setCarts(data.carts ?? []);
        setCartsUnavailable(data.unavailable ?? null);
      } catch {
        if (alive) setCarts([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leadId, store]);

  const groups = groupOrdersByState(orders);
  const isRepeatReturner = (summary?.returned ?? 0) >= 2;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      {/* Resumen del cliente */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resumen del cliente
        </h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">Cargando…</p>
        ) : !summary || summary.orders === 0 ? (
          <p className="text-xs text-muted-foreground">Sin pedidos previos. Es un cliente nuevo.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">Gastado</p>
                <p className="font-mono text-sm font-semibold">
                  {fmtMoney(summary.total_spent, summary.currency)}
                </p>
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">Pedidos</p>
                <p className="font-mono text-sm font-semibold">{summary.orders}</p>
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">Entregados</p>
                <p className="font-mono text-sm font-semibold text-emerald-400">{summary.delivered}</p>
              </div>
              <div
                className={`rounded-md border px-2 py-1.5 ${
                  isRepeatReturner ? "border-red-500/50 bg-red-500/10" : "border-border bg-background"
                }`}
              >
                <p className="text-[10px] text-muted-foreground">Devueltos</p>
                <p className={`font-mono text-sm font-semibold ${summary.returned ? "text-red-300" : ""}`}>
                  {summary.returned}
                </p>
              </div>
            </div>
            {isRepeatReturner && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-300">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Devolvió {summary.returned} pedidos: confirmá bien antes de despachar.
              </p>
            )}
          </>
        )}
      </section>

      {/* Direccion del ultimo pedido, lista para reusar */}
      {lastAddress && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Última dirección
          </h3>
          <div className="flex items-start gap-1.5 rounded-md border border-border bg-background px-2.5 py-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 text-xs">{lastAddress}</p>
            <CopyButton value={lastAddress} label="Copiar dirección" />
          </div>
        </section>
      )}

      {/* Pedidos agrupados por lo que REALMENTE paso */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos {orders.length > 0 && `(${orders.length})`}
        </h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">Cargando pedidos…</p>
        ) : orders.length === 0 ? (
          <p className="text-xs text-muted-foreground">Este cliente no tiene pedidos registrados.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.state}>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <Package className="h-3 w-3" />
                  {group.label} ({group.orders.length})
                </p>
                <div className="space-y-1.5">
                  {group.orders.map((order) => (
                    <div
                      key={order.name}
                      className="rounded-md border border-border bg-background p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold">{order.name}</span>
                        <Badge variant={STATE_BADGE[order.state]} className="shrink-0 text-[10px]">
                          {order.state_label}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono text-foreground">
                          {fmtMoney(order.total, order.currency)}
                        </span>
                        <span>·</span>
                        <span>{fmtDate(order.created_at)}</span>
                        {order.state_at && (
                          <>
                            <span>·</span>
                            <span title="Última actualización del courier">
                              act. {fmtDateTime(order.state_at)}
                            </span>
                          </>
                        )}
                      </div>
                      {order.items.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          {order.items
                            .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.title}` : i.title))
                            .join(", ")}
                        </p>
                      )}
                      {order.guide && (
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground">
                          <span className="text-[11px]">
                            {order.courier}: <span className="font-mono">{order.guide}</span>
                          </span>
                          <CopyButton value={order.guide} label="Copiar guía" />
                        </div>
                      )}
                      {order.address && (
                        <div className="mt-1 flex items-start gap-1 text-muted-foreground">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="min-w-0 flex-1">{order.address}</span>
                          <CopyButton value={order.address} label="Copiar dirección" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Carritos abandonados */}
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Carritos abandonados {carts.length > 0 && `(${carts.length})`}
        </h3>
        {cartsUnavailable ? (
          <p className="text-[11px] text-muted-foreground">{cartsUnavailable}</p>
        ) : carts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin carritos abiertos.</p>
        ) : (
          <div className="space-y-1.5">
            {carts.map((cart) => (
              <div key={cart.id} className="rounded-md border border-border bg-background p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 font-mono font-semibold">
                    <ShoppingCart className="h-3 w-3" />
                    {fmtMoney(cart.total, cart.currency)}
                  </span>
                  <span className="text-muted-foreground">{fmtDate(cart.created_at)}</span>
                </div>
                {cart.products && <p className="mt-1 text-muted-foreground">{cart.products}</p>}
                {cart.checkout_url && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="truncate text-[11px] text-muted-foreground">
                      Link de pago listo
                    </span>
                    <CopyButton value={cart.checkout_url} label="Copiar link de pago" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Gestiones (llamadas, cambios de estado, mensajes enviados) */}
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Gestiones
        </h3>
        <LeadHistory leadId={leadId} store={store} refreshKey={historyKey} alwaysOpen />
      </section>
    </div>
  );
}
