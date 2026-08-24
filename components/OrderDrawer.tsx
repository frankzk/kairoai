"use client";

// Drawer de gestion del pedido: dos columnas, la de la izquierda para decidir
// (alertas, historial del cliente, bitacora) y la de la derecha para el chat
// real de WhatsApp. Mismo patron que Leads y Novedades.
//
// Se abre AL INSTANTE con los datos que la lista ya tiene y carga el detalle
// pesado (historial + chat + bitacora) en segundo plano: la gestion funciona
// aunque el detalle tarde o falle.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, MessageSquare, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import LeadChatPanel from "@/components/LeadChatPanel";
import CallButton from "@/components/CallButton";
import { getVendedoraId, setVendedoraId as persistVendedoraId } from "@/lib/vendedora";
import type { ChatLeadSummary } from "@/lib/leads-types";
import type { CustomerOrder, CustomerSummary } from "@/lib/customer-history";
import type { OrderAlert } from "@/lib/order-risk";
import { ORDER_EVENT_OUTCOME_LABEL, type OrderEvent } from "@/lib/order-events";

export interface OrderDrawerTarget {
  order_name: string;
  guide_number: string;
  customer_name: string;
  phone: string;
  cod_amount: number;
  created_at: string | null;
  items_summary: string;
}

interface DetailResponse {
  orders?: CustomerOrder[];
  summary?: CustomerSummary | null;
  alerts?: OrderAlert[];
  events?: OrderEvent[];
  chat_lead?: ChatLeadSummary | null;
  error?: string;
}

interface Staff {
  id: number;
  name: string;
  active?: boolean;
}

const CONTACT_BUTTONS: Array<{ outcome: string; label: string }> = [
  { outcome: "contesto", label: "Contestó" },
  { outcome: "no_contesta", label: "No contesta" },
  { outcome: "buzon", label: "Buzón" },
  { outcome: "numero_malo", label: "Número malo" },
  { outcome: "confirmado", label: "Confirmó el pedido" },
  { outcome: "reagendar", label: "Reagendar" },
];

const DECISION_BUTTONS: Array<{ outcome: string; label: string; tone: string }> = [
  { outcome: "autorizar_despacho", label: "Autorizar despacho", tone: "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10" },
  { outcome: "retener", label: "Retener", tone: "border-amber-500/50 text-amber-400 hover:bg-amber-500/10" },
  { outcome: "anular", label: "Anular pedido", tone: "border-destructive/50 text-destructive hover:bg-destructive/10" },
];

function money(value: number, symbol: string): string {
  return `${symbol}${Math.round(Number(value) || 0).toLocaleString("es-CR")}`;
}

function whenCR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(t));
}

function AlertRow({ alert }: { alert: OrderAlert }) {
  const tone =
    alert.level === "alta"
      ? "border-destructive/40 bg-destructive/10"
      : alert.level === "media"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-emerald-500/40 bg-emerald-500/10";
  const Icon = alert.level === "alta" ? AlertTriangle : alert.level === "media" ? Info : CheckCircle2;
  const iconTone =
    alert.level === "alta"
      ? "text-destructive"
      : alert.level === "media"
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${tone}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{alert.title}</div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">{alert.detail}</div>
        <div className="text-[11px] font-medium">{alert.action}</div>
      </div>
    </div>
  );
}

export default function OrderDrawer({
  target,
  storeCode,
  currencySymbol,
  onClose,
}: {
  target: OrderDrawerTarget;
  storeCode: string;
  currencySymbol: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [vendedoraId, setVendedoraId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({
      store: storeCode,
      order: target.order_name,
      phone: target.phone ?? "",
      guide: target.guide_number ?? "",
    });
    if (target.created_at) qs.set("created_at", target.created_at);
    try {
      const res = await fetch(`/api/finance/order-detail?${qs.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as DetailResponse;
      setDetail(body);
      if (body.error) setError(body.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el pedido");
    } finally {
      setLoading(false);
    }
  }, [storeCode, target.order_name, target.phone, target.guide_number, target.created_at]);

  useEffect(() => {
    load();
  }, [load]);

  // Misma vendedora que ya eligio en Leads: no se le vuelve a preguntar.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/finance/payroll-staff`);
        const data = await res.json();
        const list: Staff[] = (data.staff ?? []).filter((s: Staff) => s.active !== false);
        setStaff(list);
        const saved = getVendedoraId();
        if (saved && list.some((s) => s.id === saved)) setVendedoraId(saved);
      } catch {
        /* la bitacora funciona sin vendedora */
      }
    })();
  }, []);

  const selectVendedora = (id: number) => {
    setVendedoraId(id);
    // persistVendedoraId ademas avisa al telefono web, que necesita saber en
    // el acto con que extension registrarse.
    persistVendedoraId(id);
  };

  async function registrar(kind: "contacto" | "nota" | "decision", outcome: string, message = "") {
    setSaving(outcome || kind);
    setError("");
    try {
      const res = await fetch(`/api/finance/order-detail?store=${encodeURIComponent(storeCode)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_name: target.order_name,
          guide_number: target.guide_number,
          kind,
          outcome,
          message,
          staff_id: vendedoraId,
          staff_name: staff.find((s) => s.id === vendedoraId)?.name ?? "",
        }),
      });
      const body = (await res.json()) as { event?: OrderEvent; error?: string };
      if (body.error) {
        setError(body.error);
        return;
      }
      if (body.event) {
        setDetail((cur) => ({ ...(cur ?? {}), events: [body.event as OrderEvent, ...(cur?.events ?? [])] }));
        if (kind === "nota") setNote("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la gestión");
    } finally {
      setSaving(null);
    }
  }

  const alerts = detail?.alerts ?? [];
  const events = detail?.events ?? [];
  const summary = detail?.summary;
  const otherOrders = (detail?.orders ?? []).filter(
    (o) => o.name.trim().toUpperCase() !== target.order_name.trim().toUpperCase()
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="my-1 flex h-[calc(100vh-1rem)] w-full max-w-[84rem] flex-col overflow-hidden sm:my-0 sm:h-[calc(100vh-2rem)]">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold">{target.order_name}</span>
            <span className="text-sm text-muted-foreground">{target.customer_name || "Sin nombre"}</span>
            <span className="font-mono text-xs text-muted-foreground">{target.phone || "sin teléfono"}</span>
            <span className="text-sm font-medium">{money(target.cod_amount, currencySymbol)}</span>
            {target.guide_number ? (
              <Badge variant="muted">Guía {target.guide_number}</Badge>
            ) : (
              <Badge variant="warning">Sin despachar</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* El numero sale del pedido en la base, no de esta pantalla. */}
            <CallButton orderName={target.order_name} store={storeCode} />
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {error && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 lg:overflow-hidden">
          <div className="grid min-h-full lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.85fr)]">

            {/* Columna izquierda: la decisión */}
            <div className="space-y-4 p-4 lg:overflow-y-auto">

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Antes de despachar
                </h3>
                {loading ? (
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Revisando el historial...
                  </p>
                ) : alerts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Sin alertas: pedido reciente y cliente sin historial de devoluciones.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {alerts.map((a) => (
                      <AlertRow key={a.id} alert={a} />
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Historial del cliente
                </h3>
                {summary ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="muted">{summary.orders} pedidos</Badge>
                    <Badge variant="muted">{money(summary.total_spent, currencySymbol)}</Badge>
                    {summary.delivered > 0 && <Badge variant="success">{summary.delivered} entregados</Badge>}
                    {summary.returned > 0 && <Badge variant="destructive">{summary.returned} devueltos</Badge>}
                    {summary.in_transit > 0 && <Badge variant="warning">{summary.in_transit} en camino</Badge>}
                    {summary.cancelled > 0 && <Badge variant="muted">{summary.cancelled} anulados</Badge>}
                  </div>
                ) : (
                  !loading && <p className="text-xs text-muted-foreground">Sin historial para este teléfono.</p>
                )}

                {otherOrders.length > 0 && (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <tbody>
                        {otherOrders.slice(0, 8).map((o) => (
                          <tr key={o.name} className="border-b border-border/50 last:border-0">
                            <td className="px-2 py-1.5 font-mono">{o.name}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{whenCR(o.created_at)}</td>
                            <td className="px-2 py-1.5">
                              <Badge
                                variant={
                                  o.state === "delivered"
                                    ? "success"
                                    : o.state === "returned"
                                      ? "destructive"
                                      : o.state === "in_transit"
                                        ? "warning"
                                        : "muted"
                                }
                              >
                                {o.state_label}
                              </Badge>
                            </td>
                            <td className="px-2 py-1.5 text-right font-medium">
                              {money(o.total, currencySymbol)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Registrar gestión
                </h3>

                {staff.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {staff.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => selectVendedora(s.id)}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                          vendedoraId === s.id
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {CONTACT_BUTTONS.map((b) => (
                    <Button
                      key={b.outcome}
                      variant="outline"
                      size="sm"
                      disabled={saving !== null}
                      onClick={() => registrar("contacto", b.outcome)}
                    >
                      {saving === b.outcome ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : b.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {DECISION_BUTTONS.map((b) => (
                    <Button
                      key={b.outcome}
                      variant="outline"
                      size="sm"
                      className={b.tone}
                      disabled={saving !== null}
                      onClick={() => registrar("decision", b.outcome)}
                    >
                      {saving === b.outcome ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : b.label}
                    </Button>
                  ))}
                </div>

                <div className="flex gap-1.5">
                  <Input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Nota para la bitácora"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && note.trim() && saving === null) {
                        registrar("nota", "", note);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!note.trim() || saving !== null}
                    onClick={() => registrar("nota", "", note)}
                  >
                    {saving === "nota" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bitácora {events.length > 0 && `(${events.length})`}
                </h3>
                {events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sin gestión registrada. Lo que anotes acá queda como respaldo de lo que se hizo.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {events.map((e) => (
                      <li key={e.id} className="rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {whenCR(e.created_at)}
                          </span>
                          {e.staff_name && <span className="font-medium">{e.staff_name}</span>}
                          {e.outcome && (
                            <span className="text-foreground">
                              {ORDER_EVENT_OUTCOME_LABEL[e.outcome] ?? e.outcome}
                            </span>
                          )}
                        </div>
                        {e.message && <div className="mt-0.5 text-muted-foreground">{e.message}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Columna derecha: el chat real */}
            <div className="flex min-h-[24rem] flex-col border-t border-border lg:border-l lg:border-t-0">
              {loading ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Buscando la conversación...
                  </p>
                </div>
              ) : detail?.chat_lead ? (
                <LeadChatPanel
                  lead={detail.chat_lead}
                  store={storeCode}
                  compact
                  title="Chat de WhatsApp"
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                  <span className="rounded-md border border-border bg-muted/40 p-2 text-muted-foreground">
                    <MessageSquare className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-medium">Chat no encontrado</p>
                  <p className="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
                    No hay conversación de Leads para el teléfono ni para el número de este pedido.
                  </p>
                </div>
              )}
            </div>

          </div>
        </CardContent>
      </Card>
    </div>
  );
}
