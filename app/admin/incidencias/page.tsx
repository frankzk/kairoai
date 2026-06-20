"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, CalendarClock, Check, Copy, Download, History, Pencil, Phone, PhoneOff,
  Plus, RefreshCw, Search, Undo2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { type Incident, type IncidentEvent, type IncidentStatus, type IncidentCategory, type IncidentExecutiveStats, type IncidentCausaStat, type IncidentMatrixKey, type IncidentMatrixCell, type TrackingEvent } from "@/lib/incidents-types";
import { FINANCE_STORES, type FinanceStoreCode } from "@/lib/store-config";
import { useSelectedStore } from "@/lib/use-selected-store";
import { exportXlsx } from "@/lib/export-xlsx";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

const STATUS_META: Record<IncidentStatus, { label: string; variant: BadgeVariant }> = {
  pendiente: { label: "Pendiente", variant: "info" },
  reprogramada: { label: "Reprogramada", variant: "success" },
  sin_contestar: { label: "Sin contestar", variant: "warning" },
  no_llamar: { label: "No llamar", variant: "destructive" },
  resuelta: { label: "Resuelta", variant: "success" },
  perdida: { label: "Perdida", variant: "muted" },
  descartada: { label: "Descartada", variant: "outline" },
};

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  fallo_entrega: "Fallo de entrega",
  direccion_incorrecta: "Direccion incorrecta",
  cliente_no_responde: "Cliente no responde",
  cliente_rechaza: "Cliente rechaza",
  devuelto_origen: "Devuelto al origen",
  dano_paquete: "Paquete dañado",
  otro: "Otro",
};

const EVENT_LABELS: Record<string, string> = {
  detectada: "Detectada", estado_cambiado: "Cambio de estado", categoria_cambiada: "Cambio de causa",
  nota: "Nota", llamada: "Llamada", reprogramada: "Reprogramada", no_llamar: "No volver a llamar",
  accion_rts: "Devolucion (RTS)", accion_cancelar_shopify: "Cancelacion Shopify", descartada: "Descartada",
};

const STATUS_ORDER: IncidentStatus[] = [
  "pendiente", "reprogramada", "sin_contestar", "no_llamar", "resuelta", "perdida", "descartada",
];

// Cuenta para cobrar el nuevo envio por adelantado cuando el courier ya no
// reintenta (>=2 intentos de entrega fallidos). Es por tienda/pais: CR cobra en
// colones; HN queda pendiente de definir (su cuenta sera en lempiras).
type CuentaReenvio = { banco: string; titular: string; moneda: string; cuenta: string };
const CUENTA_REENVIO: Record<FinanceStoreCode, CuentaReenvio | null> = {
  "mireva-cr": {
    banco: "BAC Credomatic",
    titular: "3-101-947603 Sociedad Anónima",
    moneda: "colones",
    cuenta: "CR39010200009692837534",
  },
  "mireva-hn": null,
};

const currency = (n: number) => "₡" + Math.round(Number(n) || 0).toLocaleString("es-CR");
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-CR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDay = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

const META_RESOLUCION = 50; // meta configurada de tasa de resolucion (%)

// Abrevia montos grandes: ₡39.8 mil, ₡1.2 M.
const fmtMoneyShort = (n: number): string => {
  const v = Math.round(Number(n) || 0);
  if (v >= 1_000_000) return `₡${(v / 1_000_000).toFixed(1)} M`;
  if (v >= 1_000) return `₡${(v / 1_000).toFixed(1)} mil`;
  return `₡${v}`;
};

// Semaforo contra la meta: rojo por debajo, amarillo cerca, verde al alcanzarla.
function goalTone(pct: number): { text: string; dot: string } {
  if (pct >= META_RESOLUCION) return { text: "text-emerald-500", dot: "bg-emerald-500" };
  if (pct >= META_RESOLUCION - 10) return { text: "text-amber-500", dot: "bg-amber-500" };
  return { text: "text-rose-500", dot: "bg-rose-500" };
}

// Color del balance del flujo: + (backlog bajando) verde, - (subiendo) rojo.
function balanceTone(b: number): string {
  return b > 0 ? "text-emerald-500" : b < 0 ? "text-rose-500" : "text-muted-foreground";
}

const MATRIX_PERIODS: { key: IncidentMatrixKey; short: string; long: string }[] = [
  { key: "hoy", short: "H", long: "Hoy" },
  { key: "ayer", short: "A", long: "Ayer" },
  { key: "d7", short: "7D", long: "7 días" },
  { key: "d30", short: "30D", long: "30 días" },
];
const EMPTY_CELL: IncidentMatrixCell = { nuevas: 0, resueltas: 0, tasa: 0, monto: 0, despachados: 0 };
const mcell = (exec: IncidentExecutiveStats | null, k: IncidentMatrixKey): IncidentMatrixCell =>
  exec?.matriz[k] ?? EMPTY_CELL;

// Bloque pequeño de "Estado actual" (sin tarjeta propia).
function MetricBlock({ label, value, sub, accent, title }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: string; title?: string;
}) {
  return (
    <div title={title}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold leading-none tabular-nums ${accent ?? ""}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{sub}</div>}
    </div>
  );
}

// Encabezado de columnas de la tabla de causas.
function CausasHeader() {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className="w-28 shrink-0 sm:w-32">Motivo</span>
      <span className="flex-1">Distribución</span>
      <span className="w-7 text-right">Cant</span>
      <span className="w-9 text-right">%</span>
      <span className="w-9 text-right">Rec.</span>
    </div>
  );
}

// Una fila de causa (reutilizada en el top 5 y en el modal "Ver todos").
function CausaRow({ c }: { c: IncidentCausaStat }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 truncate sm:w-32" title={CATEGORY_LABELS[c.category]}>{CATEGORY_LABELS[c.category]}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, c.pct)}%` }} />
      </div>
      <span className="w-7 text-right tabular-nums">{c.total}</span>
      <span className="w-9 text-right tabular-nums text-muted-foreground">{Math.round(c.pct)}%</span>
      <span className={`w-9 text-right tabular-nums ${goalTone(c.recuperacion).text}`}>{Math.round(c.recuperacion)}%</span>
    </div>
  );
}

// Grafico de tendencia (SVG, sin dependencias): generadas vs resueltas por dia.
function TrendChart({ data }: { data: { date: string; generadas: number; resueltas: number }[] }) {
  const W = 720, H = 120, P = 6;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => Math.max(d.generadas, d.resueltas)));
  const x = (i: number) => (n <= 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const pts = (k: "generadas" | "resueltas") =>
    data.map((d, i) => `${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" preserveAspectRatio="none">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="stroke-muted-foreground/30" strokeWidth={1} />
      <polyline fill="none" className="stroke-rose-500" strokeWidth={2} points={pts("generadas")} />
      <polyline fill="none" className="stroke-emerald-500" strokeWidth={2} points={pts("resueltas")} />
    </svg>
  );
}

// Modal "Ver todos": detalle completo de causas.
function CausasModal({ causas, onClose }: { causas: IncidentCausaStat[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="my-8 w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-border p-4">
          <span className="font-semibold">Causas · últimos 30 días</span>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <CardContent className="space-y-1.5 p-4">
          {causas.length > 0 ? (
            <>
              <CausasHeader />
              {causas.map((c) => <CausaRow key={c.category} c={c} />)}
            </>
          ) : <p className="text-xs text-muted-foreground">Sin incidencias en el período.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function IncidenciasPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selectedStoreCode, setSelectedStoreCode] = useSelectedStore();
  const [soloReintento, setSoloReintento] = useState(false);
  const [search, setSearch] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [trackingSync, setTrackingSync] = useState<string | null>(null);
  const [exec, setExec] = useState<IncidentExecutiveStats | null>(null);
  const [showCausas, setShowCausas] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [selected, setSelected] = useState<Incident | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [trackingEvents, setTrackingEvents] = useState<TrackingEvent[]>([]);
  const [reprogFecha, setReprogFecha] = useState("");
  const [showNew, setShowNew] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (soloReintento) qs.set("reintento", "1");
    else if (statusFilter) qs.set("status", statusFilter);
    if (categoryFilter) qs.set("category", categoryFilter);
    qs.set("store", selectedStoreCode);
    if (search.trim()) qs.set("q", search.trim());
    try {
      const res = await fetch(`/api/incidents?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      setIncidents(json.incidents ?? []);
      setCounts(json.counts ?? {});
      setLastRun(json.last_run ?? null);
      setTrackingSync(json.tracking_last_sync ?? null);
      setExec(json.exec ?? null);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, soloReintento, search, selectedStoreCode]);

  useEffect(() => {
    const t = setTimeout(fetchData, 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  async function openDetail(id: number) {
    const res = await fetch(`/api/incidents?id=${id}&store=${selectedStoreCode}`, { cache: "no-store" });
    const json = await res.json();
    if (json.incident) {
      setSelected(json.incident);
      setEvents(json.events ?? []);
      setTrackingEvents(json.tracking_events ?? []);
      setReprogFecha(json.incident.reprogramada_para ?? "");
    }
  }

  async function detectar() {
    setBusy(true);
    try {
      // Primero refresca el tracking del courier para no detectar sobre datos
      // viejos (la causa tipica de "no jala incidencias nuevas"). Moovin tiene
      // sync por servidor; Forza se refresca desde Gestion de pedidos.
      const provider = FINANCE_STORES.find((s) => s.code === selectedStoreCode)?.logisticsProvider;
      if (provider === "moovin") {
        try { await fetch("/api/cron/moovin", { method: "POST" }); } catch { /* si falla, igual detecta */ }
      }
      const res = await fetch("/api/cron/incidencias?full=1", { method: "POST" });
      const json = await res.json();
      if (json.error) alert(json.error);
      else alert(`Deteccion lista: ${json.created} nuevas, ${json.updated} actualizadas, ${json.scanned} revisadas.`);
      await fetchData();
    } finally {
      setBusy(false);
    }
  }

  // Exporta a Excel las novedades del filtro actual (lo que tiene cargado la
  // tabla: estado/causa/busqueda/reintento/tienda). Dinamico: si no hay filtro,
  // baja todo lo cargado.
  async function exportarExcel() {
    if (!incidents.length) { alert("No hay novedades para exportar."); return; }
    setExporting(true);
    try {
      const rows = incidents.map((i) => ({
        Estado: STATUS_META[i.status]?.label ?? i.status,
        Cliente: i.customer_name || "",
        Teléfono: i.customer_phone || "",
        Pedido: i.order_name || "",
        Guía: i.guide_number || "",
        Causa: CATEGORY_LABELS[i.category] ?? i.category,
        Courier: i.courier || "",
        COD: Number(i.cod_amount || 0),
        "Intentos de llamada": i.intentos_llamada || 0,
        "Reprogramada para": i.reprogramada_para || "",
        Origen: i.source,
        Detalle: i.detail || "",
        Creada: i.created_at ? new Date(i.created_at).toLocaleString("es-CR") : "",
        Actualizada: i.updated_at ? new Date(i.updated_at).toLocaleString("es-CR") : "",
      }));
      const fecha = new Date().toISOString().slice(0, 10);
      await exportXlsx(`novedades-${selectedStoreCode}-${fecha}.xlsx`, rows, "Novedades");
    } finally {
      setExporting(false);
    }
  }

  async function patchField(patch: Record<string, unknown>) {
    if (!selected) return;
    const res = await fetch(`/api/incidents?store=${selectedStoreCode}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selected.id, ...patch }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json.error || "Error al actualizar");
    await openDetail(selected.id);
    fetchData();
  }

  async function doAction(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/actions?store=${selectedStoreCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return alert(json.error || "Error en la accion");
      await openDetail(selected.id);
      fetchData();
    } finally {
      setBusy(false);
    }
  }

  async function addNote(text: string) {
    if (!selected || !text.trim()) return;
    const res = await fetch(`/api/incidents/events?store=${selectedStoreCode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: selected.id, message: text.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json.error || "Error al guardar la nota");
    await openDetail(selected.id);
  }

  async function editNote(eventId: number, text: string) {
    if (!selected || !text.trim()) return;
    const res = await fetch(`/api/incidents/events?store=${selectedStoreCode}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, message: text.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return alert(json.error || "Error al editar la nota");
    await openDetail(selected.id);
  }

  const shown = incidents.slice(0, 120);

  // Frescura del tracking del courier de la tienda seleccionada (para avisar si
  // quedo viejo: ahi la deteccion puede no traer novedades nuevas).
  const courierName =
    FINANCE_STORES.find((s) => s.code === selectedStoreCode)?.logisticsProvider === "forza" ? "Forza" : "Moovin";
  const trackingAgeH = trackingSync ? (Date.now() - Date.parse(trackingSync)) / 3_600_000 : null;
  const trackingTone =
    trackingAgeH != null && trackingAgeH > 8 ? "text-rose-500"
    : trackingAgeH != null && trackingAgeH > 3 ? "text-amber-500"
    : "text-muted-foreground";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Novedades</h1>
              <p className="text-xs text-muted-foreground">Entregas no realizadas · Gestion de incidencias</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={selectedStoreCode} onChange={(e) => setSelectedStoreCode(e.target.value as FinanceStoreCode)} title="Tienda">
              {FINANCE_STORES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Actualizar</span>
            </Button>
            <div className="flex flex-col items-center">
              <Button variant="outline" size="sm" onClick={detectar} disabled={busy} className="gap-2"
                title="Actualiza el tracking del courier y luego detecta novedades">
                {busy
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <Search className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{busy ? "Actualizando…" : "Detectar novedades"}</span>
              </Button>
              {lastRun && (
                <span className="text-[10px] leading-tight text-muted-foreground mt-0.5">
                  Actualizado {fmtDate(lastRun)}
                </span>
              )}
              {trackingSync && (
                <span className={`text-[10px] leading-tight ${trackingTone}`}
                  title="Última sincronización del tracking del courier. Si está vieja, la detección puede no traer novedades nuevas.">
                  {courierName} {fmtDate(trackingSync)}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => setShowNew(true)} className="gap-2">
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Nueva</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-4">
        {/* ===== Resumen ejecutivo: vista fija, todos los periodos a la vez ===== */}
        {/* Fila 1: Matriz de desempeño (~65%) + Estado actual (~35%) */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[65fr_35fr]">
          <Card>
            <CardContent className="p-3">
              <div className="mb-2 text-[13px] font-semibold">Matriz de desempeño</div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 text-left font-medium">&nbsp;</th>
                      {MATRIX_PERIODS.map((p) => (
                        <th key={p.key} className="border-l border-border/40 px-1.5 py-1 font-medium">
                          <span className="sm:hidden">{p.short}</span><span className="hidden sm:inline">{p.long}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border/60" title="Incidencias creadas en el período">
                      <td className="py-1.5 text-left text-[11px] text-muted-foreground">Nuevas</td>
                      {MATRIX_PERIODS.map((p) => (
                        <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-[15px] font-semibold tabular-nums">{mcell(exec, p.key).nuevas}</td>
                      ))}
                    </tr>
                    <tr className="border-t border-border/60" title="Incidencias que pasaron a resuelta dentro del período (gestión o entrega confirmada)">
                      <td className="py-1.5 text-left text-[11px] text-muted-foreground">Resueltas</td>
                      {MATRIX_PERIODS.map((p) => (
                        <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-[15px] font-semibold tabular-nums">{mcell(exec, p.key).resueltas}</td>
                      ))}
                    </tr>
                    <tr className="border-t border-border/60" title="Tasa de resolución (cohorte): de las creadas en el período, % que ya están resueltas">
                      <td className="py-1.5 text-left text-[11px] text-muted-foreground">Tasa resol.</td>
                      {MATRIX_PERIODS.map((p) => {
                        const t = mcell(exec, p.key).tasa;
                        return p.key === "d30" ? (
                          <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap">
                            <span className={`text-[15px] font-bold ${goalTone(t).text}`}>{Math.round(t)}%</span>
                            <span className="block text-[9px] leading-none text-muted-foreground">meta {META_RESOLUCION}%</span>
                          </td>
                        ) : (
                          <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-[15px] tabular-nums text-muted-foreground">{Math.round(t)}%</td>
                        );
                      })}
                    </tr>
                    <tr className="border-t border-border/60" title="Monto recuperado: ₡ (COD) de las incidencias resueltas en el período">
                      <td className="py-1.5 text-left text-[11px] text-muted-foreground">Monto rec.</td>
                      {MATRIX_PERIODS.map((p) => (
                        <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-[13px] font-semibold tabular-nums">{fmtMoneyShort(mcell(exec, p.key).monto)}</td>
                      ))}
                    </tr>
                    <tr className="border-t border-border/60" title="Incidencias ÷ pedidos despachados (con guía, por fecha de pedido) en el período. Menor = mejor calidad operativa.">
                      <td className="py-1.5 text-left text-[11px] text-muted-foreground">Inc./Desp.</td>
                      {MATRIX_PERIODS.map((p) => {
                        const c = mcell(exec, p.key);
                        return (
                          <td key={p.key} className="border-l border-border/40 px-1.5 py-1.5 text-[15px] tabular-nums text-muted-foreground"
                            title={c.despachados > 0 ? `${c.nuevas} inc. / ${c.despachados} despachados` : "Sin pedidos despachados en el período"}>
                            {c.despachados > 0 ? `${((c.nuevas / c.despachados) * 100).toFixed(1)}%` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <div className="mb-2 text-[13px] font-semibold">Estado actual</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                <MetricBlock label="Abiertas" value={exec?.estado.abiertas ?? 0}
                  title="Incidencias en estados no terminales (sin resolver, perder ni descartar)" />
                <MetricBlock label="Abiertas > 48 h" value={exec?.estado.abiertas_48h ?? 0}
                  accent={(exec?.estado.abiertas_48h ?? 0) > 0 ? "text-amber-500" : undefined}
                  title="Incidencias abiertas con más de 48 horas de antigüedad" />
                <MetricBlock label="Edad promedio" value={`${(exec?.estado.edad_promedio_dias ?? 0).toFixed(1)}d`}
                  sub={exec?.estado.mas_antigua ? `Más antigua: ${exec.estado.mas_antigua.dias}d` : undefined}
                  title="Edad media de las incidencias abiertas; la más antigua como subtítulo" />
                <MetricBlock label="1ª gestión (30d)" value={exec?.estado.primera_gestion_horas != null ? `${exec.estado.primera_gestion_horas.toFixed(1)}h` : "—"}
                  title="Tiempo promedio desde la creación hasta el primer llamado (últimos 30 días)" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Fila 2: Flujo (~60%) + Principales causas (~40%) */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[60fr_40fr]">
          <Card>
            <CardContent className="p-3">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-[13px] font-semibold">Flujo de novedades · últimos 30 días</span>
                <span className="text-[11px] text-muted-foreground">
                  <span className="text-rose-500">Generadas: {exec?.trend_totales.generadas ?? 0}</span>
                  {" · "}
                  <span className="text-emerald-500">Resueltas: {exec?.trend_totales.resueltas ?? 0}</span>
                  {" · "}
                  <span title="Resueltas − Generadas (positivo = el backlog está bajando)">
                    Balance: <span className={balanceTone(exec?.trend_totales.balance ?? 0)}>{(exec?.trend_totales.balance ?? 0) > 0 ? "+" : ""}{exec?.trend_totales.balance ?? 0}</span>
                  </span>
                </span>
              </div>
              {exec && exec.trend.length > 0
                ? <TrendChart data={exec.trend} />
                : <p className="py-8 text-center text-xs text-muted-foreground">Sin datos.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-semibold">Principales causas · 30 días</span>
                <button type="button" className="text-[11px] font-medium text-primary hover:underline"
                  onClick={() => setShowCausas(true)}>Ver todos</button>
              </div>
              <div className="space-y-1.5">
                <CausasHeader />
                {exec && exec.causas.length > 0
                  ? exec.causas.slice(0, 5).map((c) => <CausaRow key={c.category} c={c} />)
                  : <p className="py-2 text-center text-xs text-muted-foreground">Sin incidencias en el período.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* KPIs por estado (colorimetria) */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {STATUS_ORDER.map((s) => (
            <Card key={s} className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => { setSoloReintento(false); setStatusFilter(statusFilter === s ? "" : s); }}>
              <CardContent className="p-3">
                <Badge variant={STATUS_META[s].variant}>{STATUS_META[s].label}</Badge>
                <p className="text-2xl font-bold mt-2">{counts[s] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Buscar pedido, guia o cliente…"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter} onChange={(e) => { setSoloReintento(false); setStatusFilter(e.target.value); }}>
              <option value="">Todos los estados</option>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas las causas</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button variant={soloReintento ? "default" : "outline"} size="sm" className="gap-2 h-9"
              onClick={() => { setStatusFilter(""); setSoloReintento(!soloReintento); }}>
              <CalendarClock className="h-3.5 w-3.5" /> Reintento fin del dia
            </Button>
            <Button variant="outline" size="sm" className="gap-2 h-9 ml-auto"
              disabled={exporting || loading || !incidents.length} onClick={exportarExcel}
              title="Descarga en Excel las novedades del filtro actual">
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exportando…" : `Exportar (${incidents.length})`}
            </Button>
          </CardContent>
        </Card>

        {/* Tabla */}
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Telefono</th>
                  <th className="px-3 py-2 font-medium">Pedido</th>
                  <th className="px-3 py-2 font-medium">Guia</th>
                  <th className="px-3 py-2 font-medium">Causa</th>
                  <th className="px-3 py-2 font-medium text-right">COD</th>
                  <th className="px-3 py-2 font-medium text-center">Int.</th>
                  <th className="px-3 py-2 font-medium">Reprog.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Cargando novedades…
                    </span>
                  </td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-10 text-center text-muted-foreground">
                    No hay novedades. Usa “Detectar novedades” o crea una manual.
                  </td></tr>
                ) : (
                  shown.map((i) => (
                    <tr key={i.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2"><Badge variant={STATUS_META[i.status].variant}>{STATUS_META[i.status].label}</Badge></td>
                      <td className="px-3 py-2">{i.customer_name || "—"}</td>
                      <td className="px-3 py-2">{i.customer_phone || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.order_name || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.guide_number || "—"}</td>
                      <td className="px-3 py-2 text-xs">{CATEGORY_LABELS[i.category]}</td>
                      <td className="px-3 py-2 text-right">{i.cod_amount ? currency(i.cod_amount) : "—"}</td>
                      <td className="px-3 py-2 text-center">{i.intentos_llamada || 0}</td>
                      <td className="px-3 py-2 text-xs">{i.reprogramada_para || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => openDetail(i.id)}>Gestionar</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {incidents.length > shown.length && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/50">
              Mostrando {shown.length} de {incidents.length}
            </div>
          )}
        </Card>
      </main>

      {selected && (
        <DetailModal
          key={selected.id}
          storeCode={selectedStoreCode}
          incident={selected}
          events={events}
          trackingEvents={trackingEvents}
          busy={busy}
          reprogFecha={reprogFecha}
          setReprogFecha={setReprogFecha}
          onClose={() => setSelected(null)}
          onPatch={patchField}
          onAction={doAction}
          onAddNote={addNote}
          onEditNote={editNote}
        />
      )}

      {showNew && <NewModal storeCode={selectedStoreCode} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); fetchData(); }} />}
      {showCausas && <CausasModal causas={exec?.causas ?? []} onClose={() => setShowCausas(false)} />}
    </div>
  );
}

function DetailModal({
  storeCode, incident, events, trackingEvents, busy, reprogFecha, setReprogFecha, onClose, onPatch, onAction, onAddNote, onEditNote,
}: {
  storeCode: FinanceStoreCode;
  incident: Incident; events: IncidentEvent[]; trackingEvents: TrackingEvent[]; busy: boolean;
  reprogFecha: string; setReprogFecha: (v: string) => void;
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onAction: (action: string, extra?: Record<string, unknown>) => void;
  onAddNote: (text: string) => Promise<void>;
  onEditNote: (eventId: number, text: string) => Promise<void>;
}) {
  const [nuevaNota, setNuevaNota] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState("");
  const [reopened, setReopened] = useState(false);
  const showResultView = incident.status === "reprogramada" && !reopened;
  const intentosEntrega = trackingEvents.filter((e) => e.group === "failed").length;
  const trackingOrdenado = [...trackingEvents].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // Reprogramar requiere que la ultima llamada haya sido "contesto"; o, como
  // excepcion, 3 "no contesto" en dias distintos (ahi se agenda al finde porque
  // Moovin no hace un 3er intento de entrega).
  const ultimaLlamada = [...events]
    .filter((e) => e.kind === "llamada")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  const clienteContesto = ultimaLlamada?.metadata?.resultado === "contesto";
  const diasNoContesta = new Set(
    events
      .filter((e) => e.kind === "llamada" && e.metadata?.resultado === "no_contesto")
      .map((e) => (e.created_at || "").slice(0, 10))
      .filter(Boolean)
  ).size;
  const tresNoContesta = diasNoContesta >= 3;
  const puedeReprogramar = clienteContesto || tresNoContesta;
  const soloFinde = !clienteContesto && tresNoContesta;
  // Proximo viernes y sabado (dias consecutivos): limitan el date picker cuando
  // se agenda al finde tras 3 intentos sin contestar.
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoyYMD = ymd(new Date());
  const proxViernes = (() => {
    const d = new Date();
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return ymd(d);
  })();
  const proxSabado = (() => {
    const d = new Date(`${proxViernes}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return ymd(d);
  })();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copiedNuevoEnvio, setCopiedNuevoEnvio] = useState(false);

  // Mensaje estructurado para pedir la reprogramacion al equipo del courier.
  const copyReprogMsg = async (ev: IncidentEvent) => {
    const fecha = typeof ev.metadata?.reprogramada_para === "string"
      ? ev.metadata.reprogramada_para
      : incident.reprogramada_para ?? "";
    const msg = `Hola equipo buenas tardes se solicita re programación (${incident.guide_number}) del paquete, para el día (${fmtDay(fecha)})`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(ev.id);
      setTimeout(() => setCopiedId((c) => (c === ev.id ? null : c)), 2000);
    } catch {
      // Clipboard no disponible (contexto inseguro o permiso denegado).
    }
  };

  // Mensaje para el cliente cuando el courier ya no reintenta (>=2 intentos): se
  // cobra el nuevo envio por adelantado a la cuenta de la tienda.
  const cuentaReenvio = CUENTA_REENVIO[storeCode];
  const copyNuevoEnvioMsg = async () => {
    if (!cuentaReenvio) return;
    const nombre = (incident.customer_name || "").trim().split(/\s+/)[0] || "";
    const pedido = incident.order_name || incident.guide_number || "tu pedido";
    const msg = [
      `Buenas${nombre ? ` ${nombre}` : ""}. Tu pedido ${pedido} registró ${intentosEntrega} intentos de entrega sin éxito y el courier ya no realiza más intentos.`,
      ``,
      `Para programar un nuevo envío, te pedimos realizar el pago por adelantado mediante transferencia bancaria a la siguiente cuenta:`,
      ``,
      `Banco: ${cuentaReenvio.banco}`,
      `Titular: ${cuentaReenvio.titular}`,
      `Cuenta (${cuentaReenvio.moneda}): ${cuentaReenvio.cuenta}`,
      ``,
      `En cuanto recibamos el comprobante, coordinamos el reenvío. ¡Gracias!`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedNuevoEnvio(true);
      setTimeout(() => setCopiedNuevoEnvio(false), 2000);
    } catch {
      // Clipboard no disponible (contexto inseguro o permiso denegado).
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <Card className="w-full max-w-2xl lg:max-w-4xl my-8">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_META[incident.status].variant}>{STATUS_META[incident.status].label}</Badge>
            <span className="font-semibold">{incident.order_name || incident.guide_number || "Novedad"}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <CardContent className="p-4">
          <div className="grid gap-4 lg:grid-cols-2">
          {/* Columna izquierda: datos y contexto de la novedad */}
          <div className="space-y-3">
          {/* Datos */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <div><span className="text-muted-foreground">Cliente:</span> {incident.customer_name || "—"}</div>
            <div><span className="text-muted-foreground">Telefono:</span> {incident.customer_phone || "—"}</div>
            <div><span className="text-muted-foreground">Guia:</span> <span className="font-mono text-xs">{incident.guide_number || "—"}</span></div>
            <div><span className="text-muted-foreground">Courier:</span> {incident.courier || "—"}</div>
            <div><span className="text-muted-foreground">COD:</span> {incident.cod_amount ? currency(incident.cod_amount) : "—"}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground">Intentos:</span>
              <span className="text-base font-bold tabular-nums">{trackingEvents.length > 0 ? intentosEntrega : "—"}</span>
            </div>
          </div>
          {intentosEntrega >= 2 && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                Nuevo envío
                <Badge variant="warning" className="ml-1">{intentosEntrega} intentos · sin más reintentos</Badge>
              </p>
              {cuentaReenvio ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    El courier ya no reintenta. Cobra el nuevo envío por adelantado y reprograma cuando recibas el comprobante.
                  </p>
                  <Button variant="outline" size="sm" className="gap-2" onClick={copyNuevoEnvioMsg}>
                    {copiedNuevoEnvio
                      ? <><Check className="h-3.5 w-3.5" /> Copiado</>
                      : <><Copy className="h-3.5 w-3.5" /> Copiar mensaje de nuevo envío</>}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Configura la cuenta de cobro de esta tienda para generar el mensaje.
                </p>
              )}
            </div>
          )}
          {incident.detail && (
            <p className="text-xs bg-muted/40 rounded-md p-2"><span className="text-muted-foreground">Detalle del courier: </span>{incident.detail}</p>
          )}

          {trackingOrdenado.length > 0 && (
            <details className="rounded-md border border-border">
              <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
                <History className="h-4 w-4 text-muted-foreground" />
                Historial del courier{incident.courier ? ` · ${incident.courier}` : ""}
                <Badge variant="muted" className="ml-auto">{trackingOrdenado.length}</Badge>
              </summary>
              <ol className="border-t border-border divide-y divide-border max-h-64 overflow-y-auto">
                {trackingOrdenado.map((ev, i) => (
                  <li key={i} className="px-3 py-2 text-xs space-y-0.5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium">{ev.title || ev.code || "Evento"}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{fmtDate(ev.date)}</span>
                    </div>
                    {(ev.description || ev.note) && (
                      <p className="text-muted-foreground">{ev.description || ev.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
          </div>
          {/* Columna derecha: gestion, notas e historial */}
          <div className="space-y-3">

          {showResultView ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  Reprogramada para {fmtDay(incident.reprogramada_para)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="date" className="h-9 w-auto" value={reprogFecha} onChange={(e) => setReprogFecha(e.target.value)} />
                  <Button variant="outline" size="sm" disabled={busy || !reprogFecha || reprogFecha === incident.reprogramada_para} className="gap-2"
                    onClick={() => onAction("reprogramar", { fecha: reprogFecha })}>
                    <CalendarClock className="h-3.5 w-3.5" /> Actualizar fecha
                  </Button>
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReopened(true)}>
                Reabrir gestion
              </Button>
            </div>
          ) : (
          <>
          {/* Estado y causa */}
          <div className="flex flex-wrap gap-2">
            <select className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={incident.status} onChange={(e) => onPatch({ status: e.target.value })}>
              {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm"
              title="La causa la determina el detalle del courier; no es editable.">
              <span className="text-xs text-muted-foreground">Causa:</span>
              <span className="font-medium">{CATEGORY_LABELS[incident.category]}</span>
            </div>
          </div>

          {/* Acciones */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Llamada</span>
              <Button variant="outline" size="sm" disabled={busy} className="gap-2"
                onClick={() => onAction("registrar_llamada", { resultado: "contesto" })}>
                <Phone className="h-3.5 w-3.5" /> Contesto
              </Button>
              <Button variant="outline" size="sm" disabled={busy} className="gap-2"
                onClick={() => onAction("registrar_llamada", { resultado: "no_contesto" })}>
                <PhoneOff className="h-3.5 w-3.5" /> No contesto
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Reprogramar</span>
              <Input type="date" className="h-9 w-auto" value={reprogFecha} disabled={!puedeReprogramar}
                min={soloFinde ? proxViernes : hoyYMD} max={soloFinde ? proxSabado : undefined}
                onChange={(e) => setReprogFecha(e.target.value)} />
              <Button variant="outline" size="sm" disabled={busy || !reprogFecha || !puedeReprogramar} className="gap-2"
                onClick={() => onAction("reprogramar", { fecha: reprogFecha })}>
                <CalendarClock className="h-3.5 w-3.5" /> Reprogramar
              </Button>
            </div>
            {!puedeReprogramar && (
              <p className="text-[11px] text-muted-foreground">
                Registra una llamada con “Contestó” (o 3 “No contestó” en días distintos) para habilitar la reprogramación.
              </p>
            )}
            {soloFinde && (
              <p className="text-[11px] text-muted-foreground">
                Sin contestar (3 intentos): solo se puede agendar el próximo viernes o sábado.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">Cierre</span>
              <Button variant="outline" size="sm" disabled={busy || incident.status !== "descartada"} className="gap-2"
                title={incident.status === "descartada" ? undefined : "Pon el estado en “Descartada” para habilitar la devolución (RTS)."}
                onClick={() => onAction("rts")}>
                <Undo2 className="h-3.5 w-3.5" /> Devolucion (RTS)
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} className="gap-2" onClick={() => onAction("descartar")}>
                Descartar
              </Button>
            </div>
            {incident.status !== "descartada" && (
              <p className="text-[11px] text-muted-foreground">
                La devolución (RTS) se habilita al poner el estado en “Descartada”.
              </p>
            )}
          </div>
          </>
          )}

          {/* Notas: se registran como eventos del historial */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Agregar nota</p>
            <textarea
              className="w-full min-h-[52px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={nuevaNota} onChange={(e) => setNuevaNota(e.target.value)}
              placeholder="Escribe una nota… (queda en el historial)"
            />
            <div className="mt-1 flex justify-end">
              <Button variant="outline" size="sm" disabled={busy || !nuevaNota.trim()} className="gap-2"
                onClick={async () => { await onAddNote(nuevaNota); setNuevaNota(""); }}>
                <Plus className="h-3.5 w-3.5" /> Agregar nota
              </Button>
            </div>
          </div>

          {/* Historial */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <History className="h-3.5 w-3.5" /> Historial
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin movimientos.</p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="text-xs flex gap-2 border-b border-border/30 py-1">
                    <span className="text-muted-foreground whitespace-nowrap">{fmtDate(ev.created_at)}</span>
                    <span className="font-medium">{EVENT_LABELS[ev.kind] ?? ev.kind}</span>
                    {editingNoteId === ev.id ? (
                      <span className="flex-1 flex flex-col gap-1">
                        <textarea
                          className="w-full min-h-[44px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                          value={editNoteText} onChange={(e) => setEditNoteText(e.target.value)}
                        />
                        <span className="flex gap-1">
                          <button type="button" disabled={busy || !editNoteText.trim()}
                            onClick={async () => { await onEditNote(ev.id, editNoteText); setEditingNoteId(null); }}
                            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-medium hover:bg-muted">
                            <Check className="h-3 w-3" /> Guardar
                          </button>
                          <button type="button" onClick={() => setEditingNoteId(null)}
                            className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted">
                            <X className="h-3 w-3" /> Cancelar
                          </button>
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground flex-1">{ev.message}</span>
                    )}
                    {ev.kind === "nota" && editingNoteId !== ev.id && (
                      <button type="button" title="Editar nota"
                        onClick={() => { setEditingNoteId(ev.id); setEditNoteText(ev.message); }}
                        className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" /> Editar
                      </button>
                    )}
                    {ev.kind === "reprogramada" && (
                      <button
                        type="button"
                        onClick={() => copyReprogMsg(ev)}
                        title="Copiar mensaje de reprogramacion para el courier"
                        className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {copiedId === ev.id
                          ? <><Check className="h-3 w-3" /> Copiado</>
                          : <><Copy className="h-3 w-3" /> Copiar mensaje</>}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewModal({ storeCode, onClose, onCreated }: { storeCode: FinanceStoreCode; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    order_name: "", guide_number: "", customer_name: "", customer_phone: "",
    category: "otro", detail: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.order_name && !form.guide_number && !form.customer_name && !form.customer_phone) {
      return alert("Indica al menos pedido, guia o datos del cliente.");
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/incidents?store=${storeCode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return alert(json.error || "Error al crear");
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4">
      <Card className="w-full max-w-md my-8">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="font-semibold">Nueva novedad</span>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <CardContent className="p-4 space-y-3">
          <Input placeholder="Pedido (ej. #MCRC11518)" value={form.order_name} onChange={(e) => set("order_name", e.target.value)} />
          <Input placeholder="Numero de guia" value={form.guide_number} onChange={(e) => set("guide_number", e.target.value)} />
          <Input placeholder="Nombre del cliente" value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
          <Input placeholder="Telefono" value={form.customer_phone} onChange={(e) => set("customer_phone", e.target.value)} />
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.category} onChange={(e) => set("category", e.target.value)}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <textarea className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Detalle / motivo" value={form.detail} onChange={(e) => set("detail", e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={saving} onClick={submit}>Crear novedad</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
