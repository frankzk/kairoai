"use client";
import { useMemo, useState } from "react";
import type { CharlieModel } from "@/lib/marketing-charlie";
import type { CharlieSettings } from "@/lib/marketing-charlie-types";
import type { MarketingPeriod } from "@/lib/marketing-dates";
import { marketingDate } from "@/lib/marketing-dates";
import { count, money, percentage, shortDate } from "./format";
import s from "./dashboard.module.css";
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;

export function CharlieCurrency({
  settings,
  loading,
  error,
  canEdit,
  saving,
  save,
}: {
  settings: CharlieSettings | null;
  loading: boolean;
  error: string;
  canEdit: boolean;
  saving: string;
  save: Save;
}) {
  const [manual, setManual] = useState(Boolean(settings?.config.crc_per_usd));
  const [rate, setRate] = useState(
    String(settings?.config.crc_per_usd ?? settings?.fx.rate ?? ""),
  );
  const [date, setDate] = useState(
    settings?.config.rate_date || settings?.fx.date || marketingDate(),
  );
  const [saved, setSaved] = useState(false);
  return (
    <details className={`${s.section} border-b border-border pb-4`}>
      <summary className={s.link}>Moneda y referencia de conversión</summary>
      <div className="mt-4 space-y-3">
        <p className={s.muted}>
          {loading
            ? "Consultando referencia USD…"
            : settings?.fx.rate
              ? `Todos los reportes en USD. Referencia ${settings.fx.source === "hacienda" ? "Hacienda, venta" : "manual"}: ${count(settings.fx.rate)} CRC por USD, ${settings.fx.date}. Períodos históricos reexpresados a esta tasa, no a tasas históricas.`
              : "La referencia USD no está disponible. Los importes originalmente en CRC permanecen pendientes de conversión."}{" "}
          {settings?.fx.source === "hacienda" && (
            <a
              className={s.link}
              href="https://api.hacienda.go.cr/indicadores/tc/dolar"
              target="_blank"
              rel="noreferrer"
            >
              Consultar fuente
            </a>
          )}
        </p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setSaved(false);
            setSaved(
              await save("fx", {
                kind: "config",
                crc_per_usd: manual ? Number(rate) : null,
                rate_date: manual ? date : null,
                hero_product_keys: settings?.config.hero_product_keys ?? [],
              }),
            );
          }}
        >
          <div className={s.toolbar}>
            <label className={s.field}>
              Referencia
              <select
                className={s.control}
                value={manual ? "manual" : "official"}
                disabled={!canEdit || Boolean(saving)}
                onChange={(event) => setManual(event.target.value === "manual")}
              >
                <option value="official">Hacienda, automática</option>
                <option value="manual">Manual de planificación</option>
              </select>
            </label>
            {manual && (
              <>
                <label className={s.field}>
                  CRC por USD
                  <input
                    className={s.control}
                    type="number"
                    min="0.0001"
                    max="100000"
                    step="0.0001"
                    required
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                </label>
                <label className={s.field}>
                  Fecha de referencia
                  <input
                    className={s.control}
                    type="date"
                    max={marketingDate()}
                    required
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
              </>
            )}
            <button
              className={s.button}
              disabled={!canEdit || loading || Boolean(saving)}
              type="submit"
            >
              {saving === "fx" ? "Guardando…" : "Guardar referencia"}
            </button>
          </div>
          {error && (
            <p role="alert" className={`${s.warn} mt-3 text-xs`}>
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className={`${s.good} mt-3 text-xs`}>
              Referencia guardada.
            </p>
          )}
        </form>
      </div>
    </details>
  );
}
function RevenueChart({ model }: { model: CharlieModel }) {
  const max = Math.max(
    1,
    ...model.trailing.flatMap((day) => [
      day.revenueUsd ?? 0,
      day.metaSpendUsd ?? 0,
    ]),
  );
  const y = (value: number) => 166 - (value / max) * 140,
    x = (index: number) => 70 + index * 85;
  const hasRevenue = model.trailing.some((day) => day.revenueUsd != null);
  return (
    <div>
      <h2 className={s.heading}>Últimos 7 días: Meta e ingreso potencial</h2>
      <div className={s.legend}>
        <span>
          <span className={s.dot} style={{ background: "oklch(79% .1 165)" }} />
          Ingreso potencial USD
        </span>
        <span>
          <span
            className={s.dot}
            style={{ background: "oklch(78% .09 235)" }}
          />
          Gasto Meta USD
        </span>
      </div>
      {!hasRevenue ? (
        <div className={s.empty}>
          Se necesita una referencia USD y el valor de los pedidos para comparar
          las series.
        </div>
      ) : (
        <svg
          role="img"
          aria-label="Ingreso potencial y gasto Meta en USD, detalle en la tabla inferior"
          className="w-full"
          viewBox="0 0 650 200"
        >
          {[0, 0.5, 1].map((tick) => (
            <g key={tick}>
              <line
                x1="50"
                x2="600"
                y1={y(max * tick)}
                y2={y(max * tick)}
                stroke="hsl(var(--border))"
              />
              <text
                x="42"
                y={y(max * tick) + 4}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
              >
                {count(Math.round(max * tick))}
              </text>
            </g>
          ))}
          {model.trailing.map((day, index) => (
            <g key={day.date}>
              {day.revenueUsd != null && (
                <rect
                  x={x(index) - 14}
                  y={y(day.revenueUsd)}
                  height={166 - y(day.revenueUsd)}
                  width="12"
                  fill="oklch(79% .1 165)"
                >
                  <title>
                    {day.date}: {money(day.revenueUsd)} potencial
                  </title>
                </rect>
              )}
              {day.metaSpendUsd != null && (
                <rect
                  x={x(index)}
                  y={y(day.metaSpendUsd)}
                  height={166 - y(day.metaSpendUsd)}
                  width="12"
                  fill="oklch(78% .09 235)"
                >
                  <title>
                    {day.date}: {money(day.metaSpendUsd)} Meta
                  </title>
                </rect>
              )}
              <text
                x={x(index)}
                y="190"
                textAnchor="middle"
                fontSize="9"
                fill="currentColor"
              >
                {shortDate(day.date)}
              </text>
            </g>
          ))}
        </svg>
      )}
      <details>
        <summary className={s.link}>Ver cifras por día</summary>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th className={s.numeric}>Ingreso potencial USD</th>
                <th className={s.numeric}>Meta USD</th>
              </tr>
            </thead>
            <tbody>
              {model.trailing.map((day) => (
                <tr key={day.date}>
                  <td>{shortDate(day.date)}</td>
                  <td className={s.numeric}>{money(day.revenueUsd)}</td>
                  <td className={s.numeric}>{money(day.metaSpendUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={`${s.muted} mt-3`}>
        El gasto de esta serie es Meta, no el total combinado. La serie termina
        en la fecha final del filtro o en hoy. El ingreso es el valor al crear
        pedidos; no es cobro.
      </p>
    </div>
  );
}
export function CharlieExecutive({
  model,
  loading,
  error,
  reportLoading,
}: {
  model: CharlieModel;
  loading: boolean;
  error: string;
  reportLoading: boolean;
}) {
  const decisionTitle =
    model.decision === "blocked"
      ? "Freno por desempeño"
      : model.decision === "incomplete"
        ? "Faltan datos para decidir"
        : "Hay margen potencial para revisar";
  return (
    <>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>Motor de decisión Charlie</h2>
          <p className={s.muted}>
            Base confirmada: valor de pedidos creados, ingreso potencial. Techo
            CPA USD 8.50.
          </p>
        </div>
        <span className={`${s.badge} ${s.warn}`}>
          {model.coverage.partial
            ? "Inversión parcial"
            : "Cobertura de plataformas completa"}
        </span>
      </div>
      {error && (
        <div role="alert" className={`${s.notice} ${s.warn}`}>
          {error}
        </div>
      )}
      <dl className={s.metrics}>
        {[
          [
            "Profit Volume potencial",
            model.profitVolume == null
              ? "Sin datos"
              : money(model.profitVolume),
            "Ingreso potencial menos publicidad",
          ],
          [
            "GPT potencial",
            money(model.gpt),
            "AOV potencial menos CPA combinado",
          ],
          [
            "CPA blended",
            money(model.cpa),
            "Gasto consultado / pedidos creados",
          ],
          ["Headroom", money(model.headroom), "USD 8.50 menos CPA combinado"],
          [
            "Pedidos creados",
            model.totalOrders == null ? "Sin datos" : count(model.totalOrders),
            "Todos los canales, incluidos anulados",
          ],
        ].map(([label, value, note]) => (
          <div key={label} className={s.metric}>
            <dt>{label}</dt>
            <dd className={s.value}>{loading ? "Consultando…" : value}</dd>
            <dd>
              <small>{note}</small>
            </dd>
          </div>
        ))}
      </dl>
      <div className={s.split}>
        <section className={s.section}>
          {reportLoading ? (
            <div
              className={s.skeleton}
              role="status"
              aria-label="Consultando detalle de anuncios para la serie de gasto"
            />
          ) : (
            <RevenueChart model={model} />
          )}
        </section>
        <section className={s.section}>
          <span
            className={`${s.badge} ${model.decision === "blocked" ? s.warn : model.decision === "review" ? s.good : ""}`}
          >
            Decisión de escalado
          </span>
          <h2 className={`${s.heading} mt-3`}>
            {loading ? "Verificando datos" : decisionTitle}
          </h2>
          <ul className={`${s.muted} mt-4 space-y-2`}>
            <li>
              Ingreso potencial: {money(model.revenueUsd)}. AOV potencial:{" "}
              {money(model.aov)}.
            </li>
            {model.coverage.partial && (
              <li>
                Falta completar la inversión de Meta y TikTok; el costo
                observado es parcial.
              </li>
            )}
            {model.headroom != null && model.headroom < 0 && (
              <li>
                El CPA observado supera el techo. No hay headroom con este
                objetivo.
              </li>
            )}
            {(model.totalOrders ?? 0) < 20 && (
              <li>
                Se necesitan al menos 20 pedidos para una señal con mayor base.
              </li>
            )}
            {!model.settings?.fx.rate && (
              <li>No hay una referencia de conversión USD verificada.</li>
            )}
            <li>
              Validar cobro, devoluciones, costo de producto, logística y stock
              antes de aumentar presupuesto. Este cálculo potencial no confirma
              rentabilidad.
            </li>
          </ul>
          <dl className={`${s.list} mt-5`}>
            {[
              [
                "Revenue Floor observado",
                model.floorShare == null
                  ? "Pendiente"
                  : percentage(model.floorShare),
              ],
              ["Ingreso potencial de recurrentes", money(model.recurringUsd)],
              [
                "Cobertura de identificación",
                percentage(model.business?.identityCoverage ?? null),
              ],
              [
                "Hero Offer",
                model.settings?.config.hero_product_keys.length
                  ? money(model.heroUsd)
                  : "Sin definir",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className={`${s.listItem} flex justify-between gap-3 text-xs`}
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className={`${s.muted} mt-3`}>
            Recompra observada por teléfono con una entrega anterior en el
            histórico de Kairo. Puede representar un hogar; no prueba identidad.
            Sin fechas de entrega verificables, la recompra queda pendiente.
            Revenue Floor requiere definir la Hero Offer. Con identificación
            incompleta, la participación observada es una cota mínima, no
            ingreso garantizado.
          </p>
        </section>
      </div>
      <p className={`${s.muted} mb-6`}>
        Profit Volume y GPT siguen las fórmulas del esquema: aún no descuentan
        producto, logística, devoluciones, nómina ni otros gastos. No son
        utilidad neta ni inyección de caja. El valor de pedidos creados incluye
        el valor original de pedidos que luego se anularon.
      </p>
    </>
  );
}

export function CharlieMatrix({
  model,
  period,
  onDay,
}: {
  model: CharlieModel;
  period: MarketingPeriod;
  onDay: (day: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [account, setAccount] = useState(""),
    [role, setRole] = useState(""),
    [page, setPage] = useState(0),
    [sort, setSort] = useState("spend");
  const rows = useMemo(
    () =>
      model.ads
        .filter(
          (ad) =>
            (ad.spendUsd ?? 0) > 0 &&
            (!account || ad.accountId === account) &&
            (!role ||
              (role === "upper"
                ? ad.frequency != null && ad.frequency <= 1.2
                : ad.frequency != null && ad.frequency >= 1.25)) &&
            `${ad.name} ${ad.adsetName}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "cpa"
            ? (b.cpa ?? -1) - (a.cpa ?? -1)
            : sort === "frequency"
              ? (b.frequency ?? -1) - (a.frequency ?? -1)
              : (b.spendUsd ?? -1) - (a.spendUsd ?? -1),
        ),
    [model.ads, query, account, role, sort],
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages - 1),
    accounts = Array.from(
      new Map(model.ads.map((ad) => [ad.accountId, ad.accountName])),
    );
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>Matriz diagnóstica 4Pi por anuncio</h2>
          <p className={s.muted}>
            Gasto, CPM, CPA y GPT del período. Frecuencia exacta de un día, sin
            promediar frecuencias diarias.
          </p>
        </div>
      </div>
      <div className={`${s.toolbar} mb-5`}>
        <label className={s.field}>
          Día de frecuencia y sustracción
          <input
            className={s.control}
            type="date"
            min={period.from}
            max={period.to < marketingDate() ? period.to : marketingDate()}
            value={model.day}
            onChange={(event) => onDay(event.target.value)}
          />
        </label>
        <label className={s.field}>
          Buscar anuncio
          <input
            className={s.control}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className={s.field}>
          Cuenta
          <select
            className={s.control}
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas</option>
            {accounts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          Embudo orientativo
          <select
            className={s.control}
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            <option value="upper">Prospecting</option>
            <option value="lower">Retargeting</option>
          </select>
        </label>
        <label className={s.field}>
          Orden
          <select
            className={s.control}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="spend">Mayor gasto</option>
            <option value="cpa">Mayor CPA</option>
            <option value="frequency">Mayor frecuencia diaria</option>
          </select>
        </label>
      </div>
      <div className={s.tableWrap}>
        <table className={`${s.table} min-w-[1100px]`}>
          <thead>
            <tr>
              <th>Anuncio / conjunto</th>
              <th className={s.numeric}>Gasto USD</th>
              <th className={s.numeric}>Frecuencia 1 día</th>
              <th className={s.numeric}>CPM USD</th>
              <th className={s.numeric}>Compras Meta</th>
              <th className={s.numeric}>CPA Meta USD</th>
              <th className={s.numeric}>GPT Meta USD</th>
              <th>Rol orientativo</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 20, (current + 1) * 20).map((ad) => (
              <tr key={ad.key}>
                <td className="max-w-[280px]">
                  <span className="block font-medium">{ad.name}</span>
                  <span className={s.muted}>
                    {ad.accountName} · {ad.adsetName}
                  </span>
                </td>
                <td className={s.numeric}>{money(ad.spendUsd)}</td>
                <td className={s.numeric}>
                  {ad.frequency == null ? "Sin datos" : ad.frequency.toFixed(2)}
                </td>
                <td className={s.numeric}>{money(ad.cpm)}</td>
                <td className={s.numeric}>{count(ad.purchases)}</td>
                <td
                  className={`${s.numeric} ${(ad.cpa ?? 0) > 8.5 ? s.warn : ""}`}
                >
                  {money(ad.cpa)}
                </td>
                <td className={s.numeric}>{money(ad.gpt)}</td>
                <td>
                  <span
                    className={`${s.badge} ${ad.frequency != null && ad.frequency <= 1.2 ? s.good : ""}`}
                  >
                    {ad.funnel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className={s.empty}>
          No hay anuncios con inversión y estos filtros. Comprueba el período y
          la cuenta.
        </div>
      )}
      <div className={`${s.toolbar} mt-4 justify-between`}>
        <span className={s.muted}>
          {count(rows.length)} anuncios · {current + 1}/{pages}
        </span>
        <div className="flex gap-2">
          <button
            className={s.button}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <button
            className={s.button}
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
      <p className={`${s.muted} mt-4`}>
        Frecuencia ≤1,20 sugiere prospecting; ≥1,25 sugiere retargeting. No
        confirma la audiencia ni revela decisiones internas del algoritmo. GPT
        Meta usa valor de compras reportado por Meta, no ingresos de Kairo. Sin
        compras, CPA y GPT quedan sin datos.
      </p>
    </section>
  );
}

export function CharlieStructure({
  model,
  canEdit,
  saving,
  save,
  error,
}: {
  model: CharlieModel;
  canEdit: boolean;
  saving: string;
  save: Save;
  error: string;
}) {
  const [filter, setFilter] = useState(""),
    [page, setPage] = useState(0);
  const rows = model.structure.filter(
    (set) =>
      ((set.activeAds ?? 0) > 0 || (set.spendUsd ?? 0) > 0) &&
      (!filter || set.role === filter),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages - 1);
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>Estructura Andromeda 1</h2>
          <p className={s.muted}>
            Estructura real de las cinco cuentas. Roles detectados por nombre y
            corregibles en Kairo. Los metadatos pueden conservarse hasta 5
            minutos; no se modifica Meta.
          </p>
        </div>
        <label className={s.field}>
          Rol del conjunto
          <select
            className={s.control}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            <option value="control">Control</option>
            <option value="testing">Testing</option>
            <option value="other">Sin clasificar / otro</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className={`${s.warn} mb-4 text-xs`}>
          {error}
        </p>
      )}
      <div className={s.tableWrap}>
        <table className={`${s.table} min-w-[1000px]`}>
          <thead>
            <tr>
              <th>Campaña / conjunto</th>
              <th>Presupuesto</th>
              <th>Clasificación</th>
              <th className={s.numeric}>Anuncios activos</th>
              <th className={s.numeric}>Gasto USD</th>
              <th>Control y testing</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 15, (current + 1) * 15).map((set) => (
              <tr key={set.key}>
                <td className="max-w-[280px]">
                  <span className="block font-medium">{set.name}</span>
                  <span className={s.muted}>
                    {set.accountName} · {set.campaignName}
                  </span>
                </td>
                <td>
                  {set.cbo == null
                    ? "Sin verificar"
                    : set.cbo
                      ? "CBO"
                      : "ABO / sin CBO"}
                </td>
                <td>
                  <label className={s.field}>
                    <span className="sr-only">Rol de {set.name}</span>
                    <select
                      className={s.control}
                      value={set.manualRole ?? "auto"}
                      disabled={!canEdit || Boolean(saving)}
                      onChange={(event) =>
                        save(set.key, {
                          kind: "role",
                          account_id: set.accountId,
                          adset_id: set.id,
                          role: event.target.value,
                        })
                      }
                    >
                      <option value="auto">Auto: {set.detectedRole}</option>
                      <option value="control">Control</option>
                      <option value="testing">Testing</option>
                      <option value="other">Otro</option>
                    </select>
                  </label>
                  <span className={s.muted}>
                    {saving === set.key
                      ? "Guardando…"
                      : set.manualRole
                        ? "Corrección guardada"
                        : "Detectado por nombre"}
                  </span>
                </td>
                <td className={s.numeric}>
                  {set.activeAds ?? "Sin verificar"}
                </td>
                <td className={s.numeric}>{money(set.spendUsd)}</td>
                <td className="max-w-[320px]">
                  {!set.metadataComplete ? (
                    "Metadatos incompletos"
                  ) : set.role === "control" ? (
                    <>
                      <span
                        className={
                          (set.activeAds ?? 0) >= 4 && (set.activeAds ?? 0) <= 8
                            ? s.good
                            : s.warn
                        }
                      >
                        {(set.activeAds ?? 0) >= 4 && (set.activeAds ?? 0) <= 8
                          ? "Dentro de referencia 4–8"
                          : "Fuera de referencia 4–8"}
                      </span>
                      <p className={s.muted}>
                        {set.posts.length} Post IDs actuales. Sin verificación
                        histórica de estabilidad.
                      </p>
                    </>
                  ) : set.role === "testing" ? (
                    <>
                      <span>
                        {set.pattern322} anuncios con 3:2:2 verificable
                      </span>
                      <p className={s.muted}>
                        {set.dynamic
                          ? "Conjunto dinámico"
                          : "Dinámico no declarado"}{" "}
                        · {set.flexAds.length} anuncios con especificación de
                        activos
                      </p>
                    </>
                  ) : (
                    "Define el rol para revisar esta estructura."
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className={s.empty}>
          No hay conjuntos activos o con gasto en este filtro. Si los nombres no
          expresan Control o Testing, clasifícalos manualmente.
        </div>
      )}
      <div className={`${s.toolbar} mt-4 justify-between`}>
        <span className={s.muted}>
          {rows.length} conjuntos · {current + 1}/{pages}
        </span>
        <div className="flex gap-2">
          <button
            className={s.button}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <button
            className={s.button}
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Siguiente
          </button>
        </div>
      </div>
      <div className={`${s.notice} mt-6`}>
        <div>
          <h3 className={s.listTitle}>
            Cosecha 3:2:2: pendiente de evidencia por combinación
          </h3>
          <p className={s.muted}>
            El reporte disponible no verifica gasto e interacciones conjuntos de
            cada permutación de creativo, texto y titular. Un anuncio dinámico
            con 100% del gasto no prueba que una combinación supere 60%. No se
            emite una alerta de cosecha ni se presenta su Post ID como ganador
            de una permutación.
          </p>
        </div>
      </div>
      <details>
        <summary className={s.link}>
          Consultar Post IDs de anuncios Testing
        </summary>
        <ul className={`${s.list} mt-3`}>
          {model.ads
            .filter((ad) => ad.role === "testing" && ad.postId)
            .slice(0, 30)
            .map((ad) => (
              <li key={ad.key} className={s.listItem}>
                <span className={s.listTitle}>{ad.name}</span>
                <p className={s.muted}>
                  Post del anuncio:{" "}
                  <a
                    className={s.link}
                    href={`https://www.facebook.com/${ad.postId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ad.postId}
                  </a>
                  . No acredita una combinación ganadora.
                </p>
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
export function CharlieSubtraction({
  model,
  period,
  onDay,
}: {
  model: CharlieModel;
  period: MarketingPeriod;
  onDay: (day: string) => void;
}) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>Centro de sustracción</h2>
          <p className={s.muted}>
            Candidatos con 10–40% del gasto diario de su cuenta y eficiencia
            débil. Son señales para revisar, no órdenes de pausa.
          </p>
        </div>
        <label className={s.field}>
          Día analizado
          <input
            className={s.control}
            type="date"
            min={period.from}
            max={period.to < marketingDate() ? period.to : marketingDate()}
            value={model.day}
            onChange={(event) => onDay(event.target.value)}
          />
        </label>
      </div>
      <div className={s.tableWrap}>
        <table className={`${s.table} min-w-[1000px]`}>
          <thead>
            <tr>
              <th>Anuncio</th>
              <th className={s.numeric}>Gasto diario USD</th>
              <th className={s.numeric}>Parte de cuenta</th>
              <th className={s.numeric}>CPA diario USD</th>
              <th className={s.numeric}>GPT diario USD</th>
              <th>Motivo y revisión</th>
            </tr>
          </thead>
          <tbody>
            {model.passives.map((ad) => (
              <tr key={ad.key}>
                <td className="max-w-[230px]">
                  <span className="block font-medium">{ad.name}</span>
                  <span className={s.muted}>
                    {ad.accountName} · {ad.funnel}
                  </span>
                </td>
                <td className={s.numeric}>{money(ad.daySpendUsd)}</td>
                <td className={s.numeric}>{percentage(ad.spendShare)}</td>
                <td className={s.numeric}>{money(ad.dayCpa)}</td>
                <td className={s.numeric}>{money(ad.dayGpt)}</td>
                <td className="max-w-[330px]">
                  <ul className={`${s.muted} mb-2`}>
                    {ad.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <a
                    className={s.link}
                    href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ad.accountId}&selected_ad_ids=${ad.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Revisar pausa en Meta
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!model.passives.length && (
        <div className={s.empty}>
          No hay anuncios que cumplan estos criterios con el reporte de este
          día. Esto no descarta otros riesgos ni confirma rentabilidad.
        </div>
      )}
      <p className={`${s.muted} mt-4`}>
        La comparación GPT usa el promedio ponderado por compras reportadas de
        la cuenta en ese día. Sin compras no se inventa CPA cero: el gasto
        significativo sin compras se marca aparte. Valida el rol del anuncio y
        el retraso de atribución antes de actuar. Kairo no pausa anuncios ni
        cambia presupuestos desde este panel.
      </p>
    </section>
  );
}
