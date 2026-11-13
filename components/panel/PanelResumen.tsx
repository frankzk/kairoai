"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, PackageOpen, PhoneOff, RefreshCw, TriangleAlert } from "lucide-react";
import { getCurrencySymbol, getFinanceStore } from "@/lib/store-config";
import { useSelectedStore } from "@/lib/use-selected-store";
import { leerYo, tienePermiso, type Yo } from "@/lib/sesion-cliente";
import type { Permiso } from "@/lib/permisos";
import {
  buildFunnel,
  buildPanelMetrics,
  chartRangeFor,
  comparisonLabel,
  comparisonSentence,
  DEFAULT_PANEL_RANGE,
  isPanelRange,
  moneyFormatter,
  panelRangeLabel,
  panelRangePhrase,
  parseDailyResponse,
  parseKpisResponse,
  type PanelRange,
} from "@/lib/panel-resumen";
import { joinParts, summarizeDispatch, summarizeIncidents, summarizeLeads } from "@/lib/panel-atencion";
import { cn } from "@/lib/utils";
import { useEndpoint, type BlockState } from "./useEndpoint";
import { PeriodControl } from "./PeriodControl";
import { MetricStrip } from "./MetricStrip";
import { DailyOrdersChart } from "./DailyOrdersChart";
import { FunnelCard } from "./FunnelCard";
import { AttentionList, type AttentionItem } from "./AttentionList";
import { BlockNotice } from "./BlockNotice";

const RANGE_KEY = "kairo:panel-periodo";
const OPERACION: Permiso[] = ["pedidos", "finanzas"];
const LEADS: Permiso[] = ["leads", "leads_equipo"];

function readRange(): PanelRange {
  try {
    const saved = window.localStorage.getItem(RANGE_KEY);
    return isPanelRange(saved) ? saved : DEFAULT_PANEL_RANGE;
  } catch {
    return DEFAULT_PANEL_RANGE;
  }
}

const q = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** Resultado de un bloque de "Para atender ahora": cifra + detalle. */
function toAttention<T>(state: BlockState<T>, shape: (data: T) => { count: number; detail: string }) {
  return state.status === "ready"
    ? { status: "ready" as const, data: shape(state.data), refreshing: state.refreshing }
    : state;
}

/**
 * Panel (inicio): como va la tienda elegida en el menu. Metricas del periodo
 * con su comparacion, pedidos por dia, embudo y lo que hay que atender ahora.
 * Cada bloque viene de una ruta existente y se degrada solo (ver useEndpoint).
 */
export function PanelResumen() {
  const [storeCode] = useSelectedStore();
  const store = getFinanceStore(storeCode);
  const [range, setRangeState] = useState<PanelRange>(DEFAULT_PANEL_RANGE);
  const [nonce, setNonce] = useState(0);
  // undefined = todavia no se leyo la cookie (no se pide nada hasta saberlo).
  const [yo, setYo] = useState<Yo | null | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    setYo(leerYo());
    setRangeState(readRange());
  }, []);

  const setRange = useCallback((next: PanelRange) => {
    setRangeState(next);
    try {
      window.localStorage.setItem(RANGE_KEY, next);
    } catch {
      // Solo una comodidad: sin almacenamiento el periodo vuelve al de siempre.
    }
  }, []);

  // Sin cookie legible (no deberia pasar con sesion) se intenta igual: el
  // servidor responde 403 y el bloque dice "Sin acceso".
  const can = (perms: Permiso[]) => yo === null || (yo !== undefined && perms.some((p) => tienePermiso(yo, p)));
  const ready = yo !== undefined;
  const canOps = can(OPERACION);
  const scope = store.code;
  const opts = (allowed: boolean) => ({ allowed: !ready || allowed, scope, nonce });

  const chartRange = chartRangeFor(range);
  const kpis = useEndpoint(
    ready ? q("/api/finance/kpis", { period: range, store: store.code }) : null,
    parseKpisResponse,
    opts(canOps)
  );
  const daily = useEndpoint(
    ready ? q("/api/finance/kpis/daily", { period: range, store: store.code }) : null,
    parseDailyResponse,
    opts(canOps)
  );
  // Hoy y Ayer son un solo dia: el grafico pide los ultimos 7 para tener serie.
  const chartDaily = useEndpoint(
    ready && chartRange !== range ? q("/api/finance/kpis/daily", { period: chartRange, store: store.code }) : null,
    parseDailyResponse,
    opts(canOps)
  );
  const incidents = useEndpoint(
    // status=pendiente solo achica la lista; los conteos y metricas son de toda la tienda.
    ready ? q("/api/incidents", { store: store.code, status: "pendiente" }) : null,
    summarizeIncidents,
    opts(can(["novedades"]))
  );
  const leads = useEndpoint(ready ? q("/api/leads", { store: store.code }) : null, summarizeLeads, opts(can(LEADS)));
  const dispatch = useEndpoint(
    ready
      ? q("/api/finance/orders", { store: store.code, status: "despacho_solicitado", pageSize: "1" })
      : null,
    summarizeDispatch,
    opts(canOps)
  );

  const kpisSettled = kpis.status !== "loading" && !(kpis.status === "ready" && kpis.refreshing);
  useEffect(() => {
    if (kpisSettled) setUpdatedAt(new Date());
  }, [kpisSettled, kpis]);

  const money = useMemo(() => moneyFormatter(store.locale, getCurrencySymbol(store.code)), [store.locale, store.code]);
  const rangeLabel = panelRangeLabel(range);
  const kpiData = kpis.status === "ready" ? kpis.data : null;
  const versus = kpiData ? comparisonLabel(range, kpiData.window) : null;
  const metrics = useMemo(
    () =>
      kpiData
        ? buildPanelMetrics({
            current: kpiData.current,
            previous: kpiData.previous,
            sales: daily.status === "ready" ? { current: daily.data.current, previous: daily.data.previous } : null,
            versus,
            money,
          })
        : null,
    [kpiData, daily, versus, money]
  );
  const compareText = kpiData ? comparisonSentence(kpiData.window?.compareLabel) : null;
  const cutoff = kpiData?.window?.cutoffLabel ?? null;
  const refreshing =
    [kpis, daily, chartDaily, incidents, leads, dispatch].some((s) => s.status === "ready" && s.refreshing) ||
    (ready && kpis.status === "loading");

  const chartState = chartRange === range ? daily : chartDaily;
  const singleDay = chartRange !== range;

  const attention: AttentionItem[] = [
    {
      id: "novedades",
      title: "Novedades abiertas",
      href: "/admin/incidencias",
      linkLabel: "Abrir Novedades",
      icon: TriangleAlert,
      empty: "Sin novedades abiertas",
      state: toAttention(incidents, (d) => ({
        count: d.open,
        detail: joinParts([
          [d.unattended, "sin gestionar"],
          [d.over48h ?? 0, "con más de 48 h"],
        ]),
      })),
    },
    {
      id: "leads",
      title: "Leads sin llamar",
      href: "/admin/leads",
      linkLabel: "Abrir Leads",
      icon: PhoneOff,
      empty: "Nadie esperando llamada",
      state: toAttention(leads, (d) => ({
        count: d.uncalled,
        detail: [joinParts([[d.uncalledWithCart, "con carrito"]]), "últimos 30 días"].filter(Boolean).join(" · "),
      })),
    },
    {
      id: "despacho",
      title: "Pendientes de despacho",
      href: "/admin/finance",
      linkLabel: "Abrir Gestión de pedidos",
      icon: PackageOpen,
      empty: "Nada esperando despacho",
      state: toAttention(dispatch, (d) => ({
        count: d.pending,
        detail: joinParts([
          [d.toRequest, "por solicitar"],
          [d.waitingGuide, "esperando guía"],
          [d.waitingPickup, "esperando recolección"],
        ]),
      })),
    },
  ];

  const clock = updatedAt
    ? new Intl.DateTimeFormat("es-CR", { timeZone: store.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(updatedAt)
    : null;

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1280px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Panel</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumen de {store.label} · {rangeLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {clock && (
            <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              Actualizado {clock}
            </span>
          )}
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground shadow-[0_1px_2px_rgb(16_16_32/0.04)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 motion-reduce:transition-none"
          >
            <RefreshCw
              className={cn("h-4 w-4 text-muted-foreground", refreshing && "animate-spin motion-reduce:animate-none")}
              aria-hidden="true"
            />
            Actualizar
          </button>
        </div>
      </header>

      <AttentionList items={attention} />

      <section aria-labelledby="panel-period-title" className="space-y-3">
        <h2 id="panel-period-title" className="sr-only">
          Resultados del periodo: {rangeLabel}
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PeriodControl value={range} onChange={setRange} />
          {(compareText || cutoff) && (
            <p className="text-xs text-muted-foreground">{[compareText, cutoff].filter(Boolean).join(" · ")}</p>
          )}
        </div>

        {kpis.status === "sin_acceso" || kpis.status === "no_disponible" ? (
          <div className="rounded-lg border border-border bg-card px-4 py-4">
            <BlockNotice
              failure={kpis.status}
              noAccess="Las métricas de pedidos son de Gestión de pedidos o Finanzas."
              unavailable="No se pudieron calcular las métricas. Prueba con Actualizar."
            />
          </div>
        ) : (
          <MetricStrip
            metrics={metrics}
            loading={kpis.status === "loading"}
            refreshing={kpis.status === "ready" && kpis.refreshing}
          />
        )}
        {kpiData?.window?.maturing && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Los pedidos recientes siguen en camino: la entrega efectiva del periodo todavía puede subir.
          </p>
        )}

        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <DailyOrdersChart
              state={chartState}
              money={money}
              subtitle={`${panelRangeLabel(chartRange)}, según su estado de hoy`}
              note={singleDay ? "El periodo es de un solo día: el gráfico muestra los últimos 7 días para dar contexto." : null}
            />
          </div>
          <FunnelCard
            periodPhrase={panelRangePhrase(range)}
            funnel={kpiData ? buildFunnel(kpiData.current) : null}
            failure={kpis.status === "sin_acceso" || kpis.status === "no_disponible" ? kpis.status : null}
            refreshing={kpis.status === "ready" && kpis.refreshing}
          />
        </div>
      </section>
    </main>
  );
}
