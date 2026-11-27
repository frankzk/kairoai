"use client";
// Tablero › CPA por producto y canal (20/11/2026). Gasto de las campañas
// asignadas, pedidos reales (sin anulados) y unidades de cada producto, con el
// CPA por orden y por unidad, en total y abierto en Página web y WhatsApp.
// Sigue el período superior del reporte. Las reglas de canal y de reparto del
// gasto están en lib/marketing-channel-cpa.ts; aquí solo se muestran, con "≈"
// cuando la cobertura es parcial y sin inventar un costo cuando falta un dato.
//
// Origen dentro del canal (26/11/2026): arriba, el resumen de todos los
// productos por canal → origen (bot, Leads en Kairo, asesora…; formulario,
// carrito, Shopify); en cada producto abierto, el mismo detalle a un clic.
// Solo pedidos, unidades y % del canal: el gasto no se separa por origen.
//
// Búsqueda por producto (26/11/2026): filtra la tabla y el resumen pasa a
// sumar solo los productos encontrados.
//
// Sin destino (26/11/2026): el gasto de Meta sin destino leído va en su
// propia fila ("Sin destino", con el motivo) y Página web / WhatsApp llevan
// el resto, con "≈"; el WhatsApp contado por el nombre de la campaña lo dice
// debajo. "Sin desglose" solo cuando nada del gasto tiene destino.
import { useState, type CSSProperties } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import {
  filterCpaRows,
  sumCpaOrigins,
  SALE_CHANNEL_LABEL,
  SALE_CHANNELS,
  SALE_ORIGIN_HINT,
  SALE_ORIGIN_LABEL,
  type ChannelCell,
  type ChannelCpaReport,
  type ChannelCpaRow,
  type OriginCell,
  type SaleChannel,
} from "@/lib/marketing-channel-cpa";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money, percentage } from "./format";
import r from "./team-report.module.css";

const t = MARKETING_TARGETS;
const PAGE = 8;
const usd = (value: number) => money(value, "USD");

function Cells({
  value,
  row,
  channel,
  loading,
}: {
  value: ChannelCell;
  row: ChannelCpaRow;
  channel: SaleChannel | null;
  loading: boolean;
}) {
  if (loading)
    return (
      <>
        {Array.from({ length: 5 }, (_, i) => (
          <td key={i}>…</td>
        ))}
      </>
    );
  const approx =
    row.partial || row.approximate || (channel != null && row.split !== "ok");
  const mark = approx ? "≈ " : "";
  const missingSpend = channel ? "Sin desglose" : row.reason;
  const missingOrders = channel ? "Sin canal" : "Sin datos";
  const cpa = (cpaValue: number | null, unit: boolean) => {
    if (cpaValue == null)
      return value.spend == null
        ? missingSpend
        : value.orders == null
          ? missingOrders
          : value.orders === 0
            ? "Sin pedidos"
            : value.spend === 0
              ? "Sin pauta"
              : "Sin datos";
    return (
      <>
        {mark}
        {usd(cpaValue)}
        {/* Only an orientative product cost explains itself; complete ones
            and the channel rows (already marked ≈) stay clean. */}
        {!unit && approx && !channel && (
          <small>
            {row.reason.charAt(0).toLocaleLowerCase("es") + row.reason.slice(1)}
          </small>
        )}
      </>
    );
  };
  // Same rule as the CPA general por producto: only a complete, aligned cost
  // above the target is marked.
  const risky =
    !approx && value.cpaOrder != null && value.cpaOrder > t.cpaUsd;
  const inferred =
    channel === "whatsapp" && value.spend != null
      ? (row.inferredSpend ?? 0)
      : 0;
  return (
    <>
      <td>
        {value.spend == null ? missingSpend : `${mark}${usd(value.spend)}`}
        {inferred > 0.005 && (
          <small>{usd(inferred)} por el nombre de la campaña</small>
        )}
      </td>
      <td>{value.orders == null ? missingOrders : count(value.orders)}</td>
      <td>
        {value.units == null ? missingOrders : count(Math.round(value.units))}
      </td>
      <td className={risky ? r.risk : undefined}>
        {cpa(value.cpaOrder, false)}
      </td>
      <td>{cpa(value.cpaUnit, true)}</td>
    </>
  );
}

const ORIGIN_NOTE =
  "El gasto solo se puede separar por canal: el detalle muestra de dónde salieron los pedidos, sin CPA propio.";

/** One channel → its origins: orders, units and % of the channel's orders. */
function OriginTable({
  channel,
  value,
  origins,
  approx,
  loading,
  product,
  onlyUsed = false,
}: {
  channel: SaleChannel;
  value: ChannelCell;
  origins: OriginCell[];
  approx: boolean;
  loading: boolean;
  /** Product of the detail, for screen readers (null = all products). */
  product: string | null;
  /** Hide the origins without orders (product detail). */
  onlyUsed?: boolean;
}) {
  const rows = onlyUsed ? origins.filter((o) => o.orders > 0) : origins;
  const orders = value.orders ?? 0;
  const cpa =
    value.cpaOrder != null
      ? `${approx ? "≈ " : ""}${usd(value.cpaOrder)}`
      : value.spend == null
        ? "sin desglose"
        : orders === 0
          ? "sin pedidos"
          : value.spend === 0
            ? "sin pauta"
            : "sin datos";
  return (
    <table
      className={`${r.originTable} ${channel === "whatsapp" ? r.originWhatsapp : ""}`}
    >
      <caption>
        <span className={r.originCaption}>
          <span className={r.originChannel}>
            {SALE_CHANNEL_LABEL[channel]}
            {product && <span className="sr-only"> · {product}</span>}
          </span>
          <span className={r.originMeta}>
            {loading
              ? "…"
              : `${count(orders)} ${orders === 1 ? "pedido" : "pedidos"} · CPA del canal ${cpa}`}
          </span>
        </span>
      </caption>
      <thead>
        <tr>
          <th scope="col">Origen</th>
          <th scope="col">Pedidos</th>
          <th scope="col">Unidades</th>
          <th scope="col">% del canal</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan={4} className={r.originEmpty}>
              …
            </td>
          </tr>
        ) : !rows.length ? (
          <tr>
            <td colSpan={4} className={r.originEmpty}>
              Sin pedidos reales en este canal.
            </td>
          </tr>
        ) : (
          rows.map((o) => (
            <tr key={o.origin} className={o.orders ? undefined : r.originZero}>
              <th scope="row" title={SALE_ORIGIN_HINT[o.origin]}>
                {SALE_ORIGIN_LABEL[o.origin]}
              </th>
              <td>{count(o.orders)}</td>
              <td>{count(Math.round(o.units))}</td>
              <td>
                <span className={r.originShare}>
                  <span
                    className={r.originBar}
                    aria-hidden
                    style={
                      {
                        "--share": `${Math.round((o.share ?? 0) * 100)}%`,
                      } as CSSProperties
                    }
                  />
                  <span className={r.originPct}>
                    {o.share == null ? "—" : percentage(o.share)}
                  </span>
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/** Both channels of one row, side by side (stacked on a phone). */
function OriginPair({
  row,
  loading,
  product,
  onlyUsed,
}: {
  row: ChannelCpaRow;
  loading: boolean;
  product: string | null;
  onlyUsed?: boolean;
}) {
  if (!row.origins) return null;
  const approx = row.partial || row.approximate || row.split !== "ok";
  return (
    <div className={r.originGrid}>
      {SALE_CHANNELS.map((channel) => (
        <OriginTable
          key={channel}
          channel={channel}
          value={row[channel]}
          origins={row.origins![channel]}
          approx={approx}
          loading={loading}
          product={product}
          onlyUsed={onlyUsed}
        />
      ))}
    </div>
  );
}

/** Totals of all products by channel → origin, above the table. */
function OriginSummary({
  report,
  loading,
  filtered,
}: {
  report: ChannelCpaReport;
  loading: boolean;
  /** Products found by the search (null = no search: all products). */
  filtered: ChannelCpaRow[] | null;
}) {
  const view = filtered ? filteredRow(filtered) : report.totals;
  return (
    <section className={r.originSummary} aria-labelledby="cpa-origen">
      <h3 id="cpa-origen">
        De dónde salieron los pedidos
        {filtered &&
          (filtered.length === 1
            ? ` · ${filtered[0].name}`
            : ` · ${count(filtered.length)} productos`)}
      </h3>
      <p>
        {ORIGIN_NOTE}
        {filtered && filtered.length > 1
          ? " Suma de los productos encontrados: un pedido con dos de ellos cuenta en cada uno."
          : ""}
      </p>
      {filtered && !filtered.length ? (
        <p className={r.originEmpty}>Ningún producto coincide con la búsqueda.</p>
      ) : view?.origins ? (
        <OriginPair row={view} loading={loading} product={null} />
      ) : (
        <p className={r.originEmpty}>
          {loading
            ? "Consultando pedidos…"
            : "El canal de los pedidos no está disponible: no se pudo cruzar con iComfly."}
        </p>
      )}
      {!loading && !filtered && report.totals.origins && report.unknownOrders > 0 && (
        <p className={r.originFoot}>
          {count(report.unknownOrders)}{" "}
          {report.unknownOrders === 1
            ? "pedido real sin canal (sin cruce con iComfly) no entra"
            : "pedidos reales sin canal (sin cruce con iComfly) no entran"}{" "}
          en este detalle.
        </p>
      )}
    </section>
  );
}

/** Several product rows as one, for the filtered summary (≈ when more than one). */
function filteredRow(rows: ChannelCpaRow[]): ChannelCpaRow | null {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const sum = (channel: "total" | SaleChannel): ChannelCell => {
    const cells = rows.map((row) => row[channel]);
    const add = (pick: (c: ChannelCell) => number | null) =>
      cells.some((c) => pick(c) == null)
        ? null
        : cells.reduce((n, c) => n + (pick(c) ?? 0), 0);
    const spend = add((c) => c.spend);
    const orders = add((c) => c.orders);
    const units = add((c) => c.units);
    return {
      spend,
      orders,
      units,
      cpaOrder: spend && orders ? spend / orders : null,
      cpaUnit: spend && units ? spend / units : null,
    };
  };
  return {
    ...rows[0],
    key: "filtered",
    name: `${rows.length} productos`,
    total: sum("total"),
    landing: sum("landing"),
    whatsapp: sum("whatsapp"),
    origins: sumCpaOrigins(rows),
    // Orders with two of these products count in each: approximate.
    approximate: true,
  };
}

function Group({
  row,
  open,
  onToggle,
  originOpen = false,
  onOriginToggle,
  loading,
  total = false,
}: {
  row: ChannelCpaRow;
  open: boolean;
  onToggle: () => void;
  originOpen?: boolean;
  onOriginToggle?: () => void;
  loading: boolean;
  total?: boolean;
}) {
  const id = `canal-${row.key.replace(/[^a-z0-9]+/gi, "-")}`;
  // The totals' detail is the summary above the table.
  const detail = !total && row.origins != null && onOriginToggle != null;
  // Spend without a read destination: its own row, never in a channel.
  const unknown = (row.unknownSpend ?? 0) > 0.005;
  return (
    <tbody className={total ? r.channelTotal : undefined}>
      <tr>
        <th scope="row">
          <button
            type="button"
            className={r.channelToggle}
            aria-expanded={open}
            aria-controls={[
              `${id}-landing`,
              `${id}-whatsapp`,
              ...(unknown ? [`${id}-sin-destino`] : []),
              ...(detail ? [`${id}-origen-fila`] : []),
            ].join(" ")}
            onClick={onToggle}
          >
            <ChevronRight aria-hidden size={14} />
            <span className={r.productName} title={row.name}>
              {total ? "Total · todos los productos" : row.name}
            </span>
          </button>
          <small>
            {total
              ? "Toda la pauta / todos los pedidos reales"
              : `${count(row.campaignCount)} ${row.campaignCount === 1 ? "campaña" : "campañas"}`}
          </small>
        </th>
        <Cells value={row.total} row={row} channel={null} loading={loading} />
      </tr>
      {SALE_CHANNELS.map((channel) => (
        <tr
          key={channel}
          id={`${id}-${channel}`}
          className={r.channelSub}
          hidden={!open}
        >
          <th scope="row">{SALE_CHANNEL_LABEL[channel]}</th>
          <Cells
            value={row[channel]}
            row={row}
            channel={channel}
            loading={loading}
          />
        </tr>
      ))}
      {unknown && (
        <tr
          id={`${id}-sin-destino`}
          className={`${r.channelSub} ${r.channelUnknown}`}
          hidden={!open}
        >
          <th scope="row">Sin destino</th>
          <td>{loading ? "…" : usd(row.unknownSpend ?? 0)}</td>
          <td>—</td>
          <td>—</td>
          <td colSpan={2} className={r.channelNote}>
            {loading ? "…" : row.spendNote}
          </td>
        </tr>
      )}
      {detail && (
        <tr id={`${id}-origen-fila`} className={r.originRow} hidden={!open}>
          <td colSpan={6}>
            <div className={r.originDetail}>
              <button
                type="button"
                className={r.channelToggle}
                aria-expanded={originOpen}
                aria-controls={`${id}-origen`}
                onClick={onOriginToggle}
              >
                <ChevronRight aria-hidden size={14} />
                <span>De dónde salieron los pedidos</span>
              </button>
              <div id={`${id}-origen`} hidden={!originOpen}>
                <p>{ORIGIN_NOTE}</p>
                <OriginPair
                  row={row}
                  loading={loading}
                  product={row.name}
                  onlyUsed
                />
              </div>
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

export function ChannelCpaTable({
  report,
  loading,
  error,
  periodText,
  onAssign,
}: {
  report: ChannelCpaReport | null;
  loading: boolean;
  error: string;
  /** Name of the report period ("Hoy", "1 al 6 nov"). */
  periodText: string;
  onAssign: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ total: true });
  const [originOpen, setOriginOpen] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = (key: string) =>
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  const toggleOrigin = (key: string) =>
    setOriginOpen((current) => ({ ...current, [key]: !current[key] }));
  const rows = report?.rows ?? [];
  const searching = query.trim().length > 0;
  const found = searching ? filterCpaRows(rows, query) : rows;
  // A search shows every match: no "Ver todos".
  const visible = searching || all ? found : rows.slice(0, PAGE);
  const notes = report
    ? [
        report.ordersChannel === "unavailable"
          ? "No se pudo cruzar los pedidos con iComfly: el canal de los pedidos no está disponible."
          : report.unknownOrders > 0
            ? `${count(report.unknownOrders)} pedidos reales sin cruce con iComfly quedan sin canal (cuentan en el total).`
            : "",
        report.spendChannel === "unavailable"
          ? "Meta no dejó leer el destino de los conjuntos de anuncios: el gasto no se reparte por canal."
          : report.spendChannel === "partial"
            ? "Parte del gasto de Meta no tiene destino leído: va aparte como «sin destino» y el CPA por canal de esos productos es aproximado (≈), sobre el gasto con destino."
            : "",
        report.spendInferred
          ? "Las campañas sin destino leído cuyo nombre dice WhatsApp (WSP, WPP, WhatsApp) cuentan como WhatsApp (≈)."
          : "",
      ].filter(Boolean)
    : [];
  return (
    <section className={r.section} aria-labelledby="cpa-canal">
      <div className={r.sectionHead}>
        <div>
          <h2 id="cpa-canal">CPA por producto y canal</h2>
          <button className={r.assignLink} onClick={onAssign}>
            Asignar campañas para calcular el CPA
          </button>
          <p>
            {periodText}, el período elegido arriba. CPA por orden =
            gasto de las campañas asignadas / pedidos reales del producto (sin
            anulados); CPA por unidad = gasto / unidades de esos pedidos. Abre
            un producto para ver Página web y WhatsApp, y de dónde salieron sus
            pedidos.
          </p>
        </div>
      </div>
      {rows.length > 0 && (
        <div className={r.cpaSearch}>
          <label className={r.cpaSearchBox}>
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar producto…"
              aria-label="Buscar producto"
            />
            {searching && (
              <button
                type="button"
                aria-label="Borrar la búsqueda"
                onClick={() => setQuery("")}
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </label>
          {searching && (
            <span className={r.cpaSearchCount} aria-live="polite">
              {found.length === 1
                ? "1 producto"
                : `${count(found.length)} de ${count(rows.length)} productos`}
            </span>
          )}
        </div>
      )}
      {report && (
        <OriginSummary
          report={report}
          loading={loading}
          filtered={searching ? found : null}
        />
      )}
      <div
        className={r.tableWrap}
        tabIndex={0}
        role="region"
        aria-label="CPA por producto y canal"
      >
        <table className={r.channelTable}>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Gasto</th>
              <th scope="col">Órdenes reales</th>
              <th scope="col">Unidades</th>
              <th scope="col">CPA por orden</th>
              <th scope="col">CPA por unidad</th>
            </tr>
          </thead>
          {report && !searching && (
            <Group
              row={report.totals}
              open={Boolean(open.total)}
              onToggle={() => toggle("total")}
              loading={loading}
              total
            />
          )}
          {visible.map((row) => (
            <Group
              key={row.key}
              row={row}
              open={Boolean(open[row.key])}
              onToggle={() => toggle(row.key)}
              originOpen={Boolean(originOpen[row.key])}
              onOriginToggle={() => toggleOrigin(row.key)}
              loading={loading}
            />
          ))}
          {!visible.length && (
            <tbody>
              <tr>
                <td colSpan={6} className={r.channelEmpty}>
                  {loading
                    ? "Consultando gasto y pedidos…"
                    : searching && rows.length
                      ? `Ningún producto coincide con «${query.trim()}».`
                      : error ||
                        "Sin gasto ni pedidos reales de productos en este período."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
      <div className={r.pagination}>
        <p>
          {[
            ...notes,
            "Página web = formulario, carrito recuperado y Shopify (hasta el 28/10). WhatsApp = bot de WhatsApp (desde anuncio u orgánico, según el anuncio que inició el chat en iComfly; «sin revisar» mientras Kairo no lo consultó), pedidos creados desde Leads en Kairo, asesoras en iComfly y pedidos MANUAL sin creador. El gasto de Meta se reparte por el destino de cada conjunto de anuncios; TikTok cuenta como Página web. El total incluye campañas sin asignar y no es la suma de las filas.",
          ].join(" ")}
        </p>
        {!searching && rows.length > PAGE && (
          <button type="button" onClick={() => setAll(!all)}>
            {all ? "Ver menos" : `Ver todos (${count(rows.length)})`}
          </button>
        )}
      </div>
    </section>
  );
}
