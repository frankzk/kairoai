"use client";

// Drawer de gestion del pedido: tres columnas con la MISMA estructura visual
// que el modal de Novedades, para que la asesora no tenga que reaprender la
// pantalla al cambiar de modulo.
//
//   1. Datos y contexto  -> quien es el cliente, que pidio, que alertas trae.
//   2. Gestion           -> llamada, decision, nota y bitacora.
//   3. Chat de WhatsApp  -> el mismo panel operativo de Leads.
//
// Se abre AL INSTANTE con los datos que la lista ya tiene y carga el detalle
// pesado (historial + chat + bitacora) en segundo plano: la gestion funciona
// aunque el detalle tarde o falle.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  History,
  Info,
  Loader2,
  MessageSquare,
  PackageCheck,
  PauseCircle,
  Phone,
  PhoneOff,
  Plus,
  RefreshCw,
  Voicemail,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import LeadChatPanel from "@/components/LeadChatPanel";
import CallButton from "@/components/CallButton";
import { getVendedoraId, setVendedoraId as persistVendedoraId } from "@/lib/vendedora";
import type { ChatLeadSummary } from "@/lib/leads-types";
import type { CustomerOrder, CustomerSummary } from "@/lib/customer-history";
import type { OrderAlert } from "@/lib/order-risk";
import {
  ORDER_EVENT_OUTCOME_LABEL,
  type OrderEvent,
  type OrderEventKind,
} from "@/lib/order-events";

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

type ActionButton = {
  outcome: string;
  label: string;
  icon: typeof Phone;
  /** Color del icono; el boton se mantiene neutro como en Novedades. */
  iconTone?: string;
  /** Solo para las decisiones, que si van coloreadas enteras. */
  tone?: string;
};

// Resultado de la llamada: lo que paso al marcar.
const CALL_BUTTONS: ActionButton[] = [
  { outcome: "contesto", label: "Contestó", icon: Phone, iconTone: "text-emerald-500" },
  { outcome: "no_contesta", label: "No contesta", icon: PhoneOff, iconTone: "text-rose-500" },
  { outcome: "buzon", label: "Buzón", icon: Voicemail, iconTone: "text-muted-foreground" },
  { outcome: "numero_malo", label: "Número malo", icon: Ban, iconTone: "text-muted-foreground" },
];

// Resultado del contacto: a que se comprometio el cliente.
const RESULT_BUTTONS: ActionButton[] = [
  { outcome: "confirmado", label: "Confirmó el pedido", icon: CheckCircle2, iconTone: "text-emerald-500" },
  { outcome: "reagendar", label: "Reagendar", icon: CalendarClock, iconTone: "text-muted-foreground" },
];

// Decision sobre el despacho: cierra la gestion.
const DECISION_BUTTONS: ActionButton[] = [
  {
    outcome: "autorizar_despacho",
    label: "Autorizar despacho",
    icon: PackageCheck,
    tone: "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10",
  },
  {
    outcome: "retener",
    label: "Retener",
    icon: PauseCircle,
    tone: "border-amber-500/50 text-amber-400 hover:bg-amber-500/10",
  },
  {
    outcome: "anular",
    label: "Anular pedido",
    icon: Ban,
    tone: "border-destructive/50 text-destructive hover:bg-destructive/10",
  },
];

const KIND_LABEL: Record<OrderEventKind, string> = {
  contacto: "Contacto",
  nota: "Nota",
  decision: "Decisión",
};

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

// Fila etiquetada de acciones: la etiqueta a la izquierda alinea los botones
// entre si, igual que "Llamada / Reprogramar / Cierre" en Novedades. Los
// botones van en su propio contenedor para que, al no caber, la segunda linea
// quede debajo de la primera y no debajo de la etiqueta.
function ActionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-2 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span> {children}
    </div>
  );
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

  const selectVendedora = (id: number | null) => {
    setVendedoraId(id);
    // persistVendedoraId ademas avisa al telefono web, que necesita saber en
    // el acto con que extension registrarse.
    if (id !== null) persistVendedoraId(id);
  };

  async function registrar(kind: OrderEventKind, outcome: string, message = "") {
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

  // Un boton de accion: icono + etiqueta, spinner mientras se guarda.
  const renderAction = (b: ActionButton, kind: OrderEventKind) => {
    const Icon = b.icon;
    return (
      <Button
        key={b.outcome}
        variant="outline"
        size="sm"
        className={`gap-2 ${b.tone ?? ""}`}
        disabled={saving !== null}
        onClick={() => registrar(kind, b.outcome)}
      >
        {saving === b.outcome ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className={`h-3.5 w-3.5 ${b.iconTone ?? ""}`} />
        )}
        {b.label}
      </Button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="my-1 flex h-[calc(100vh-1rem)] w-full max-w-[96rem] flex-col overflow-hidden sm:my-0 sm:h-[calc(100vh-2rem)]">
        {/* Cabecera minima: estado + pedido. El resto de los datos vive en la
            primera columna, como en Novedades. */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            {target.guide_number ? (
              <Badge variant="muted">Guía {target.guide_number}</Badge>
            ) : (
              <Badge variant="warning">Sin despachar</Badge>
            )}
            <span className="font-semibold">{target.order_name || "Pedido"}</span>
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

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 xl:overflow-hidden">
          <div className="grid min-h-full xl:h-full xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)_minmax(20rem,1.08fr)]">

            {/* Columna 1: datos y contexto del pedido */}
            <div className="space-y-3 p-4 xl:overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Field label="Cliente">{target.customer_name || "—"}</Field>
                <Field label="Telefono">
                  <span className="font-mono text-xs">{target.phone || "—"}</span>
                </Field>
                <Field label="Guia">
                  <span className="font-mono text-xs">{target.guide_number || "—"}</span>
                </Field>
                <Field label="Fecha">{whenCR(target.created_at)}</Field>
                <Field label="COD">
                  <span className="font-medium">{money(target.cod_amount, currencySymbol)}</span>
                </Field>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-muted-foreground">Pedidos del cliente:</span>
                  <span className="text-base font-bold tabular-nums">
                    {summary ? summary.orders : loading ? "…" : "—"}
                  </span>
                </div>
              </div>

              {target.items_summary && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Producto:</span> {target.items_summary}
                </div>
              )}

              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" /> Antes de despachar
                </p>
                {loading ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Revisando el historial…
                  </p>
                ) : alerts.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    Sin alertas: pedido reciente y cliente sin historial de devoluciones.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {alerts.map((a) => (
                      <AlertRow key={a.id} alert={a} />
                    ))}
                  </div>
                )}
              </div>

              {summary && (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="muted">{money(summary.total_spent, currencySymbol)} gastados</Badge>
                  {summary.delivered > 0 && <Badge variant="success">{summary.delivered} entregados</Badge>}
                  {summary.returned > 0 && <Badge variant="destructive">{summary.returned} devueltos</Badge>}
                  {summary.in_transit > 0 && <Badge variant="warning">{summary.in_transit} en camino</Badge>}
                  {summary.cancelled > 0 && <Badge variant="muted">{summary.cancelled} anulados</Badge>}
                </div>
              )}
              {!summary && !loading && (
                <p className="text-xs text-muted-foreground">Sin historial para este teléfono.</p>
              )}

              {/* Plegable, igual que el historial del courier en Novedades. */}
              {otherOrders.length > 0 && (
                <details className="rounded-md border border-border">
                  <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Otros pedidos del cliente
                    <Badge variant="muted" className="ml-auto">{otherOrders.length}</Badge>
                  </summary>
                  <ol className="max-h-64 divide-y divide-border overflow-y-auto border-t border-border">
                    {otherOrders.slice(0, 12).map((o) => (
                      <li key={o.name} className="space-y-0.5 px-3 py-2 text-xs">
                        <div className="flex items-start justify-between gap-3">
                          <span className="font-mono font-medium">{o.name}</span>
                          <span className="whitespace-nowrap text-muted-foreground">
                            {whenCR(o.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
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
                          <span className="font-medium">{money(o.total, currencySymbol)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>

            {/* Columna 2: gestion, nota y bitacora */}
            <div className="space-y-3 border-t border-border p-4 xl:overflow-y-auto xl:border-l xl:border-t-0">

              <ActionRow label="Vendedora">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={vendedoraId ?? ""}
                  onChange={(e) => selectVendedora(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sin asignar</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </ActionRow>

              <div className="space-y-2">
                <ActionRow label="Llamada">
                  {CALL_BUTTONS.map((b) => renderAction(b, "contacto"))}
                </ActionRow>
                <ActionRow label="Resultado">
                  {RESULT_BUTTONS.map((b) => renderAction(b, "contacto"))}
                </ActionRow>
                <ActionRow label="Decisión">
                  {DECISION_BUTTONS.map((b) => renderAction(b, "decision"))}
                </ActionRow>
                {vendedoraId === null && (
                  <p className="text-[11px] text-muted-foreground">
                    Elegí tu nombre para que la gestión quede registrada a tu nombre.
                  </p>
                )}
              </div>

              {/* Notas: se registran como eventos de la bitacora */}
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Agregar nota</p>
                <textarea
                  className="min-h-[52px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Escribe una nota… (queda en la bitácora)"
                />
                <div className="mt-1 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={!note.trim() || saving !== null}
                    onClick={() => registrar("nota", "", note)}
                  >
                    {saving === "nota" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Agregar nota
                  </Button>
                </div>
              </div>

              {/* Bitacora */}
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Bitácora
                  {events.length > 0 && <span>({events.length})</span>}
                </p>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {loading && events.length === 0 ? (
                    <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Cargando bitácora…
                    </p>
                  ) : events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Sin gestión registrada. Lo que anotes acá queda como respaldo de lo que se hizo.
                    </p>
                  ) : (
                    events.map((e) => (
                      <div key={e.id} className="flex gap-2 border-b border-border/30 py-1 text-xs">
                        <span className="whitespace-nowrap text-muted-foreground">
                          {whenCR(e.created_at)}
                        </span>
                        <span className="font-medium">{KIND_LABEL[e.kind] ?? e.kind}</span>
                        <span className="flex-1 text-muted-foreground">
                          {e.message || (e.outcome ? ORDER_EVENT_OUTCOME_LABEL[e.outcome] ?? e.outcome : "")}
                        </span>
                        {e.staff_name && (
                          <span className="whitespace-nowrap text-muted-foreground">{e.staff_name}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Columna 3: el mismo chat operativo del modulo de Leads. */}
            <div className="flex min-h-[34rem] flex-col border-t border-border xl:min-h-0 xl:border-l xl:border-t-0">
              {loading ? (
                <div className="flex flex-1 items-center justify-center p-6 text-center">
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Buscando conversación de WhatsApp...
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
