"use client";

import { useMemo, useState } from "react";
import {
  Phone, Clock, ShoppingBag, TrendingUp, Search, X,
  RotateCcw, PlayCircle, ChevronDown, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CallRecord, RetryItem } from "@/lib/db";

const STATUS_CONFIG: Record<
  CallRecord["status"],
  { label: string; variant: "success" | "destructive" | "warning" | "muted" | "default" | "secondary" | "outline" }
> = {
  calling:         { label: "Llamando...", variant: "default" },
  confirmed:       { label: "Confirmado",  variant: "success" },
  upsell_accepted: { label: "Upsell ✓",   variant: "success" },
  cancelled:       { label: "Cancelado",   variant: "destructive" },
  no_answer:       { label: "No Contesta", variant: "warning" },
  error:           { label: "Error",       variant: "muted" },
};

function fmtDuration(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return "—"; }
}
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-CR", { day: "2-digit", month: "short" });
  } catch { return "—"; }
}
function retryLabel(scheduledAt: string) {
  const ms = new Date(scheduledAt).getTime() - Date.now();
  if (ms <= 0) return "Reintento pendiente";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `Reintento en ${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r > 0 ? `Reintento en ${h}h ${r}min` : `Reintento en ${h}h`;
}

interface OrderGroup {
  order_id: string;
  phone: string;
  customer_name: string;
  products: string;
  total: string;
  calls: CallRecord[];   // sorted newest → oldest
  latestCall: CallRecord;
  pendingRetry?: RetryItem;
}

export function CallsTable({
  calls,
  pendingRetries = [],
}: {
  calls: CallRecord[];
  pendingRetries?: RetryItem[];
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build a map order_id → earliest pending retry
  const retryByOrder = useMemo(() => {
    const m = new Map<string, RetryItem>();
    for (const r of pendingRetries) {
      if (!m.has(r.order_id)) m.set(r.order_id, r);
    }
    return m;
  }, [pendingRetries]);

  // Group calls by order_id
  const groups = useMemo((): OrderGroup[] => {
    const map = new Map<string, CallRecord[]>();
    for (const c of calls) {
      if (!map.has(c.order_id)) map.set(c.order_id, []);
      map.get(c.order_id)!.push(c);
    }
    return Array.from(map.entries())
      .map(([order_id, grpCalls]) => {
        const sorted = [...grpCalls].sort(
          (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
        );
        const latest = sorted[0];
        return {
          order_id,
          phone: latest.phone,
          customer_name: latest.customer_name,
          products: latest.products,
          total: latest.total,
          calls: sorted,
          latestCall: latest,
          pendingRetry: retryByOrder.get(order_id),
        };
      })
      .sort((a, b) =>
        new Date(b.latestCall.started_at).getTime() -
        new Date(a.latestCall.started_at).getTime()
      );
  }, [calls, retryByOrder]);

  const filtered = search.trim()
    ? groups.filter(({ order_id, phone, customer_name, products }) => {
        const q = search.toLowerCase();
        return (
          phone.includes(q) ||
          order_id.toLowerCase().includes(q) ||
          customer_name.toLowerCase().includes(q) ||
          products.toLowerCase().includes(q)
        );
      })
    : groups;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!calls.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Phone className="h-12 w-12 mb-4 opacity-20" />
        <p className="text-sm">No hay llamadas registradas aún.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-input bg-background">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Buscar por celular, pedido, cliente o producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2 px-1">
          {filtered.length !== groups.length
            ? `${filtered.length} de ${groups.length} pedidos`
            : `${groups.length} pedidos · ${calls.length} llamadas`}
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-8 py-3 px-2" />
              <th className="text-left py-3 px-3 text-muted-foreground font-medium">Hora</th>
              <th className="text-left py-3 px-3 text-muted-foreground font-medium">Cliente</th>
              <th className="text-left py-3 px-3 text-muted-foreground font-medium hidden md:table-cell">Producto</th>
              <th className="text-left py-3 px-3 text-muted-foreground font-medium hidden lg:table-cell">Total</th>
              <th className="text-left py-3 px-3 text-muted-foreground font-medium">Resultado</th>
              <th className="text-left py-3 px-3 text-muted-foreground font-medium hidden sm:table-cell">Duración</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((grp) => {
              const lc = grp.latestCall;
              const sc = STATUS_CONFIG[lc.status] ?? { label: lc.status, variant: "muted" as const };
              const isExp = expanded.has(grp.order_id);
              const hasMany = grp.calls.length > 1;

              return (
                <>
                  {/* ── Main row (latest call) ─────────────────────────── */}
                  <tr
                    key={grp.order_id}
                    className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${hasMany ? "cursor-pointer" : ""}`}
                    onClick={() => hasMany && toggle(grp.order_id)}
                  >
                    {/* Expand toggle */}
                    <td className="py-3 px-2 text-center">
                      {hasMany ? (
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); toggle(grp.order_id); }}
                          title={`${grp.calls.length} intentos`}
                        >
                          {isExp
                            ? <ChevronDown className="h-4 w-4" />
                            : <ChevronRight className="h-4 w-4" />}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/30 text-xs">·</span>
                      )}
                    </td>

                    {/* Time */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col">
                        <span className="font-mono text-foreground">{fmtTime(lc.started_at)}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(lc.started_at)}</span>
                        {hasMany && (
                          <span className="text-xs text-primary mt-0.5">{grp.calls.length} intentos</span>
                        )}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{lc.customer_name || "—"}</span>
                        <span className="text-xs text-muted-foreground font-mono">{lc.phone}</span>
                        <span className="text-xs text-muted-foreground">#{lc.order_id}</span>
                      </div>
                    </td>

                    {/* Products */}
                    <td className="py-3 px-3 hidden md:table-cell">
                      <div className="flex items-start gap-1.5">
                        <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {lc.products || "—"}
                        </span>
                      </div>
                    </td>

                    {/* Total */}
                    <td className="py-3 px-3 hidden lg:table-cell">
                      <span className="font-mono text-foreground text-xs">{lc.total || "—"}</span>
                    </td>

                    {/* Status + retry + upsell */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant={sc.variant}>{sc.label}</Badge>
                        {grp.pendingRetry && (
                          <div className="flex items-center gap-1 text-amber-400">
                            <RotateCcw className="h-3 w-3 shrink-0" />
                            <span className="text-xs font-medium">{retryLabel(grp.pendingRetry.scheduled_at)}</span>
                          </div>
                        )}
                        {lc.upsell_product && (
                          <div className="flex items-center gap-1">
                            <TrendingUp className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span className="text-xs text-emerald-400 truncate max-w-[140px]">{lc.upsell_product}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Duration + recording */}
                    <td className="py-3 px-3 hidden sm:table-cell">
                      <div className="flex flex-col gap-1">
                        {lc.duration_seconds > 0 ? (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs">{fmtDuration(lc.duration_seconds)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                        {lc.recording_url && (
                          <a
                            href={lc.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:text-primary/80"
                            onClick={(e) => e.stopPropagation()}
                            title="Escuchar grabación"
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                            <span className="text-xs">Grabación</span>
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* ── Expanded: all attempts ─────────────────────────── */}
                  {isExp && grp.calls.map((c, idx) => {
                    const sc2 = STATUS_CONFIG[c.status] ?? { label: c.status, variant: "muted" as const };
                    const attemptNum = grp.calls.length - idx;
                    return (
                      <tr
                        key={c.call_id}
                        className="border-b border-border/30 bg-muted/10"
                      >
                        <td className="py-2 px-2" />
                        <td className="py-2 px-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-primary">
                              Intento {attemptNum}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">{fmtTime(c.started_at)}</span>
                            <span className="text-xs text-muted-foreground">{fmtDate(c.started_at)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3" colSpan={3}>
                          {c.notes && (
                            <p className="text-xs text-muted-foreground italic truncate max-w-[320px]" title={c.notes}>
                              {c.notes}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <Badge variant={sc2.variant} className="text-xs">{sc2.label}</Badge>
                        </td>
                        <td className="py-2 px-3 hidden sm:table-cell">
                          <div className="flex flex-col gap-0.5">
                            {c.duration_seconds > 0 && (
                              <span className="text-xs text-muted-foreground font-mono">
                                {fmtDuration(c.duration_seconds)}
                              </span>
                            )}
                            {c.recording_url && (
                              <a
                                href={c.recording_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-primary hover:text-primary/80"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <PlayCircle className="h-3 w-3" />
                                <span className="text-xs">Grabación</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* ── Pending retry row ─────────────────────────────── */}
                  {isExp && grp.pendingRetry && (
                    <tr key={`retry-${grp.order_id}`} className="border-b border-border/30 bg-amber-500/5">
                      <td className="py-2 px-2" />
                      <td className="py-2 px-3" colSpan={5}>
                        <div className="flex items-center gap-2 text-amber-400">
                          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                          <span className="text-xs font-medium">
                            {retryLabel(grp.pendingRetry.scheduled_at)}
                            {" "}(intento {grp.pendingRetry.attempt_number})
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3" />
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
