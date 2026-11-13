"use client";
// Piezas compartidas de los gráficos de Marketing: líneas con cruz y tooltip,
// columnas (simples, apiladas o agrupadas) con tooltip por columna, leyenda.
// Marcas finas, un solo eje, colores por rol; el texto usa tokens de texto.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  bandIndex,
  columnPath,
  labelsFit,
  nearestIndex,
  niceTicks,
  shortName,
  xLabelIndexes,
} from "@/lib/marketing-chart";
import { count } from "./format";
import c from "./charts.module.css";

/** Orden fijo de la paleta categórica (theme.module.css). Nunca se cicla. */
export const SERIES_COLORS = [
  "var(--mk-series-1)",
  "var(--mk-series-2)",
  "var(--mk-series-3)",
  "var(--mk-series-4)",
] as const;

/** El color sigue a la entidad: Meta y TikTok tienen el suyo en todo el módulo. */
export const ENTITY_COLORS = {
  meta: "var(--mk-meta)",
  tiktok: "var(--mk-tiktok)",
  other: "var(--mk-other)",
} as const;

const GAP = 2;
const MAX_BAR = 24;

/** Ancho real del contenedor, para dibujar a tamaño de píxel (texto legible en móvil). */
function useWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Punto activo compartido por puntero y teclado (flechas, Inicio, Fin). */
function useCursor(n: number, onActive?: (index: number | null) => void) {
  const [active, setActiveState] = useState<number | null>(null);
  const setActive = useCallback(
    (index: number | null) => {
      setActiveState(index);
      onActive?.(index);
    },
    [onActive],
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const current = active ?? n - 1;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight"
          ? Math.min(n - 1, current + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? n - 1
              : event.key === "Escape"
                ? null
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };
  return {
    active: active != null && active < n ? active : null,
    setActive,
    frameProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => {
        if (n) setActive(n - 1);
      },
      onBlur: () => setActive(null),
    },
  };
}

const pointerX = (event: PointerEvent<SVGSVGElement>) =>
  event.clientX - event.currentTarget.getBoundingClientRect().left;

export type TooltipRow = {
  key: string;
  color?: string;
  value: string;
  label: string;
};

/** Tooltip: el valor manda, el nombre acompaña; clave de línea, no caja. */
export function ChartTooltip(props: Parameters<typeof Tooltip>[0]) {
  return <Tooltip {...props} />;
}

function Tooltip({
  x,
  y,
  width,
  title,
  rows,
  notes,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: TooltipRow[];
  notes?: string[];
}) {
  const flip = x > width - 200;
  return (
    <div
      className={c.tooltip}
      style={{
        left: flip ? x - 12 : x + 12,
        top: y,
        transform: flip ? "translateX(-100%)" : undefined,
      }}
      aria-hidden="true"
    >
      <p className={c.tooltipTitle}>{title}</p>
      <ul className={c.tooltipRows}>
        {rows.map((row) => (
          <li key={row.key}>
            <span
              className={c.lineKey}
              style={{ background: row.color ?? "transparent" }}
            />
            <strong>{row.value}</strong>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      {notes?.filter(Boolean).map((note) => (
        <p key={note} className={c.tooltipNote}>
          {note}
        </p>
      ))}
    </div>
  );
}

const describe = (title: string, rows: TooltipRow[], notes?: string[]) =>
  [title, ...rows.map((row) => `${row.label}: ${row.value}`), ...(notes ?? [])]
    .filter(Boolean)
    .join(". ");

function YAxis({
  ticks,
  y,
  left,
  right,
  format,
}: {
  ticks: number[];
  y: (value: number) => number;
  left: number;
  right: number;
  format: (value: number) => string;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          {tick > 0 && (
            <line
              className={c.grid}
              x1={left}
              x2={right}
              y1={Math.round(y(tick)) + 0.5}
              y2={Math.round(y(tick)) + 0.5}
            />
          )}
          <text
            className={c.tick}
            x={left - 8}
            y={y(tick) + 4}
            textAnchor="end"
          >
            {format(tick)}
          </text>
        </g>
      ))}
      <line
        className={c.axis}
        x1={left}
        x2={right}
        y1={Math.round(y(0)) + 0.5}
        y2={Math.round(y(0)) + 0.5}
      />
    </g>
  );
}

const tickRoom = (ticks: number[], format: (value: number) => string) =>
  Math.ceil(Math.max(...ticks.map((tick) => format(tick).length)) * 6.6) + 12;

export type LineSeries = {
  key: string;
  name: string;
  color: string;
  values: number[];
};

/**
 * Líneas en el tiempo, un eje. Cruz que busca la fecha más cercana y un
 * tooltip con todas las series visibles. Etiqueta directa al final de cada
 * línea solo si hay sitio y no se pisan; si no, la leyenda y el tooltip.
 */
export function LineChart({
  dates,
  dateLabel,
  series,
  ariaLabel,
  format = count,
  height = 220,
}: {
  dates: string[];
  dateLabel: (date: string) => string;
  series: LineSeries[];
  ariaLabel: string;
  format?: (value: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth();
  const n = dates.length;
  const { active, setActive, frameProps } = useCursor(n);
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max, 4, true);
  const top = ticks[ticks.length - 1];
  const ml = tickRoom(ticks, format);
  const mt = 10;
  const bottom = height - 26;
  const y = (value: number) => bottom - (value / top) * (bottom - mt);
  const lastYs = series.map((s) => y(s.values[n - 1] ?? 0));
  const endLabels =
    n > 1 &&
    series.length > 0 &&
    series.length <= 4 &&
    width >= 480 &&
    labelsFit(lastYs, 14);
  const mr = endLabels ? 132 : 12;
  const plotW = Math.max(10, width - ml - mr);
  const x = (index: number) =>
    n <= 1 ? ml + plotW / 2 : ml + (index / (n - 1)) * plotW;
  const rows = (index: number): TooltipRow[] =>
    [...series]
      .sort((a, b) => (b.values[index] ?? 0) - (a.values[index] ?? 0))
      .map((s) => ({
        key: s.key,
        color: s.color,
        value: format(s.values[index] ?? 0),
        label: s.name,
      }));
  return (
    <div
      ref={ref}
      className={c.frame}
      role="group"
      aria-label={`${ariaLabel}. Usa las flechas para recorrer las fechas.`}
      {...frameProps}
    >
      <svg
        className={c.svg}
        width={width}
        height={height}
        data-plot
        aria-hidden="true"
        onPointerMove={(event) =>
          setActive(nearestIndex(pointerX(event), n, ml, plotW))
        }
        onPointerDown={(event) =>
          setActive(nearestIndex(pointerX(event), n, ml, plotW))
        }
        onPointerLeave={() => setActive(null)}
      >
        <YAxis
          ticks={ticks}
          y={y}
          left={ml}
          right={ml + plotW}
          format={format}
        />
        {xLabelIndexes(n, plotW, 60).map((index) => (
          <text
            key={dates[index]}
            className={c.tick}
            x={x(index)}
            y={height - 6}
            textAnchor={
              n > 1 && index === 0
                ? "start"
                : n > 1 && index === n - 1
                  ? "end"
                  : "middle"
            }
          >
            {dateLabel(dates[index])}
          </text>
        ))}
        {active != null && (
          <line
            className={c.crosshair}
            x1={Math.round(x(active)) + 0.5}
            x2={Math.round(x(active)) + 0.5}
            y1={mt}
            y2={bottom}
          />
        )}
        {series.map((s) => (
          <g key={s.key}>
            {n > 1 && (
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {(n === 1 || active == null) && (
              <circle
                cx={x(n - 1)}
                cy={y(s.values[n - 1] ?? 0)}
                r={4}
                fill={s.color}
                stroke="var(--mk-surface)"
                strokeWidth={4}
                paintOrder="stroke"
              />
            )}
            {active != null && (
              <circle
                cx={x(active)}
                cy={y(s.values[active] ?? 0)}
                r={4}
                fill={s.color}
                stroke="var(--mk-surface)"
                strokeWidth={4}
                paintOrder="stroke"
              />
            )}
          </g>
        ))}
        {endLabels &&
          series.map((s) => (
            <text
              key={s.key}
              x={x(n - 1) + 10}
              y={y(s.values[n - 1] ?? 0) + 4}
            >
              <tspan className={c.label}>
                {format(s.values[n - 1] ?? 0)}
              </tspan>
              <tspan className={c.labelName} dx={5}>
                {shortName(s.name)}
              </tspan>
            </text>
          ))}
      </svg>
      {active != null && series.length > 0 && (
        <Tooltip
          x={x(active)}
          y={mt}
          width={width}
          title={dateLabel(dates[active])}
          rows={rows(active)}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {active != null
          ? describe(dateLabel(dates[active]), rows(active))
          : ""}
      </p>
    </div>
  );
}

export type Segment = {
  key: string;
  label: string;
  value: number | null;
  color: string;
};

/**
 * Una columna por categoría. `stacks` es la lista de barras de la categoría:
 * una barra (serie única), una barra con varios segmentos (apilada) o varias
 * barras (agrupada). Los segmentos se apilan de abajo hacia arriba.
 */
export type ColumnBin = {
  key: string;
  /** Texto del eje X. */
  label: string;
  /** Encabezado del tooltip. */
  title: string;
  stacks: Segment[][];
  notes?: string[];
};

const stackTotal = (stack: Segment[]) =>
  stack.reduce((sum, seg) => sum + (seg.value ?? 0), 0);

/**
 * Columnas finas (≤ 24 px) con punta redondeada sobre una sola línea base,
 * 2 px de superficie entre segmentos y entre barras vecinas, tooltip por
 * columna (la columna entera es el blanco) y la cifra solo en el pico.
 */
export function ColumnChart({
  bins,
  ariaLabel,
  format = count,
  tickFormat,
  height = 190,
  integer = true,
  reference,
  labelPeak = true,
  onActive,
}: {
  bins: ColumnBin[];
  ariaLabel: string;
  format?: (value: number) => string;
  tickFormat?: (value: number) => string;
  height?: number;
  integer?: boolean;
  reference?: { value: number; label: string };
  labelPeak?: boolean;
  onActive?: (index: number | null) => void;
}) {
  const [ref, width] = useWidth();
  const n = bins.length;
  const { active, setActive, frameProps } = useCursor(n, onActive);
  const totals = bins.map((bin) => Math.max(0, ...bin.stacks.map(stackTotal)));
  const max = Math.max(0, reference?.value ?? 0, ...totals);
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1];
  const axisFormat = tickFormat ?? format;
  const ml = tickRoom(ticks, axisFormat);
  const mr = 8;
  const mt = labelPeak ? 20 : 10;
  const bottom = height - 26;
  const plotW = Math.max(10, width - ml - mr);
  const band = n ? plotW / n : plotW;
  const y = (value: number) => bottom - (value / top) * (bottom - mt);
  const groups = Math.max(1, ...bins.map((bin) => bin.stacks.length));
  const barW = Math.max(
    2,
    Math.min(MAX_BAR, (band * 0.72 - GAP * (groups - 1)) / groups),
  );
  const groupW = barW * groups + GAP * (groups - 1);
  const peak = labelPeak && max > 0 ? totals.indexOf(Math.max(...totals)) : -1;
  // The peak label sits over the tallest bar of its group, kept inside the frame.
  const peakX = (index: number) => {
    const stacks = bins[index].stacks.map(stackTotal);
    const s = stacks.indexOf(Math.max(...stacks));
    const center =
      ml + index * band + (band - groupW) / 2 + s * (barW + GAP) + barW / 2;
    const half = (format(totals[index]).length * 6.6) / 2;
    return Math.min(width - half, Math.max(ml + half, center));
  };
  const rows = (bin: ColumnBin): TooltipRow[] => {
    // A stacked bar lists its segments top → bottom, as they are drawn.
    const out: TooltipRow[] = bin.stacks.flatMap((stack) =>
      [...stack].reverse().map((seg) => ({
        key: seg.key,
        color: seg.color,
        value: seg.value == null ? "Sin datos" : format(seg.value),
        label: seg.label,
      })),
    );
    if (bin.stacks.length === 1 && bin.stacks[0].length > 1)
      out.push({
        key: "total",
        value: format(stackTotal(bin.stacks[0])),
        label: "Total",
      });
    return out;
  };
  const current = active != null ? bins[active] : null;
  return (
    <div
      ref={ref}
      className={c.frame}
      role="group"
      aria-label={`${ariaLabel}. Usa las flechas para recorrer las columnas.`}
      {...frameProps}
    >
      <svg
        className={c.svg}
        width={width}
        height={height}
        data-plot
        aria-hidden="true"
        onPointerMove={(event) =>
          setActive(bandIndex(pointerX(event), n, ml, plotW))
        }
        onPointerDown={(event) =>
          setActive(bandIndex(pointerX(event), n, ml, plotW))
        }
        onPointerLeave={() => setActive(null)}
      >
        {active != null && (
          <rect
            className={c.wash}
            x={ml + active * band}
            y={mt}
            width={band}
            height={bottom - mt}
            rx={3}
          />
        )}
        <YAxis
          ticks={ticks}
          y={y}
          left={ml}
          right={ml + plotW}
          format={axisFormat}
        />
        {bins.map((bin, index) => {
          const x0 = ml + index * band + (band - groupW) / 2;
          return (
            <g
              key={bin.key}
              className={index === active ? c.activeMark : undefined}
            >
              {bin.stacks.map((stack, s) => {
                const visible = stack.filter((seg) => (seg.value ?? 0) > 0);
                let base = 0;
                return visible.map((seg, i) => {
                  const from = y(base);
                  base += seg.value ?? 0;
                  const to = y(base);
                  const last = i === visible.length - 1;
                  const h = from - to - (last || from - to <= GAP ? 0 : GAP);
                  const bx = x0 + s * (barW + GAP);
                  return last ? (
                    <path
                      key={seg.key}
                      d={columnPath(bx, to, barW, h)}
                      fill={seg.color}
                    />
                  ) : (
                    <rect
                      key={seg.key}
                      x={bx}
                      y={from - h}
                      width={barW}
                      height={Math.max(0, h)}
                      fill={seg.color}
                    />
                  );
                });
              })}
            </g>
          );
        })}
        {reference && reference.value <= top && (
          <g aria-hidden="true">
            <line
              className={c.reference}
              x1={ml}
              x2={ml + plotW}
              y1={Math.round(y(reference.value)) + 0.5}
              y2={Math.round(y(reference.value)) + 0.5}
            />
            <text
              className={c.tick}
              x={ml + plotW}
              y={y(reference.value) - 5}
              textAnchor="end"
            >
              {reference.label}
            </text>
          </g>
        )}
        {peak >= 0 && (
          <text
            className={c.label}
            x={peakX(peak)}
            y={y(totals[peak]) - 6}
            textAnchor="middle"
          >
            {format(totals[peak])}
          </text>
        )}
        {xLabelIndexes(n, plotW, 52).map((index) => (
          <text
            key={bins[index].key}
            className={c.tick}
            x={ml + index * band + band / 2}
            y={height - 6}
            textAnchor="middle"
          >
            {bins[index].label}
          </text>
        ))}
      </svg>
      {current && active != null && (
        <Tooltip
          x={ml + active * band + band / 2}
          y={mt}
          width={width}
          title={current.title}
          rows={rows(current)}
          notes={current.notes}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {current ? describe(current.title, rows(current), current.notes) : ""}
      </p>
    </div>
  );
}

export type LegendItem = {
  key: string;
  name: ReactNode;
  color?: string;
  /** Mismo dibujo que la marca: rectángulo (barras), línea, o regla (referencia). */
  mark?: "rect" | "line" | "rule";
  hidden?: boolean;
};

/**
 * Leyenda: siempre con dos o más series. Con `onToggle` cada nombre
 * muestra u oculta su serie (los demás conservan su color).
 */
export function ChartLegend({
  items,
  onToggle,
  label = "Leyenda",
}: {
  items: LegendItem[];
  onToggle?: (key: string) => void;
  label?: string;
}) {
  return (
    <ul className={c.legend} aria-label={label}>
      {items.map((item) => {
        const mark = item.mark ?? "rect";
        const swatch = (
          <span
            className={
              mark === "line"
                ? c.swatchLine
                : mark === "rule"
                  ? c.swatchRule
                  : c.swatchRect
            }
            style={mark === "rule" ? undefined : { background: item.color }}
            aria-hidden="true"
          />
        );
        return (
          <li key={item.key}>
            {onToggle ? (
              <button
                type="button"
                className={c.legendItem}
                aria-pressed={!item.hidden}
                onClick={() => onToggle(item.key)}
              >
                {swatch}
                {item.name}
              </button>
            ) : (
              <span className={c.legendItem}>
                {swatch}
                {item.name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type SparkPoint = {
  key: string;
  value: number;
  /** Encabezado del tooltip (la fecha). */
  title: string;
  /** Día en curso: punto hueco y nota en el tooltip. */
  open?: boolean;
  rows?: TooltipRow[];
  notes?: string[];
};

/**
 * Tendencia mínima detrás de una cifra grande: línea de 2 px con lavado
 * suave, la meta como regla fina, el último punto marcado (hueco si el día
 * sigue en curso), cruz y tooltip al pasar o con las flechas. Sin ejes: la
 * cifra del mosaico ya da el valor; la tabla oculta da cada día.
 */
export function Sparkline({
  points,
  ariaLabel,
  format = count,
  reference,
  height = 64,
  color = SERIES_COLORS[0],
}: {
  points: SparkPoint[];
  ariaLabel: string;
  format?: (value: number) => string;
  reference?: { value: number; label: string };
  height?: number;
  color?: string;
}) {
  const [ref, width] = useWidth(320);
  const n = points.length;
  const { active, setActive, frameProps } = useCursor(n);
  const values = points.map((p) => p.value);
  const top = Math.max(1, reference?.value ?? 0, ...values) * 1.08;
  const mt = 6,
    mb = 6,
    ml = 4,
    mr = 4;
  const plotW = Math.max(10, width - ml - mr);
  const bottom = height - mb;
  const x = (index: number) =>
    n <= 1 ? ml + plotW / 2 : ml + (index / (n - 1)) * plotW;
  const y = (value: number) => bottom - (value / top) * (bottom - mt);
  const line = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area =
    n > 1 ? `${x(0)},${bottom} ${line} ${x(n - 1)},${bottom}` : "";
  const last = points[n - 1];
  const rowsOf = (p: SparkPoint): TooltipRow[] =>
    p.rows ?? [{ key: "value", color, value: format(p.value), label: ariaLabel }];
  const current = active != null ? points[active] : null;
  return (
    <div
      ref={ref}
      className={c.frame}
      role="group"
      aria-label={`${ariaLabel}. Usa las flechas para recorrer los días.`}
      {...frameProps}
    >
      <svg
        className={c.svg}
        width={width}
        height={height}
        data-plot
        aria-hidden="true"
        onPointerMove={(event) =>
          setActive(nearestIndex(pointerX(event), n, ml, plotW))
        }
        onPointerDown={(event) =>
          setActive(nearestIndex(pointerX(event), n, ml, plotW))
        }
        onPointerLeave={() => setActive(null)}
      >
        {reference && (
          <g>
            <line
              className={c.reference}
              x1={ml}
              x2={ml + plotW}
              y1={Math.round(y(reference.value)) + 0.5}
              y2={Math.round(y(reference.value)) + 0.5}
            />
            <text
              className={c.tick}
              x={ml + plotW}
              y={y(reference.value) - 4}
              textAnchor="end"
            >
              {reference.label}
            </text>
          </g>
        )}
        {active != null && (
          <line
            className={c.crosshair}
            x1={Math.round(x(active)) + 0.5}
            x2={Math.round(x(active)) + 0.5}
            y1={mt}
            y2={bottom}
          />
        )}
        {n > 1 && <polygon points={area} fill={color} opacity={0.1} />}
        {n > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {last && (active == null || active === n - 1) && (
          <circle
            cx={x(n - 1)}
            cy={y(last.value)}
            r={last.open ? 3.5 : 4}
            fill={last.open ? "var(--mk-surface)" : color}
            stroke={last.open ? color : "var(--mk-surface)"}
            strokeWidth={last.open ? 2 : 4}
            paintOrder="stroke"
          />
        )}
        {current && active != null && active !== n - 1 && (
          <circle
            cx={x(active)}
            cy={y(current.value)}
            r={4}
            fill={color}
            stroke="var(--mk-surface)"
            strokeWidth={4}
            paintOrder="stroke"
          />
        )}
      </svg>
      {current && active != null && (
        <Tooltip
          x={x(active)}
          y={0}
          width={width}
          title={current.title}
          rows={rowsOf(current)}
          notes={[...(current.notes ?? []), current.open ? "Día en curso" : ""]}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {current ? describe(current.title, rowsOf(current), current.notes) : ""}
      </p>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.title}</th>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
