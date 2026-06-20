"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeft, Ban, CalendarClock, Check, Copy, Download, HelpCircle, History, MapPin,
  PackageX, Pencil, Phone, PhoneOff, Plus, RefreshCw, Search, Undo2, X, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { type Incident, type IncidentEvent, type IncidentStatus, type IncidentCategory, type IncidentExecutiveStats, type IncidentCausaStat, type IncidentPeriodTotal, type TrackingEvent } from "@/lib/incidents-types";
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

// Icono (Lucide) por causa, para el ranking del panel de causas.
const CATEGORY_ICONS: Record<IncidentCategory, LucideIcon> = {
  fallo_entrega: PackageX,
  direccion_incorrecta: MapPin,
  cliente_no_responde: PhoneOff,
  cliente_rechaza: Ban,
  devuelto_origen: Undo2,
  dano_paquete: AlertTriangle,
  otro: HelpCircle,
};

const EVENT_LABELS: Record<string, string> = {
  detectada: "Detectada", estado_cambiado: "Cambio de estado", categoria_cambiada: "Cambio de causa",
  nota: "Nota", llamada: "Llamada", reprogramada: "Reprogramada", no_llamar: "No volver a llamar",
  accion_rts: "Devolucion (RTS)", accion_cancelar_shopify: "Cancelacion Shopify", descartada: "Descartada",
};

const STATUS_ORDER: IncidentStatus[] = [
  "pendiente", "reprogramada", "sin_contestar", "no_llamar", "resuelta", "perdida", "descartada",
];

// Color por estado para las pildoras del control segmentado (dot del inactivo +
// capsula del activo). Sigue la colorimetria de STATUS_META.
const STATUS_PILL: Record<IncidentStatus, { dot: string; active: string }> = {
  pendiente:     { dot: "bg-sky-500",     active: "bg-sky-500 text-white shadow-sm" },
  reprogramada:  { dot: "bg-cyan-500",    active: "bg-cyan-500 text-white shadow-sm" },
  sin_contestar: { dot: "bg-amber-500",   active: "bg-amber-500 text-white shadow-sm" },
  no_llamar:     { dot: "bg-rose-500",    active: "bg-rose-500 text-white shadow-sm" },
  resuelta:      { dot: "bg-emerald-500", active: "bg-emerald-500 text-white shadow-sm" },
  perdida:       { dot: "bg-slate-500",   active: "bg-slate-500 text-white shadow-sm" },
  descartada:    { dot: "bg-zinc-500",    active: "bg-zinc-500 text-white shadow-sm" },
};

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

// Abrevia montos en miles: ₡248 mil.
const fmtMil = (n: number): string => `₡${Math.round((Number(n) || 0) / 1000)} mil`;

// Etiqueta de dia para la tendencia: "lun." -> "Lun"; el ultimo dia -> "Hoy".
function diaLabel(date: string, isHoy: boolean): string {
  if (isHoy) return "Hoy";
  const s = new Date(`${date}T12:00:00`).toLocaleDateString("es-CR", { weekday: "short" }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Color semaforo del % de resolucion: verde >=100, ambar >=60, rojo <60.
function pctTone(pct: number): string {
  if (pct >= 100) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  return "text-red-400";
}

// Semaforo contra la meta: rojo por debajo, amarillo cerca, verde al alcanzarla.
function goalTone(pct: number): { text: string; dot: string } {
  if (pct >= META_RESOLUCION) return { text: "text-emerald-500", dot: "bg-emerald-500" };
  if (pct >= META_RESOLUCION - 10) return { text: "text-amber-500", dot: "bg-amber-500" };
  return { text: "text-rose-500", dot: "bg-rose-500" };
}

// Panel combinado (columna derecha): "Estado actual" (gauge >48h + mini-stats) y
// "Principales causas" (barra de share + ranking), en una sola tarjeta partida.
function EstadoCausasPanel({ exec, onVerTodas }: { exec: IncidentExecutiveStats | null; onVerTodas: () => void }) {
  const est = exec?.estado;
  const abiertas = est?.abiertas ?? 0;
  const over48 = est?.abiertas_48h ?? 0;
  const over48Pct = abiertas ? Math.round((over48 / abiertas) * 100) : 0;
  const causas = exec?.causas ?? [];
  const total30 = causas.reduce((a, c) => a + c.total, 0);
  const maxCant = Math.max(1, ...causas.map((c) => c.total));
  const top = causas.slice(0, 5);
  return (
    <Card className="overflow-hidden">
      {/* Seccion 1: Estado actual */}
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold">Estado actual</div>
            <div className="text-[11px] text-muted-foreground">Salud de la cola en este momento</div>
          </div>
          <span className="rounded-md bg-primary/15 p-1.5 text-primary"><Activity className="h-4 w-4" /></span>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="relative h-[104px] w-[104px] shrink-0 rounded-full"
            style={{ background: `conic-gradient(#f87171 0% ${over48Pct}%, #334155 ${over48Pct}% 100%)` }}>
            <div className="absolute inset-[11px] flex flex-col items-center justify-center rounded-full bg-card">
              <span className="font-mono text-2xl font-bold leading-none text-red-400">{over48}</span>
              <span className="mt-0.5 text-[10px] text-muted-foreground">&gt; 48 h</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start gap-1.5 text-xs">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <span><span className="font-semibold text-foreground">{over48Pct}%</span> de las abiertas llevan <span className="font-semibold">+48 h</span> sin resolver</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Edad promedio</div>
                <div className="font-mono text-xl font-bold leading-tight">{(est?.edad_promedio_dias ?? 0).toFixed(1)}<span className="text-xs font-normal text-muted-foreground">d</span></div>
                {est?.mas_antigua && <div className="text-[10px] text-muted-foreground">más antigua: {est.mas_antigua.dias}d</div>}
              </div>
              <div className="rounded-md border border-border px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">1ª gestión</div>
                <div className="font-mono text-xl font-bold leading-tight">{est?.primera_gestion_horas != null ? est.primera_gestion_horas.toFixed(1) : "—"}<span className="text-xs font-normal text-muted-foreground">h</span></div>
                <div className="text-[10px] text-muted-foreground">creación → 1er llamado</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>

      {/* Seccion 2: Principales causas */}
      <CardContent className="border-t border-border p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-bold">Principales causas</div>
            <div className="text-[11px] text-muted-foreground">Últimos 30 días · % share y recuperación</div>
          </div>
          <button type="button" className="text-[11px] font-medium text-primary hover:underline" onClick={onVerTodas}>Ver todas</button>
        </div>
        {causas.length > 0 ? (
          <>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
              {causas.map((c, i) => (
                <div key={c.category} style={{ width: `${c.pct}%`, backgroundColor: `hsl(263 70% 50% / ${Math.max(0.25, 1 - i * 0.18)})` }} />
              ))}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{total30} incidencias · {causas.length} causa{causas.length === 1 ? "" : "s"}</div>

            <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span className="flex-1">Motivo</span>
              <span className="w-10 text-right">Cant</span>
              <span className="w-10 text-right">Share</span>
              <span className="w-16 text-right">Recuper.</span>
            </div>
            <div className="mt-1.5 space-y-2.5">
              {top.map((c) => {
                const Icon = CATEGORY_ICONS[c.category] ?? HelpCircle;
                const recTone = c.recuperacion >= 50 ? "bg-emerald-500/15 text-emerald-400"
                  : c.recuperacion >= 25 ? "bg-amber-500/15 text-amber-400"
                  : "bg-red-500/15 text-red-400";
                return (
                  <div key={c.category} className="flex items-center gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{CATEGORY_LABELS[c.category]}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(c.total / maxCant) * 100}%` }} />
                      </div>
                    </div>
                    <span className="w-10 text-right font-mono text-sm font-bold tabular-nums">{c.total}</span>
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">{Math.round(c.pct)}%</span>
                    <span className="w-16 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${recTone}`}>{Math.round(c.recuperacion)}% rec.</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : <p className="mt-3 text-center text-xs text-muted-foreground">Sin incidencias en el período.</p>}
      </CardContent>
    </Card>
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

// Tabla "Tendencia de 7 días": por día nuevas vs. resueltas (barra + cifras) y
// pie de totales (7d / 30d / mes actual / mes pasado).
function Tendencia({ exec }: { exec: IncidentExecutiveStats | null }) {
  const dias = (exec?.trend ?? []).slice(-7);
  const maxNuevas = Math.max(1, ...dias.map((d) => d.generadas));
  const totales: { label: string; t: IncidentPeriodTotal }[] = exec
    ? [
        { label: "Total 7 días", t: exec.totales.d7 },
        { label: "Total 30 días", t: exec.totales.d30 },
        { label: "Mes actual", t: exec.totales.mesActual },
        { label: "Mes pasado", t: exec.totales.mesPasado },
      ]
    : [];
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm font-semibold">Tendencia de 7 días</div>
        <div className="mb-3 text-xs text-muted-foreground">Nuevas vs. resueltas por día</div>

        <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
          <span className="w-10 shrink-0">Día</span>
          <span className="flex-1">Resuelto vs. nuevas</span>
          <span className="w-12 shrink-0 text-right text-primary">Nuevas</span>
          <span className="w-12 shrink-0 text-right text-emerald-400">Resuel.</span>
          <span className="w-10 shrink-0 text-right">%</span>
          <span className="w-16 shrink-0 text-right text-amber-400">Recuper.</span>
        </div>

        <div className="mt-1.5 space-y-1.5">
          {dias.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Sin datos.</p>}
          {dias.map((d, i) => {
            const isHoy = i === dias.length - 1;
            const pct = d.generadas ? Math.round((d.resueltas / d.generadas) * 100) : 0;
            return (
              <div key={d.date} className="flex items-center gap-3 text-xs">
                <span className={`w-10 shrink-0 ${isHoy ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                  {diaLabel(d.date, isHoy)}
                </span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary/35"
                    style={{ width: `${Math.min(100, (d.generadas / maxNuevas) * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-400"
                    style={{ width: `${Math.min(100, (d.resueltas / maxNuevas) * 100)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right font-mono font-bold tabular-nums text-primary">{d.generadas}</span>
                <span className="w-12 shrink-0 text-right font-mono font-bold tabular-nums text-emerald-400">{d.resueltas}</span>
                <span className={`w-10 shrink-0 text-right font-mono tabular-nums ${pctTone(pct)}`}>{pct}%</span>
                <span className="w-16 shrink-0 text-right font-mono tabular-nums text-amber-400">{fmtMil(d.recuperado)}</span>
              </div>
            );
          })}
        </div>

        {totales.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-border pt-3">
            {totales.map((row) => {
              const pct = row.t.nuevas ? Math.round((row.t.resueltas / row.t.nuevas) * 100) : 0;
              return (
                <div key={row.label} className="flex items-center gap-3 text-xs">
                  <span className="flex-1 text-muted-foreground">{row.label}</span>
                  <span className="w-20 shrink-0 text-right font-mono tabular-nums">
                    <span className="font-bold text-primary">{row.t.nuevas}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">nuevas</span>
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono tabular-nums">
                    <span className="font-bold text-emerald-400">{row.t.resueltas}</span>
                    <span className="ml-1 text-[10px] text-muted-foreground">resueltas</span>
                  </span>
                  <span className={`w-10 shrink-0 text-right font-mono tabular-nums ${pctTone(pct)}`}>{pct}%</span>
                  <span className="w-16 shrink-0 text-right font-mono tabular-nums text-amber-400">{fmtMil(row.t.recuperado)}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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

// Una opcion de un control segmentado (va dentro de un track hundido). Activa =
// capsula rellena; inactiva = texto muted que se aclara al hover. Soporta color
// por estado (dot inactivo + activeClass) y conteo inline.
function FilterPill({ active, onClick, count, dot, activeClass, children }: {
  active: boolean; onClick: () => void; count?: number; dot?: string; activeClass?: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? (activeClass ?? "bg-primary text-primary-foreground shadow-sm")
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      }`}
    >
      {dot && !active && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
      {count != null && (
        <span className={`tabular-nums text-[10px] ${active ? "opacity-80" : "opacity-60"}`}>{count}</span>
      )}
    </button>
  );
}

export default function IncidenciasPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selectedStoreCode, setSelectedStoreCode] = useSelectedStore();
  const [soloReintento, setSoloReintento] = useState(false);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(120);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [trackingSync, setTrackingSync] = useState<string | null>(null);
  const [exec, setExec] = useState<IncidentExecutiveStats | null>(null);
  const [showCausas, setShowCausas] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [selected, setSelected] = useState<Incident | null>(null);
  const [events, setEvents] = useState<IncidentEvent[]>([]);
  const [trackingEvents, setTrackingEvents] = useState<TrackingEvent[]>([]);
  const [orderProducts, setOrderProducts] = useState("");
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
      setVisibleCount(120);
      setCounts(json.counts ?? {});
      setCategoryCounts(json.category_counts ?? {});
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
      setOrderProducts(json.order_products ?? "");
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

  const shown = incidents.slice(0, visibleCount);
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

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
        {/* Tendencia (izquierda) + panel Estado actual / Causas (derecha, ~420px) */}
        <div className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Tendencia exec={exec} />
          <EstadoCausasPanel exec={exec} onVerTodas={() => setShowCausas(true)} />
        </div>

        {/* Filtros: pildoras de estado (con conteo) + causa + busqueda */}
        <Card>
          <CardContent className="p-3 space-y-2">
            {/* Estado (control segmentado, color por estado) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estado</span>
              <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-1">
                <FilterPill active={!soloReintento && statusFilter === ""} count={totalCount}
                  onClick={() => { setSoloReintento(false); setStatusFilter(""); }}>Todas</FilterPill>
                {STATUS_ORDER.map((s) => (
                  <FilterPill key={s} active={!soloReintento && statusFilter === s} count={counts[s] ?? 0}
                    dot={STATUS_PILL[s].dot} activeClass={STATUS_PILL[s].active}
                    onClick={() => { setSoloReintento(false); setStatusFilter(statusFilter === s ? "" : s); }}>
                    {STATUS_META[s].label}
                  </FilterPill>
                ))}
              </div>
              <FilterPill active={soloReintento}
                onClick={() => { setStatusFilter(""); setSoloReintento(!soloReintento); }}>
                <CalendarClock className="h-3 w-3" /> Reintento fin del día
              </FilterPill>
            </div>

            {/* Causa (control segmentado, con conteo) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Causa</span>
              <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-1">
                <FilterPill active={categoryFilter === ""} count={totalCount}
                  onClick={() => setCategoryFilter("")}>Todas</FilterPill>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <FilterPill key={k} active={categoryFilter === k} count={categoryCounts[k] ?? 0}
                    onClick={() => setCategoryFilter(categoryFilter === k ? "" : k)}>{v}</FilterPill>
                ))}
              </div>
            </div>

            {/* Busqueda + exportar */}
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8 h-9" placeholder="Buscar pedido, guía o cliente…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" className="gap-2 h-9"
                disabled={exporting || loading || !incidents.length} onClick={exportarExcel}
                title="Descarga en Excel las novedades del filtro actual">
                <Download className="h-3.5 w-3.5" />
                {exporting ? "Exportando…" : `Exportar (${incidents.length})`}
              </Button>
            </div>
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
          {incidents.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
              <span>Mostrando {shown.length} de {incidents.length}</span>
              {incidents.length > shown.length && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setVisibleCount((n) => n + 120)}>
                    Cargar más
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setVisibleCount(incidents.length)}>
                    Mostrar todas
                  </Button>
                </div>
              )}
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
          orderProducts={orderProducts}
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
  storeCode, incident, events, trackingEvents, orderProducts, busy, reprogFecha, setReprogFecha, onClose, onPatch, onAction, onAddNote, onEditNote,
}: {
  storeCode: FinanceStoreCode;
  incident: Incident; events: IncidentEvent[]; trackingEvents: TrackingEvent[]; orderProducts: string; busy: boolean;
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
          {orderProducts && (
            <div className="text-sm"><span className="text-muted-foreground">Producto:</span> {orderProducts}</div>
          )}
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
