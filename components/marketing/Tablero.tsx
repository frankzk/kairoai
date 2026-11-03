"use client";
// Tablero: la estructura "TOTAL DE VENTAS" del dueño (03/11/2026). Tres
// lecturas: ventas y pauta, campañas por cuenta, ritmo y señales. Los
// calculos estan en lib/marketing-tablero.ts.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingPeriod } from "@/lib/marketing-dates";
import type { OrigenesPedidos, OrigenPedido } from "@/lib/marketing-origen";
import {
  CPA_OBJETIVO,
  STOCK_MINIMO,
  alertasTablero,
  anunciosClicsCompras,
  campanasPorCuenta,
  costoPorProducto,
  pedidosPorDiaSemana,
  resumenPlataforma,
  stockPorProducto,
  tendenciaProductos,
  totalesTablero,
  type ArticuloInventario,
  type Alerta,
  type CeldaProducto,
  type CuentaCampanas,
  type GrupoAlerta,
} from "@/lib/marketing-tablero";
import { count, money, percentage, shortDate } from "./format";
import s from "./dashboard.module.css";

export interface TableroExtra {
  origen: OrigenesPedidos | null;
  inventario: { items: ArticuloInventario[]; checkedAt: string } | null;
}

const usd = (v: number | null | undefined) => money(v ?? null, "USD");
const ESTADOS: Record<string, string> = {
  ACTIVE: "Activa",
  ENABLE: "Activa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Pausada",
  ADSET_PAUSED: "Pausada",
  ARCHIVED: "Archivada",
  DELETED: "Eliminada",
  IN_PROCESS: "En revisión",
  WITH_ISSUES: "Con problemas",
};
const estadoCampana = (e: string) => ESTADOS[e.toUpperCase()] ?? e.toLowerCase().replace(/_/g, " ");
const cpaTono = (v: number | null) => (v == null ? "" : v > CPA_OBJETIVO ? s.warn : s.good);

// ─── Orden de tablas ─────────────────────────────────────────────────────────

type Direccion = "asc" | "desc";
function useOrden<K extends string>(inicial: K, dir: Direccion = "desc") {
  const [orden, setOrden] = useState<{ key: K; dir: Direccion }>({ key: inicial, dir });
  const cambiar = (key: K) =>
    setOrden((o) => (o.key === key ? { key, dir: o.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  const ordenar = <T,>(filas: T[], valor: (fila: T, key: K) => number | string | null) =>
    [...filas].sort((a, b) => {
      const x = valor(a, orden.key),
        y = valor(b, orden.key);
      // Sin dato siempre al final, en cualquier direccion.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const r = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
      return orden.dir === "asc" ? r : -r;
    });
  return { orden, cambiar, ordenar };
}

function Encabezado<K extends string>({
  k,
  orden,
  cambiar,
  children,
  numerico = true,
}: {
  k: K;
  orden: { key: K; dir: Direccion };
  cambiar: (k: K) => void;
  children: ReactNode;
  numerico?: boolean;
}) {
  const activo = orden.key === k;
  return (
    <th
      className={numerico ? s.numeric : undefined}
      aria-sort={activo ? (orden.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className={`${s.sortButton} ${activo ? s.sortActive : ""}`} onClick={() => cambiar(k)}>
        {children}
        <span aria-hidden className={s.sortMark}>
          {activo ? (orden.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

// ─── Bloque 1: ventas y pauta ────────────────────────────────────────────────

const ORIGENES: Array<[OrigenPedido, string, string]> = [
  ["web", "Web / landing", "Formulario de la página de iComfly: donde llega el tráfico de anuncios."],
  ["manual", "Manual (asesora)", "Creados por una asesora: WhatsApp, llamadas, upsells y Kairo."],
  ["icomfly", "iComfly (chat y panel)", "Con número propio de iComfly: bot, chat o panel."],
  ["shopify", "Shopify", "Entraron por la tienda de Shopify."],
  ["otro", "Otro", "Número sin patrón conocido."],
];

function Origen({ origen, loading }: { origen: OrigenesPedidos | null; loading: boolean }) {
  if (loading) return <div className={`${s.skeleton} !h-40`} role="status" aria-label="Consultando el origen de los pedidos" />;
  if (!origen) return <div className={s.empty}>No se pudo leer el origen de los pedidos en iComfly. Vuelve a actualizar.</div>;
  const filas = ORIGENES.filter(([k]) => origen.porOrigen[k] > 0 || k !== "otro");
  return (
    <>
      <ul className={s.list}>
        {filas.map(([k, nombre, ayuda]) => {
          const n = origen.porOrigen[k];
          const parte = origen.total ? n / origen.total : 0;
          return (
            <li key={k} className={s.listItem}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{nombre}</span>
                <span className="tabular-nums">
                  {count(n)} <span className={s.muted}>· {percentage(origen.total ? parte : null)}</span>
                </span>
              </div>
              <div className={`${s.bar} mt-2`} aria-hidden>
                <div className={s.barFill} style={{ width: `${parte * 100}%` }} />
              </div>
              <p className={`${s.muted} mt-1 !text-[11px]`}>
                {ayuda}
                {k === "manual" && origen.upsells > 0 && ` De ellos, ${count(origen.upsells)} son upsells que reemplazaron un pedido.`}
              </p>
            </li>
          );
        })}
      </ul>
      <p className={`${s.muted} mt-2 !text-[11px]`}>
        {count(origen.total)} pedidos en iComfly en el período, incluidos los anulados. Los pedidos no traen la campaña: el origen dice
        por dónde entró, no qué anuncio lo trajo.
      </p>
    </>
  );
}

function Celda({ c, gastoListo }: { c: CeldaProducto; gastoListo: boolean }) {
  return (
    <>
      <td className={s.numeric}>{count(c.pedidos)}</td>
      <td className={`${s.numeric} ${cpaTono(c.cpa)}`}>
        {!gastoListo ? "Sin datos" : c.cpa != null ? usd(c.cpa) : (c.gastoUsd ?? 0) > 0 ? <span className={s.warn}>Sin pedidos</span> : "—"}
      </td>
    </>
  );
}

// ─── Bloque 2: campañas ──────────────────────────────────────────────────────

type ClaveCampana = "nombre" | "cpa" | "presupuesto" | "gasto" | "compras";
function TablaCuenta({ cuenta }: { cuenta: CuentaCampanas }) {
  const { orden, cambiar, ordenar } = useOrden<ClaveCampana>("gasto");
  const [todas, setTodas] = useState(false);
  const filas = ordenar(cuenta.campanas, (c, k) =>
    k === "nombre" ? c.nombre : k === "cpa" ? c.cpa : k === "presupuesto" ? c.presupuestoUsd : k === "compras" ? c.compras : c.gastoUsd
  );
  const visibles = todas ? filas : filas.slice(0, 8);
  const plataforma = cuenta.plataforma === "meta" ? "Meta" : "TikTok";
  return (
    <section className={s.section} aria-labelledby={`cuenta-${cuenta.plataforma}-${cuenta.cuentaId}`}>
      <div className={s.sectionHead}>
        <h3 id={`cuenta-${cuenta.plataforma}-${cuenta.cuentaId}`} className={s.subheading}>
          <span className={s.badge}>{plataforma}</span> {cuenta.nombre}
        </h3>
        <span className={`${s.muted} tabular-nums`}>
          {usd(cuenta.gastoUsd)} · {cuenta.compras == null ? "compras sin dato" : `${count(cuenta.compras)} compras`} · CPA{" "}
          <span className={cpaTono(cuenta.cpa)}>{usd(cuenta.cpa)}</span>
          {cuenta.moneda !== "USD" && ` · cobra en ${cuenta.moneda}`}
        </span>
      </div>
      {!cuenta.campanas.length ? (
        <div className={s.empty}>Sin campañas con gasto ni activas en el período.</div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="sr-only">Campañas de {cuenta.nombre}, ordenables por columna</caption>
            <thead>
              <tr>
                <Encabezado k="nombre" orden={orden} cambiar={cambiar} numerico={false}>
                  Campaña
                </Encabezado>
                <Encabezado k="cpa" orden={orden} cambiar={cambiar}>
                  CPA
                </Encabezado>
                <Encabezado k="compras" orden={orden} cambiar={cambiar}>
                  Compras
                </Encabezado>
                <Encabezado k="presupuesto" orden={orden} cambiar={cambiar}>
                  Presupuesto diario
                </Encabezado>
                <Encabezado k="gasto" orden={orden} cambiar={cambiar}>
                  Gastado
                </Encabezado>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.key}>
                  <td className="min-w-[200px] max-w-[420px]">
                    <span className="block break-words font-medium">{c.nombre}</span>
                    <span className={s.muted}>
                      {c.productoNombre ?? "Sin producto asignado"}
                      {c.estado && ` · ${estadoCampana(c.estado)}`}
                    </span>
                  </td>
                  <td className={`${s.numeric} ${cpaTono(c.cpa)}`}>
                    {c.cpa != null ? usd(c.cpa) : (c.gastoUsd ?? 0) > 0 && c.compras === 0 ? <span className={s.warn}>Sin compras</span> : "—"}
                  </td>
                  <td className={s.numeric}>{c.compras == null ? "Sin datos" : count(c.compras)}</td>
                  <td className={s.numeric}>
                    {c.presupuestoUsd != null ? usd(c.presupuestoUsd) : cuenta.plataforma === "tiktok" ? "Sin dato" : "Por conjunto"}
                  </td>
                  <td className={s.numeric}>{usd(c.gastoUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filas.length > 8 && (
        <button type="button" className={`${s.link} mt-3`} onClick={() => setTodas((v) => !v)}>
          {todas ? "Ver menos" : `Ver las ${filas.length} campañas`}
        </button>
      )}
    </section>
  );
}

// ─── Bloque 3: ritmo ─────────────────────────────────────────────────────────

const COLORES = ["oklch(78% .11 165)", "oklch(79% .08 230)", "oklch(84% .12 85)", "oklch(76% .1 320)", "oklch(77% .11 30)"];

function DiasSemana({ data }: { data: MarketingSummary }) {
  const dias = pedidosPorDiaSemana(data.daily);
  const [activo, setActivo] = useState<string | null>(null);
  const max = Math.max(1, ...dias.map((d) => d.promedio ?? 0));
  const mejor = dias.reduce((a, b) => ((b.promedio ?? 0) > (a.promedio ?? 0) ? b : a), dias[0]);
  const elegido = dias.find((d) => d.dia === activo);
  return (
    <div>
      <div className={s.sectionHead}>
        <h3 className={s.subheading}>Pedidos por día de la semana</h3>
        <span className={s.muted} aria-live="polite">
          {elegido
            ? `${elegido.dia}: ${count(elegido.pedidos)} pedidos en ${elegido.veces} ${elegido.veces === 1 ? "día" : "días"}`
            : mejor?.promedio
              ? `Mejor día: ${mejor.dia}`
              : "Sin pedidos"}
        </span>
      </div>
      <div className={s.chart} style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10 }}>
        {dias.map((d) => (
          <button
            key={d.dia}
            type="button"
            className={s.chartButton}
            aria-label={`${d.dia}: ${d.promedio == null ? "sin días en el período" : `${d.promedio.toFixed(1)} pedidos por día en promedio, ${d.pedidos} en total`}`}
            onMouseEnter={() => setActivo(d.dia)}
            onMouseLeave={() => setActivo(null)}
            onFocus={() => setActivo(d.dia)}
            onBlur={() => setActivo(null)}
          >
            <span className={s.chartValue}>{d.promedio == null ? "" : Math.round(d.promedio)}</span>
            <span
              className={s.chartColumn}
              style={{
                height: `${((d.promedio ?? 0) / max) * 100}%`,
                background: d.dia === mejor?.dia && mejor.promedio ? "oklch(84% .1 165)" : undefined,
              }}
            />
          </button>
        ))}
      </div>
      <div className={s.weekAxis} aria-hidden>
        {dias.map((d) => (
          <span key={d.dia}>{d.dia.slice(0, 3)}</span>
        ))}
      </div>
      <p className={`${s.muted} mt-2 !text-[11px]`}>Promedio de pedidos creados por cada día de la semana del período.</p>
    </div>
  );
}

function Tendencia({ data }: { data: MarketingSummary }) {
  const t = useMemo(() => tendenciaProductos(data), [data]);
  const [ocultos, setOcultos] = useState<string[]>([]);
  const visibles = t.series.filter((x) => !ocultos.includes(x.key));
  const max = Math.max(1, ...visibles.flatMap((x) => x.puntos));
  const n = t.cortes.length;
  const x = (i: number) => 32 + (n > 1 ? (i / (n - 1)) * 600 : 300);
  const y = (v: number) => 166 - (v / max) * 138;
  const etiqueta = (i: number) => (t.semanal ? `Sem ${i + 1}` : shortDate(t.cortes[i].desde));
  return (
    <div>
      <div className={s.sectionHead}>
        <h3 className={s.subheading}>Tendencia de pedidos por producto</h3>
        <span className={s.muted}>
          {t.semanal ? `Semanas de 7 días hasta el ${shortDate(t.cortes[t.cortes.length - 1]?.hasta ?? data.period.to)}` : "Por día"} · 5 con más pedidos
        </span>
      </div>
      {!t.series.length ? (
        <div className={s.empty}>El período no tiene pedidos con producto identificado.</div>
      ) : (
        <>
          <div className={s.legend}>
            {t.series.map((serie, i) => (
              <button
                key={serie.key}
                type="button"
                className="max-w-[220px] truncate text-left focus-visible:outline focus-visible:outline-2"
                aria-pressed={!ocultos.includes(serie.key)}
                title={serie.nombre}
                onClick={() =>
                  setOcultos((o) => (o.includes(serie.key) ? o.filter((k) => k !== serie.key) : [...o, serie.key]))
                }
                style={{ opacity: ocultos.includes(serie.key) ? 0.4 : 1 }}
              >
                <span className={s.dot} style={{ background: COLORES[i] }} />
                {serie.nombre}
              </button>
            ))}
          </div>
          <svg viewBox="0 0 660 200" role="img" aria-label="Pedidos por producto en el tiempo; los valores están en la tabla de abajo" className="w-full">
            {[0, 0.5, 1].map((tick) => (
              <g key={tick}>
                <line x1="32" x2="632" y1={y(max * tick)} y2={y(max * tick)} stroke="hsl(var(--border))" />
                <text x="20" y={y(max * tick) + 3} fill="currentColor" textAnchor="end" fontSize="10">
                  {Math.round(max * tick)}
                </text>
              </g>
            ))}
            {visibles.map((serie) => {
              const color = COLORES[t.series.findIndex((z) => z.key === serie.key)];
              return (
                <g key={serie.key}>
                  <polyline
                    points={serie.puntos.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {serie.puntos.map((v, i) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={color} />
                  ))}
                </g>
              );
            })}
            {t.cortes.map((_, i) =>
              n <= 8 || i === 0 || i === n - 1 ? (
                <text key={i} x={x(i)} y="192" fill="currentColor" fontSize="10" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                  {etiqueta(i)}
                </text>
              ) : null
            )}
          </svg>
          <details>
            <summary className={s.link}>Ver valores</summary>
            <div className={`${s.tableWrap} mt-2 max-h-60`}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>{t.semanal ? "Semana" : "Día"}</th>
                    {t.series.map((serie) => (
                      <th key={serie.key} className={`${s.numeric} max-w-[140px] truncate`} title={serie.nombre}>
                        {serie.nombre}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.cortes.map((c, i) => (
                    <tr key={c.desde}>
                      <td>{t.semanal ? `${etiqueta(i)} · ${shortDate(c.desde)} al ${shortDate(c.hasta)}` : shortDate(c.desde)}</td>
                      {t.series.map((serie) => (
                        <td key={serie.key} className={s.numeric}>
                          {count(serie.puntos[i])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

const GRUPOS: Array<[GrupoAlerta, string, string, string]> = [
  ["escalar", "Oportunidad de escalar", s.good, `CPA hasta USD ${CPA_OBJETIVO.toFixed(2)}, compras suficientes y stock no bajo.`],
  ["cpa", "CPA elevado", s.warn, `Gasto significativo y CPA sobre USD ${CPA_OBJETIVO.toFixed(2)}.`],
  ["stock", "Riesgo de quedarse sin stock", s.bad, `Menos de ${STOCK_MINIMO} unidades o menos de 7 días al ritmo de venta.`],
  ["clics", "Muchos clics, pocas compras", s.warn, "Más de 100 clics y menos de 1 compra por cada 100."],
];

function Alertas({ alertas }: { alertas: Alerta[] }) {
  const [abiertos, setAbiertos] = useState<GrupoAlerta[]>([]);
  return (
    <div className={s.alertGrid}>
      {GRUPOS.map(([grupo, titulo, tono, regla]) => {
        const lista = alertas.filter((a) => a.grupo === grupo);
        const abierto = abiertos.includes(grupo);
        return (
          <section key={grupo} className={s.alertColumn} aria-labelledby={`alerta-${grupo}`}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`alerta-${grupo}`} className={`${s.subheading} ${tono}`}>
                {titulo}
              </h3>
              <span className={`${s.value} !my-0 !text-lg`}>{count(lista.length)}</span>
            </div>
            <p className={`${s.muted} !text-[11px]`}>{regla}</p>
            {!lista.length ? (
              <p className={`${s.muted} mt-3 !text-[11px]`}>Nada que reportar con los datos del período.</p>
            ) : (
              <ul className="mt-3">
                {(abierto ? lista : lista.slice(0, 4)).map((a) => (
                  <li key={a.key} className={s.alertItem}>
                    <p className={`${s.listTitle} break-words`}>{a.titulo}</p>
                    <p className={`${s.muted} !text-[11px]`}>{a.detalle}</p>
                  </li>
                ))}
              </ul>
            )}
            {lista.length > 4 && (
              <button
                type="button"
                className={`${s.link} mt-2`}
                onClick={() => setAbiertos((o) => (abierto ? o.filter((g) => g !== grupo) : [...o, grupo]))}
              >
                {abierto ? "Ver menos" : `Ver las ${lista.length}`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ─── Tablero ─────────────────────────────────────────────────────────────────

type ClaveProducto = "nombre" | "hoy" | "ayer" | "siete" | "cpaHoy" | "cpaAyer" | "cpaSiete";
type ClaveTop = "pedidos" | "unidades" | "entrega";
type ClaveAnuncio = "clics" | "compras" | "conversion" | "gasto";

export function Tablero({
  data,
  model,
  period,
  today,
  sources,
  sourcesLoading,
  recent,
  recentLoading,
  settings,
  report,
  reportLoading,
  fx,
  extra,
  extraLoading,
}: {
  data: MarketingSummary;
  model: MarketingIntelligence;
  period: MarketingPeriod;
  today: string;
  sources: MarketingSources | null;
  sourcesLoading: boolean;
  recent: MarketingSources | null;
  recentLoading: boolean;
  settings: MarketingSettings | null;
  report: CharlieReport | null;
  reportLoading: boolean;
  fx: UsdRate | null;
  extra: TableroExtra | null;
  extraLoading: boolean;
}) {
  const plataformas = useMemo(
    () => (["meta", "tiktok"] as const).map((p) => resumenPlataforma(sources, p, fx)),
    [sources, fx]
  );
  const totales = totalesTablero(data.totals.generated, plataformas);
  const costo = useMemo(() => costoPorProducto(data, recent, settings, fx, today), [data, recent, settings, fx, today]);
  const stock = useMemo(() => stockPorProducto(model.products, extra?.inventario?.items ?? null), [model.products, extra]);
  const cuentas = useMemo(() => campanasPorCuenta(sources, settings, fx), [sources, settings, fx]);
  const anuncios = useMemo(
    () => anunciosClicsCompras(report, settings, fx, period.from, period.to),
    [report, settings, fx, period.from, period.to]
  );
  const conStock = model.products.filter((p) => stock.get(p.key)?.disponible != null);
  const hayInventario = model.products.some((p) => p.sevenDayOrders > 0 && stock.get(p.key)?.disponible != null);
  const alertas = alertasTablero({ cuentas, productos: costo.filas, stock, anuncios, diasPeriodo: period.days, hayInventario });

  const [producto, setProducto] = useState("");
  const tProd = useOrden<ClaveProducto>("siete");
  const filasProducto = tProd.ordenar(
    costo.filas.filter((f) => !producto || f.key === producto),
    (f, k) =>
      k === "nombre"
        ? f.nombre
        : k === "hoy"
          ? f.hoy.pedidos
          : k === "ayer"
            ? f.ayer.pedidos
            : k === "siete"
              ? f.siete.pedidos
              : k === "cpaHoy"
                ? f.hoy.cpa
                : k === "cpaAyer"
                  ? f.ayer.cpa
                  : f.siete.cpa
  );
  const [todosProductos, setTodosProductos] = useState(false);
  const gastoListo = !recentLoading && costo.filas.some((f) => f.siete.gastoUsd != null);

  const tTop = useOrden<ClaveTop>("pedidos");
  const top = tTop.ordenar(
    model.products.filter((p) => p.orders > 0),
    (p, k) => (k === "pedidos" ? p.orders : k === "unidades" ? p.units : p.orders ? p.delivered / p.orders : null)
  );
  const [stockElegido, setStockElegido] = useState("");
  const elegido = model.products.find((p) => p.key === (stockElegido || conStock[0]?.key));
  const stockElegidoDato = elegido ? stock.get(elegido.key) : undefined;
  const faltantes = model.products
    .map((p) => ({ p, s: stock.get(p.key) }))
    .filter((x) => x.s?.disponible != null && x.s.disponible < STOCK_MINIMO && (x.p.sevenDayOrders > 0 || x.p.orders > 0))
    .sort((a, b) => (a.s?.disponible ?? 0) - (b.s?.disponible ?? 0));

  const tAd = useOrden<ClaveAnuncio>("clics");
  const [soloRevisar, setSoloRevisar] = useState(true);
  const filasAnuncios = tAd.ordenar(
    anuncios.filter((a) => !soloRevisar || a.estado !== "bien"),
    (a, k) => (k === "clics" ? a.clics : k === "compras" ? a.compras : k === "conversion" ? a.conversion : a.gastoUsd)
  );
  const [todosAnuncios, setTodosAnuncios] = useState(false);

  const plataformaFila = (nombre: string, ventas: ReactNode, gasto: ReactNode, cpa: number | null, nota: string, fuerte = false) => (
    <tr key={nombre} className={fuerte ? s.totalRow : undefined}>
      <td>
        <span className="block font-medium">{nombre}</span>
        <span className={s.muted}>{nota}</span>
      </td>
      <td className={s.numeric}>{ventas}</td>
      <td className={s.numeric}>{gasto}</td>
      <td className={`${s.numeric} ${cpaTono(cpa)}`}>{usd(cpa)}</td>
    </tr>
  );
  const consultando = (v: ReactNode) => (sourcesLoading ? "Consultando…" : v);

  return (
    <div className={s.board}>
      {/* ── Ventas y pauta ── */}
      <h2 className={s.boardTitle}>Ventas y pauta</h2>
      <dl className={`${s.metrics} ${s.metricsThree}`}>
        <div className={s.metric}>
          <dt>Total de ventas</dt>
          <dd className={s.value}>{count(totales.pedidos)}</dd>
          <dd>
            <small>Pedidos creados en Kairo · {count(data.totals.annulled)} anulados</small>
          </dd>
        </div>
        <div className={s.metric}>
          <dt>CPA total</dt>
          <dd className={`${s.value} ${cpaTono(totales.cpa)}`}>{consultando(usd(totales.cpa))}</dd>
          <dd>
            <small>
              Gasto de Meta + TikTok / todos los pedidos · objetivo USD {CPA_OBJETIVO.toFixed(2)}
              {totales.parcial && " · parcial"}
            </small>
          </dd>
        </div>
        <div className={s.metric}>
          <dt>Gasto en pauta</dt>
          <dd className={s.value}>{consultando(usd(totales.gastoUsd))}</dd>
          <dd>
            <small>
              {plataformas
                .map((p) => `${p.nombre} ${p.estado !== "ready" ? "sin conexión" : p.sinConvertir ? "sin convertir" : usd(p.gastoUsd)}`)
                .join(" · ")}
            </small>
          </dd>
        </div>
      </dl>

      <div className={s.split}>
        <section className={s.section} aria-labelledby="tablero-plataformas">
          <div className={s.sectionHead}>
            <h3 id="tablero-plataformas" className={s.subheading}>
              Ventas y gasto por plataforma
            </h3>
            <span className={s.muted}>Ventas de cada plataforma = compras que reporta su pixel</span>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Origen</th>
                  <th className={s.numeric}>Ventas</th>
                  <th className={s.numeric}>Gasto</th>
                  <th className={s.numeric}>CPA</th>
                </tr>
              </thead>
              <tbody>
                {plataformas.map((p) =>
                  plataformaFila(
                    `${p.nombre} Ads`,
                    consultando(p.compras == null ? "Sin datos" : count(p.compras)),
                    consultando(p.estado !== "ready" ? "Sin conexión" : p.sinConvertir ? "Conversión pendiente" : usd(p.gastoUsd)),
                    p.cpa,
                    p.estado === "ready" ? `${p.cuentas} ${p.cuentas === 1 ? "cuenta" : "cuentas"} · compras reportadas` : "Conexión pendiente"
                  )
                )}
                {plataformaFila(
                  "Orgánicas, upsell y otras",
                  consultando(totales.sinPlataforma == null ? "Sin datos" : count(totales.sinPlataforma)),
                  "—",
                  null,
                  "Pedidos reales que ninguna plataforma reclama"
                )}
                {plataformaFila("Total Kairo", count(totales.pedidos), consultando(usd(totales.gastoUsd)), totales.cpa, "Pedidos creados", true)}
              </tbody>
            </table>
          </div>
          {totales.sobreatribucion > 0 && (
            <p className={`${s.notice} mt-3`}>
              Meta y TikTok reportan {count(totales.sobreatribucion)} compras más que los pedidos reales: se atribuyen la misma venta. Para
              decidir, usa el CPA total (gasto / pedidos reales).
            </p>
          )}
        </section>
        <section className={s.section} aria-labelledby="tablero-origen">
          <div className={s.sectionHead}>
            <h3 id="tablero-origen" className={s.subheading}>
              De dónde vienen los pedidos
            </h3>
          </div>
          <Origen origen={extra?.origen ?? null} loading={extraLoading} />
        </section>
      </div>

      <section className={s.section} aria-labelledby="tablero-productos">
        <div className={s.sectionHead}>
          <h3 id="tablero-productos" className={s.subheading}>
            CPA y pedidos por producto
          </h3>
          <label className={`${s.field} w-full sm:w-auto`}>
            <span className="sr-only">Producto</span>
            <select className={`${s.control} w-full sm:w-[320px]`} value={producto} onChange={(e) => setProducto(e.target.value)}>
              <option value="">Todos los productos</option>
              {costo.filas.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!costo.filas.length ? (
          <div className={s.empty}>Sin pedidos ni gasto en los últimos 7 días.</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <caption className="sr-only">Pedidos y costo por pedido de cada producto: hoy, ayer y los 7 días anteriores a hoy</caption>
              <thead>
                <tr>
                  <th rowSpan={2} className="align-bottom">
                    <button type="button" className={`${s.sortButton} ${tProd.orden.key === "nombre" ? s.sortActive : ""}`} onClick={() => tProd.cambiar("nombre")}>
                      Producto
                    </button>
                  </th>
                  <th colSpan={2} className={`${s.numeric} ${s.groupHead}`}>
                    Hoy
                  </th>
                  <th colSpan={2} className={`${s.numeric} ${s.groupHead}`}>
                    Ayer
                  </th>
                  <th colSpan={2} className={`${s.numeric} ${s.groupHead}`}>
                    7 días
                  </th>
                </tr>
                <tr>
                  <Encabezado k="hoy" orden={tProd.orden} cambiar={tProd.cambiar}>
                    Pedidos
                  </Encabezado>
                  <Encabezado k="cpaHoy" orden={tProd.orden} cambiar={tProd.cambiar}>
                    CPA
                  </Encabezado>
                  <Encabezado k="ayer" orden={tProd.orden} cambiar={tProd.cambiar}>
                    Pedidos
                  </Encabezado>
                  <Encabezado k="cpaAyer" orden={tProd.orden} cambiar={tProd.cambiar}>
                    CPA
                  </Encabezado>
                  <Encabezado k="siete" orden={tProd.orden} cambiar={tProd.cambiar}>
                    Pedidos
                  </Encabezado>
                  <Encabezado k="cpaSiete" orden={tProd.orden} cambiar={tProd.cambiar}>
                    CPA
                  </Encabezado>
                </tr>
              </thead>
              <tbody>
                {(todosProductos || producto ? filasProducto : filasProducto.slice(0, 12)).map((f) => (
                  <tr key={f.key}>
                    <td className="min-w-[200px] max-w-[360px]">
                      <span className="block break-words font-medium">{f.nombre}</span>
                      <span className={s.muted}>{f.campanas ? `${f.campanas} ${f.campanas === 1 ? "campaña" : "campañas"}` : "Sin campañas asignadas"}</span>
                    </td>
                    <Celda c={f.hoy} gastoListo={gastoListo} />
                    <Celda c={f.ayer} gastoListo={gastoListo} />
                    <Celda c={f.siete} gastoListo={gastoListo} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={`${s.toolbar} mt-3 justify-between`}>
          <span className={`${s.muted} !text-[11px]`}>
            {recentLoading
              ? "Consultando el gasto de los últimos 7 días…"
              : costo.sinConvertir
                ? "Hay gasto sin convertir a USD: los CPA quedan sin datos."
                : `CPA = gasto de las campañas asignadas al producto / sus pedidos. 7 días = los 7 días completos antes de hoy.${costo.sinAsignar.siete > 0 ? ` ${usd(costo.sinAsignar.siete)} de los últimos 7 días están en campañas sin producto asignado (Productos y campañas).` : ""}`}
          </span>
          {!producto && filasProducto.length > 12 && (
            <button type="button" className={s.link} onClick={() => setTodosProductos((v) => !v)}>
              {todosProductos ? "Ver menos" : `Ver los ${filasProducto.length} productos`}
            </button>
          )}
        </div>
      </section>

      <div className={s.split}>
        <section className={s.section} aria-labelledby="tablero-top">
          <div className={s.sectionHead}>
            <h3 id="tablero-top" className={s.subheading}>
              Top en ventas
            </h3>
            <span className={s.muted}>Período elegido</span>
          </div>
          {!top.length ? (
            <div className={s.empty}>Sin pedidos con producto identificado.</div>
          ) : (
            <div className={`${s.tableWrap} max-h-[420px]`}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.numeric}>N°</th>
                    <th>Producto</th>
                    <Encabezado k="pedidos" orden={tTop.orden} cambiar={tTop.cambiar}>
                      Pedidos
                    </Encabezado>
                    <Encabezado k="unidades" orden={tTop.orden} cambiar={tTop.cambiar}>
                      Unidades
                    </Encabezado>
                    <Encabezado k="entrega" orden={tTop.orden} cambiar={tTop.cambiar}>
                      Entregados
                    </Encabezado>
                  </tr>
                </thead>
                <tbody>
                  {top.map((p, i) => (
                    <tr key={p.key}>
                      <td className={`${s.numeric} ${s.muted}`}>{i + 1}</td>
                      <td className="min-w-[180px] max-w-[300px] break-words">{p.name}</td>
                      <td className={s.numeric}>{count(p.orders)}</td>
                      <td className={s.numeric}>{count(p.units)}</td>
                      <td className={s.numeric}>{percentage(p.orders ? p.delivered / p.orders : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className={s.section} aria-labelledby="tablero-stock">
          <div className={s.sectionHead}>
            <h3 id="tablero-stock" className={s.subheading}>
              Inventario
            </h3>
            <span className={s.muted}>
              {extraLoading ? "Consultando…" : extra?.inventario ? "ShipHero si está conectado; si no, iComfly" : "iComfly no respondió"}
            </span>
          </div>
          {extraLoading ? (
            <div className={`${s.skeleton} !h-28`} role="status" aria-label="Consultando inventario" />
          ) : !conStock.length ? (
            <div className={s.empty}>
              Ningún producto vendido tiene stock registrado: ShipHero no está conectado y en iComfly los productos que se venden no llevan
              inventario. Cárgalo en iComfly (Productos → stock) o conecta ShipHero para ver unidades y alertas.
            </div>
          ) : (
            <>
              <label className={s.field}>
                Producto
                <select className={s.control} value={elegido?.key ?? ""} onChange={(e) => setStockElegido(e.target.value)}>
                  {conStock.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {elegido && stockElegidoDato && (
                <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span
                    className={`${s.value} !my-0 !text-4xl ${(stockElegidoDato.disponible ?? 0) < STOCK_MINIMO ? s.bad : ""}`}
                  >
                    {count(stockElegidoDato.disponible ?? 0)}
                  </span>
                  <span className={s.muted}>
                    unidades · {stockElegidoDato.fuente === "shiphero" ? "ShipHero" : "iComfly"}
                    {stockElegidoDato.dias != null && ` · ${Math.floor(stockElegidoDato.dias)} días al ritmo de los últimos 7`}
                  </span>
                </div>
              )}
              <h4 className={`${s.subheading} mt-6`}>Falta de stock (menos de {STOCK_MINIMO} unidades)</h4>
              {!faltantes.length ? (
                <p className={`${s.muted} mt-2`}>Ningún producto con ventas está por debajo de {STOCK_MINIMO} unidades.</p>
              ) : (
                <div className={`${s.tableWrap} mt-2 max-h-56`}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className={s.numeric}>Unid.</th>
                        <th className={s.numeric}>Días</th>
                      </tr>
                    </thead>
                    <tbody>
                      {faltantes.map(({ p, s: st }) => (
                        <tr key={p.key}>
                          <td className="max-w-[260px] break-words">{p.name}</td>
                          <td className={`${s.numeric} ${s.bad}`}>{count(st?.disponible ?? 0)}</td>
                          <td className={s.numeric}>{st?.dias == null ? "—" : Math.floor(st.dias)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── Campañas ── */}
      <h2 className={s.boardTitle}>Campañas por cuenta</h2>
      <p className={`${s.muted} mb-5`}>
        Período elegido · CPA = gasto / compras que reporta la plataforma · USD. El presupuesto de Meta es el diario de la campaña
        (&quot;Por conjunto&quot; si se define en los conjuntos); TikTok no lo manda por Make.
      </p>
      {sourcesLoading ? (
        <div className={s.skeleton} role="status" aria-label="Consultando campañas" />
      ) : !cuentas.length ? (
        <div className={`${s.empty} mb-7`}>No hay cuentas de Meta ni TikTok consultables. Revisa Conexiones.</div>
      ) : (
        cuentas.map((c) => <TablaCuenta key={`${c.plataforma}:${c.cuentaId}`} cuenta={c} />)
      )}

      {/* ── Ritmo y señales ── */}
      <h2 className={s.boardTitle}>Ritmo y señales</h2>
      <div className={s.split}>
        <section className={s.section}>
          <Tendencia data={data} />
        </section>
        <section className={s.section}>
          <DiasSemana data={data} />
        </section>
      </div>

      <section className={s.section} aria-labelledby="tablero-anuncios">
        <div className={s.sectionHead}>
          <h3 id="tablero-anuncios" className={s.subheading}>
            Anuncios con muchos clics y pocas compras
          </h3>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={soloRevisar} onChange={(e) => setSoloRevisar(e.target.checked)} />
            Solo los que convierten menos de 1%
          </label>
        </div>
        {reportLoading ? (
          <div className={`${s.skeleton} !h-40`} role="status" aria-label="Consultando anuncios" />
        ) : report?.status !== "ready" ? (
          <div className={s.empty}>{report?.message || "No se pudieron consultar los anuncios."}</div>
        ) : !filasAnuncios.length ? (
          <div className={s.empty}>Ningún anuncio con 50 clics o más {soloRevisar ? "convierte por debajo de 1%" : "en el período"}.</div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Anuncio</th>
                  <Encabezado k="clics" orden={tAd.orden} cambiar={tAd.cambiar}>
                    Clics
                  </Encabezado>
                  <Encabezado k="compras" orden={tAd.orden} cambiar={tAd.cambiar}>
                    Compras
                  </Encabezado>
                  <Encabezado k="conversion" orden={tAd.orden} cambiar={tAd.cambiar}>
                    Conv. %
                  </Encabezado>
                  <Encabezado k="gasto" orden={tAd.orden} cambiar={tAd.cambiar}>
                    Gasto
                  </Encabezado>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {(todosAnuncios ? filasAnuncios : filasAnuncios.slice(0, 12)).map((a) => (
                  <tr key={a.key}>
                    <td className="min-w-[200px] max-w-[380px]">
                      <span className="block break-words font-medium">{a.nombre}</span>
                      <span className={s.muted}>
                        {a.productoNombre ?? "Sin producto asignado"} · {a.plataforma === "meta" ? "Meta" : "TikTok"} {a.cuenta}
                      </span>
                    </td>
                    <td className={s.numeric}>{count(a.clics)}</td>
                    <td className={s.numeric}>{count(a.compras)}</td>
                    <td className={s.numeric}>{percentage(a.conversion)}</td>
                    <td className={s.numeric}>{usd(a.gastoUsd)}</td>
                    <td>
                      <span className={`${s.badge} ${a.estado === "revisar" ? s.bad : a.estado === "observar" ? s.warn : s.good}`}>
                        {a.estado === "revisar" ? "Revisar" : a.estado === "observar" ? "Observar" : "Bien"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filasAnuncios.length > 12 && (
          <button type="button" className={`${s.link} mt-3`} onClick={() => setTodosAnuncios((v) => !v)}>
            {todosAnuncios ? "Ver menos" : `Ver los ${filasAnuncios.length} anuncios`}
          </button>
        )}
      </section>

      <section className={s.section} aria-labelledby="tablero-alertas">
        <div className={s.sectionHead}>
          <h3 id="tablero-alertas" className={s.subheading}>
            Alertas
          </h3>
          <span className={s.muted}>Campañas y anuncios: período elegido · productos: últimos 7 días</span>
        </div>
        <Alertas alertas={alertas} />
      </section>
    </div>
  );
}
