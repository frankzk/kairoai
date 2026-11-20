"use client";
// Tablero › CPA por producto y canal (20/11/2026). Gasto de las campañas
// asignadas, pedidos reales (sin anulados) y unidades de cada producto, con el
// CPA por orden y por unidad, en total y abierto en Landing y WhatsApp. Sigue
// el período superior del reporte. Las reglas de canal y de reparto del gasto
// están en lib/marketing-channel-cpa.ts; aquí solo se muestran, con "≈" cuando
// la cobertura es parcial y sin inventar un costo cuando falta un dato.
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  SALE_CHANNEL_LABEL,
  SALE_CHANNELS,
  type ChannelCell,
  type ChannelCpaReport,
  type ChannelCpaRow,
  type SaleChannel,
} from "@/lib/marketing-channel-cpa";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money } from "./format";
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
  return (
    <>
      <td>
        {value.spend == null ? missingSpend : `${mark}${usd(value.spend)}`}
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

function Group({
  row,
  open,
  onToggle,
  loading,
  total = false,
}: {
  row: ChannelCpaRow;
  open: boolean;
  onToggle: () => void;
  loading: boolean;
  total?: boolean;
}) {
  const id = `canal-${row.key.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <tbody className={total ? r.channelTotal : undefined}>
      <tr>
        <th scope="row">
          <button
            type="button"
            className={r.channelToggle}
            aria-expanded={open}
            aria-controls={`${id}-landing ${id}-whatsapp`}
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
  const [all, setAll] = useState(false);
  const toggle = (key: string) =>
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  const rows = report?.rows ?? [];
  const visible = all ? rows : rows.slice(0, PAGE);
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
            ? "Parte del gasto de Meta no tiene destino leído: esos productos quedan sin desglose de gasto."
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
            {periodText}, el período superior del reporte. CPA por orden =
            gasto de las campañas asignadas / pedidos reales del producto (sin
            anulados); CPA por unidad = gasto / unidades de esos pedidos. Abre
            un producto para ver Landing y WhatsApp.
          </p>
        </div>
      </div>
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
          {report && (
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
              loading={loading}
            />
          ))}
          {!visible.length && (
            <tbody>
              <tr>
                <td colSpan={6} className={r.channelEmpty}>
                  {loading
                    ? "Consultando gasto y pedidos…"
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
            "Landing = formulario web, carrito recuperado y Shopify (hasta el 28/10). WhatsApp = bot, Conector IA y pedidos de asesoras. El gasto de Meta se reparte por el destino de cada conjunto de anuncios; TikTok cuenta como Landing. El total incluye campañas sin asignar y no es la suma de las filas.",
          ].join(" ")}
        </p>
        {rows.length > PAGE && (
          <button type="button" onClick={() => setAll(!all)}>
            {all ? "Ver menos" : `Ver todos (${count(rows.length)})`}
          </button>
        )}
      </div>
    </section>
  );
}
