// Panel (inicio): periodos, metricas comparadas y embudo de la tienda elegida.
//
// Modulo puro, sin red ni React: toma lo que YA devuelven /api/finance/kpis
// (OpMetrics actual y anterior) y /api/finance/kpis/daily (serie y valor) y lo
// convierte en lo que pinta la pantalla. Nunca inventa una cifra: si un dato no
// vino, la metrica dice "Sin datos" o no lleva comparacion.
// Se prueba en tests/panel-resumen.test.ts.

import type { KpiRange, KpiWindow } from "./kpi-windows";
import { comparisonPeriodCopy } from "./kpi-comparison-copy";
import type { PanelDay, PanelTotals } from "./panel-serie";

/** Los campos de OpMetrics (lib/finance-orders.ts) que usa el Panel. */
export interface PanelOpMetrics {
  generated: number;
  dispatched: number;
  delivered: number;
  notDelivered: number;
  annulled: number;
  annulledExcluded?: number;
  enRoute: number;
  enRouteRetry: number;
  confirmed?: number;
  confirmedNotDispatched?: number;
  inProgress?: number;
  deliveryRate: number;
  dispatchRate: number;
  annulRate: number;
  confirmRate?: number | null;
  ticket: number;
}

// ─── Periodos ────────────────────────────────────────────────────────────────

export type PanelRange = Extract<KpiRange, "today" | "yesterday" | "7d" | "30d" | "month">;

export const PANEL_RANGES: Array<{ value: PanelRange; label: string; long: string; phrase: string }> = [
  { value: "today", label: "Hoy", long: "Hoy", phrase: "hoy" },
  { value: "yesterday", label: "Ayer", long: "Ayer", phrase: "ayer" },
  { value: "7d", label: "7 días", long: "Últimos 7 días", phrase: "en los últimos 7 días" },
  { value: "30d", label: "30 días", long: "Últimos 30 días", phrase: "en los últimos 30 días" },
  { value: "month", label: "Este mes", long: "Este mes", phrase: "este mes" },
];

export const DEFAULT_PANEL_RANGE: PanelRange = "7d";

export function isPanelRange(value: unknown): value is PanelRange {
  return PANEL_RANGES.some((r) => r.value === value);
}

export function panelRangeLabel(range: PanelRange): string {
  return PANEL_RANGES.find((r) => r.value === range)?.long ?? "";
}

/** Para una frase: "Pedidos generados hoy", "... en los últimos 7 días". */
export function panelRangePhrase(range: PanelRange): string {
  return PANEL_RANGES.find((r) => r.value === range)?.phrase ?? "";
}

/**
 * Periodo del grafico diario. Un solo dia (Hoy, Ayer) no hace una serie: se
 * muestra en el contexto de los ultimos 7 dias.
 */
export function chartRangeFor(range: PanelRange): PanelRange {
  return range === "today" || range === "yesterday" ? "7d" : range;
}

/** "vs. 7 días previos" o null si el periodo no tiene base comparable. */
export function comparisonLabel(
  range: PanelRange,
  window: Pick<KpiWindow, "prevStart" | "prevEnd" | "cutoffLabel" | "compareLabel"> | null | undefined
): string | null {
  if (!window || window.prevStart == null || window.prevEnd == null) return null;
  return comparisonPeriodCopy(range, window)?.versus ?? null;
}

// ─── Formatos ────────────────────────────────────────────────────────────────

const INT = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 });
const ONE = new Intl.NumberFormat("es-CR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatInt = (value: number) => INT.format(Math.round(value));
export const formatPct = (value: number) => `${ONE.format(value)} %`;

/** Monto en la moneda de la tienda con su simbolo (₡ 12 345, L 1 234). */
export function moneyFormatter(locale: string, symbol: string): (value: number) => string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const sep = /[A-Za-z]$/.test(symbol.trim()) ? " " : "";
  return (value) => `${symbol.trim()}${sep}${number.format(Math.round(value))}`;
}

/** Monto corto para ejes: ₡1,2 M, ₡850 k. */
export function compactMoneyFormatter(symbol: string): (value: number) => string {
  const sep = /[A-Za-z]$/.test(symbol.trim()) ? " " : "";
  return (value) => {
    const abs = Math.abs(value);
    const text =
      abs >= 1_000_000
        ? `${ONE.format(value / 1_000_000).replace(/,0$/, "")} M`
        : abs >= 1_000
          ? `${INT.format(value / 1_000)} k`
          : INT.format(value);
    return `${symbol.trim()}${sep}${text}`;
  };
}

// ─── Metricas con comparacion ────────────────────────────────────────────────

export type DeltaTone = "good" | "bad" | "neutral";

export interface PanelDelta {
  /** "+12,4 %", "−3,1 pp", "Sin cambio". */
  text: string;
  direction: "up" | "down" | "flat";
  tone: DeltaTone;
  /** Texto accesible completo: "Sube 12,4 % vs. 7 días previos". */
  spoken: string;
}

export interface PanelMetric {
  id: "generated" | "confirm" | "dispatch" | "delivery" | "annul" | "ticket" | "sales";
  label: string;
  /** Cifra principal, ya formateada; "—" si no hay base. */
  value: string;
  /** Linea de apoyo: de donde sale la cifra ("812 de 1.284 confirmados"). */
  detail: string;
  /** Valor del periodo anterior, formateado, o null sin comparacion. */
  previous: string | null;
  delta: PanelDelta | null;
  /** Explicacion de la metrica (title). */
  hint: string;
  /** No vino el dato (p. ej. la serie de ventas fallo). */
  unavailable?: boolean;
}

function signed(value: number, unit: string): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${ONE.format(Math.abs(value))} ${unit}`;
}

function buildDelta(
  diff: number | null,
  unit: "%" | "pp",
  upIsGood: boolean,
  versus: string
): PanelDelta | null {
  if (diff == null || !Number.isFinite(diff)) return null;
  const rounded = Math.round(diff * 10) / 10;
  if (rounded === 0) {
    return { text: "Sin cambio", direction: "flat", tone: "neutral", spoken: `Sin cambio ${versus}` };
  }
  const direction = rounded > 0 ? "up" : "down";
  const improves = direction === "up" ? upIsGood : !upIsGood;
  const text = signed(rounded, unit);
  return {
    text,
    direction,
    tone: improves ? "good" : "bad",
    spoken: `${direction === "up" ? "Sube" : "Baja"} ${text.replace(/^[+−]/, "")} ${versus}`,
  };
}

/** Cambio porcentual; null sin base (anterior en cero o sin dato). */
export function pctChange(current: number, previous: number | null | undefined): number | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null;
  return (current / previous - 1) * 100;
}

/** Diferencia en puntos porcentuales; null si alguna tasa no tiene base. */
export function ppChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return current - previous;
}

export interface PanelMetricsInput {
  current: PanelOpMetrics;
  previous: PanelOpMetrics | null;
  /** Totales de valor de la serie diaria; null si la serie no vino. */
  sales: { current: PanelTotals; previous: PanelTotals | null } | null;
  /** "vs. 7 días previos"; null si el periodo no tiene comparacion. */
  versus: string | null;
  money: (value: number) => string;
}

export function confirmRateOf(m: PanelOpMetrics): number | null {
  if (m.confirmRate !== undefined) return m.confirmRate;
  if (m.confirmed == null || m.generated <= 0) return null;
  return (m.confirmed / m.generated) * 100;
}

/**
 * Las siete metricas del periodo. Las tasas se comparan en puntos (pp) y solo
 * cuando las dos ventanas tienen base; los conteos y montos, en %.
 */
export function buildPanelMetrics({ current: cur, previous: prev, sales, versus, money }: PanelMetricsInput): PanelMetric[] {
  const compare = versus != null && prev != null;
  const vs = versus ?? "";
  const hasGen = cur.generated > 0;
  const prevGen = compare && prev!.generated > 0;
  const curConfirm = confirmRateOf(cur);
  const prevConfirm = prev ? confirmRateOf(prev) : null;
  const rate = (value: number | null, base: boolean) => (base && value != null ? formatPct(value) : "—");

  const metrics: PanelMetric[] = [
    {
      id: "generated",
      label: "Pedidos generados",
      value: formatInt(cur.generated),
      detail: cur.annulledExcluded ? `${formatInt(cur.annulledExcluded)} no cuentan` : "creados en el periodo",
      previous: compare ? formatInt(prev!.generated) : null,
      delta: compare ? buildDelta(pctChange(cur.generated, prev!.generated), "%", true, vs) : null,
      hint: "Pedidos creados en el periodo. No cuentan los duplicados, lista negra, upsell, testeos ni agotados.",
    },
    {
      id: "confirm",
      label: "Confirmación",
      value: rate(curConfirm, hasGen),
      detail: hasGen && cur.confirmed != null ? `${formatInt(cur.confirmed)} confirmados` : "Sin pedidos",
      previous: compare && prevGen && prevConfirm != null ? formatPct(prevConfirm) : null,
      delta: compare && hasGen && prevGen ? buildDelta(ppChange(curConfirm, prevConfirm), "pp", true, vs) : null,
      hint: "Tasa de confirmación: confirmados ÷ generados. Confirmado: en iComfly está Confirmada o posterior, o ya tiene guía.",
    },
    {
      id: "dispatch",
      label: "Despacho",
      value: rate(cur.dispatchRate, hasGen),
      detail: hasGen ? `${formatInt(cur.dispatched)} con guía` : "Sin pedidos",
      previous: compare && prevGen ? formatPct(prev!.dispatchRate) : null,
      delta: compare && hasGen && prevGen ? buildDelta(ppChange(cur.dispatchRate, prev!.dispatchRate), "pp", true, vs) : null,
      hint: "Tasa de despacho: despachados (con guía) ÷ generados.",
    },
    {
      id: "delivery",
      label: "Entrega efectiva",
      value: rate(cur.deliveryRate, cur.dispatched > 0),
      detail: cur.dispatched > 0 ? `${formatInt(cur.delivered)} entregados` : "Sin despachos",
      previous: compare && prev!.dispatched > 0 ? formatPct(prev!.deliveryRate) : null,
      delta:
        compare && cur.dispatched > 0 && prev!.dispatched > 0
          ? buildDelta(ppChange(cur.deliveryRate, prev!.deliveryRate), "pp", true, vs)
          : null,
      hint: "Entregados ÷ despachados. En periodos recientes sigue subiendo mientras se entregan los pedidos en ruta.",
    },
    {
      id: "annul",
      label: "Anulación",
      value: rate(cur.annulRate, hasGen),
      detail: hasGen ? `${formatInt(cur.annulled)} anulados` : "Sin pedidos",
      previous: compare && prevGen ? formatPct(prev!.annulRate) : null,
      delta: compare && hasGen && prevGen ? buildDelta(ppChange(cur.annulRate, prev!.annulRate), "pp", false, vs) : null,
      hint: "Anulados ÷ generados. Bajar es bueno.",
    },
    {
      id: "ticket",
      label: "Ticket promedio",
      value: cur.ticket > 0 ? money(cur.ticket) : "—",
      detail: "valor por pedido",
      previous: compare && prev!.ticket > 0 ? money(prev!.ticket) : null,
      delta: compare && cur.ticket > 0 && prev!.ticket > 0 ? buildDelta(pctChange(cur.ticket, prev!.ticket), "%", true, vs) : null,
      hint: "Valor promedio de los pedidos generados con monto.",
    },
  ];

  const salesPrev = compare ? sales?.previous ?? null : null;
  metrics.push(
    sales
      ? {
          id: "sales",
          label: "Ventas",
          value: money(sales.current.value),
          detail: `${money(sales.current.deliveredValue)} entregado`,
          previous: salesPrev ? money(salesPrev.value) : null,
          delta: salesPrev ? buildDelta(pctChange(sales.current.value, salesPrev.value), "%", true, vs) : null,
          hint: "Valor de los pedidos generados en el periodo (incluye anulados, como el ticket). Abajo, lo que ya se entregó.",
        }
      : {
          id: "sales",
          label: "Ventas",
          value: "Sin datos",
          detail: "No disponible",
          previous: null,
          delta: null,
          hint: "No se pudo calcular el valor de los pedidos del periodo.",
          unavailable: true,
        }
  );
  return metrics;
}

// ─── Embudo del periodo ──────────────────────────────────────────────────────

export interface FunnelStep {
  id: "generated" | "confirmed" | "dispatched" | "delivered";
  label: string;
  value: number;
  /** % sobre los generados (0-100), null sin generados. */
  share: number | null;
}

export interface PanelFunnel {
  steps: FunnelStep[];
  /** Lo que queda fuera del camino feliz, para el pie del embudo. */
  aside: Array<{ id: string; label: string; value: number }>;
}

export function buildFunnel(m: PanelOpMetrics): PanelFunnel {
  const base = m.generated;
  const share = (v: number) => (base > 0 ? (v / base) * 100 : null);
  const confirmed = m.confirmed ?? m.dispatched;
  const steps: FunnelStep[] = [
    { id: "generated", label: "Generados", value: base, share: share(base) },
    { id: "confirmed", label: "Confirmados", value: confirmed, share: share(confirmed) },
    { id: "dispatched", label: "Despachados", value: m.dispatched, share: share(m.dispatched) },
    { id: "delivered", label: "Entregados", value: m.delivered, share: share(m.delivered) },
  ];
  const aside = [
    m.inProgress != null ? { id: "inProgress", label: "En gestión", value: m.inProgress } : null,
    { id: "enRoute", label: "En reparto", value: m.enRoute + m.enRouteRetry },
    { id: "notDelivered", label: "No entregados", value: m.notDelivered },
    { id: "annulled", label: "Anulados", value: m.annulled },
  ].filter((x): x is { id: string; label: string; value: number } => x != null);
  return { steps, aside };
}

// ─── Columnas por dia, segun el estado de hoy ────────────────────────────────

/**
 * Partes de cada dia, de abajo hacia arriba. Suman los generados del dia:
 * entregados + despachados sin entregar + confirmados sin guia + en gestion +
 * anulados. El color sigue al estado (orden fijo de la paleta), nunca al rango.
 */
export const DAY_PARTS = [
  { key: "delivered", label: "Entregados", color: "var(--mk-series-1)" },
  { key: "shipped", label: "Despachados sin entregar", color: "var(--mk-series-2)" },
  { key: "noGuide", label: "Confirmados sin guía", color: "var(--mk-series-3)" },
  { key: "working", label: "En gestión", color: "var(--mk-other)" },
  { key: "annulled", label: "Anulados", color: "var(--mk-series-4)" },
] as const;

export type DayPartKey = (typeof DAY_PARTS)[number]["key"];

export function splitDay(day: PanelDay): Record<DayPartKey, number> {
  const pos = (v: number) => Math.max(0, v);
  const delivered = pos(day.delivered);
  const shipped = pos(day.dispatched - day.delivered);
  const noGuide = pos(day.confirmed - day.dispatched);
  const annulled = pos(day.annulled);
  const working = pos(day.generated - delivered - shipped - noGuide - annulled);
  return { delivered, shipped, noGuide, working, annulled };
}

/** Promedio de generados por dia (para la linea de referencia). */
export function averagePerDay(days: PanelDay[]): number | null {
  if (!days.length) return null;
  return days.reduce((sum, d) => sum + d.generated, 0) / days.length;
}

/** "13 nov" / "jue 13 nov" para un dia YYYY-MM-DD. */
export function dayLabel(date: string, withWeekday = false): string {
  const text = new Intl.DateTimeFormat("es-CR", {
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  return text.replace(/\./g, "");
}

/**
 * Frase de la comparacion a partir de compareLabel de getKpiWindows:
 * "vs. 7 días previos, misma hora" -> "Comparado con 7 días previos, misma hora".
 */
export function comparisonSentence(compareLabel: string | null | undefined): string | null {
  const text = String(compareLabel ?? "").trim();
  if (!text) return null;
  if (/^vs\.\s*/i.test(text)) return `Comparado con ${text.replace(/^vs\.\s*/i, "")}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─── Respuestas de las rutas ─────────────────────────────────────────────────

export interface PanelKpisResponse {
  current: PanelOpMetrics;
  previous: PanelOpMetrics | null;
  window: Pick<KpiWindow, "prevStart" | "prevEnd" | "compareLabel" | "cutoffLabel" | "maturing"> | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMetrics = (v: unknown): v is PanelOpMetrics =>
  isRecord(v) && typeof v.generated === "number" && typeof v.dispatched === "number" && typeof v.ticket === "number";

/** /api/finance/kpis. Lanza si no trae las metricas actuales (no es un cero). */
export function parseKpisResponse(json: unknown): PanelKpisResponse {
  if (!isRecord(json) || !isMetrics(json.current)) throw new Error("Respuesta de KPIs inválida");
  const w = isRecord(json.window) ? json.window : null;
  return {
    current: json.current,
    previous: isMetrics(json.previous) ? json.previous : null,
    window: w
      ? {
          prevStart: typeof w.prevStart === "number" ? w.prevStart : null,
          prevEnd: typeof w.prevEnd === "number" ? w.prevEnd : null,
          compareLabel: typeof w.compareLabel === "string" ? w.compareLabel : "",
          cutoffLabel: typeof w.cutoffLabel === "string" ? w.cutoffLabel : undefined,
          maturing: w.maturing === true,
        }
      : null,
  };
}

export interface PanelDailyResponse {
  days: PanelDay[];
  current: PanelTotals;
  previous: PanelTotals | null;
}

const isTotals = (v: unknown): v is PanelTotals =>
  isRecord(v) && typeof v.value === "number" && typeof v.deliveredValue === "number" && typeof v.generated === "number";

/** /api/finance/kpis/daily. */
export function parseDailyResponse(json: unknown): PanelDailyResponse {
  if (!isRecord(json) || !Array.isArray(json.days) || !isTotals(json.current)) {
    throw new Error("Respuesta de la serie diaria inválida");
  }
  const days = (json.days as unknown[]).filter(
    (d): d is PanelDay => isRecord(d) && typeof d.date === "string" && typeof d.generated === "number"
  );
  return { days, current: json.current, previous: isTotals(json.previous) ? json.previous : null };
}
