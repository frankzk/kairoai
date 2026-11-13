"use client";
import { useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CampaignActionRow } from "@/lib/marketing-actions";
import type { Coverage } from "@/lib/marketing-coverage";
import type { ProductInsightsPayload } from "@/lib/marketing-insights-types";
import {
  buildInventoryDecision,
  inventoryStaleDate,
  staleInventoryText,
  type PresentationRow,
  type SizeColorGroup,
  VARIANT_DEMAND_MISSING,
} from "@/lib/marketing-inventory-decide";
import { decimalText } from "@/lib/marketing-copy";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, shortDate } from "./format";
import { InventoryAlerts } from "./InventoryAlerts";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const PAGE = 30;

export const coverageChipClass = (coverage: Coverage) =>
  coverage.tone === "red"
    ? r.chipRed
    : coverage.tone === "yellow"
      ? r.chipYellow
      : coverage.tone === "ok"
        ? r.chipOk
        : r.chipMuted;
const number = (value: number | null) => (value == null ? "—" : count(value));

/** Stock sources, stale date and the inventory decision for a set of action rows. */
export function useInventoryDecision(input: {
  data: MarketingSummary;
  model: MarketingIntelligence;
  sources: MarketingSources | null;
  settings: MarketingSettings | null;
  actionRows: CampaignActionRow[];
  campaignMembers: Map<string, string[]> | null;
  insights?: ProductInsightsPayload | null;
}) {
  const { data, model, sources, settings, actionRows, campaignMembers } = input;
  const insights = input.insights ?? null;
  return useMemo(() => {
    const inventory =
      sources?.shiphero.status === "ready" ? sources.shiphero.data : null;
    if (!inventory) return null;
    const staleDate = inventoryStaleDate(inventory);
    return {
      inventory,
      staleDate,
      /** The Kairo ShipHero connection asks to reconnect (its snapshot still shows). */
      reconnect: sources?.shiphero.connection === "reconnect",
      decision: buildInventoryDecision({
        products: model.products.map((p) => ({
          key: p.key,
          sku: p.sku,
          name: p.name,
          recentUnits: p.recentUnits,
        })),
        stock: inventory.stock,
        previous: inventory.previous?.stock ?? null,
        columns: inventory.columns ?? null,
        source: inventory.origin === "csv" ? "csv" : "shiphero",
        plans: settings?.plans ?? [],
        actionRows,
        campaignMembers,
        families: data.productFamilies ?? [],
        variantUnits7d: insights?.variantAware ? insights.variantUnits7d : null,
        waiting: insights?.waiting ?? null,
        staleDate,
      }),
    };
  }, [
    data.productFamilies,
    model.products,
    sources,
    settings?.plans,
    actionRows,
    campaignMembers,
    insights,
  ]);
}

function hasAlert(row: PresentationRow) {
  return (
    (row.activeAds.length > 0 && (row.available ?? 1) <= 0) ||
    (row.backorder ?? 0) > 0 ||
    (row.waitingProxy ?? 0) >= t.waitingProxyMinOrders ||
    row.coverage.tone === "red" ||
    row.coverage.tone === "yellow"
  );
}

function SizeColorMatrix({ group }: { group: SizeColorGroup }) {
  // A SKU without color (or size) in a group that has them gets its own row (column).
  const colors: Array<string | null> = [
    ...group.colors,
    ...(group.cells.some((c) => !c.color) ? [null] : []),
  ];
  const sizes: Array<string | null> = [
    ...group.sizes,
    ...(group.cells.some((c) => !c.size) ? [null] : []),
  ];
  const cell = (color: string | null, size: string | null) =>
    group.cells.filter(
      (c) => (c.color ?? null) === color && (c.size ?? null) === size,
    );
  return (
    <div className={r.matrixGroup}>
      <h4>
        {group.name}{" "}
        <small>
          {count(group.total)} disponibles en {count(group.cells.length)} SKU
        </small>
      </h4>
      <div
        className={r.tableWrap}
        tabIndex={0}
        role="region"
        aria-label={`Stock por talla y color: ${group.name}`}
      >
        <table className={r.matrix}>
          <thead>
            <tr>
              <th>Color</th>
              {sizes.map((size) => (
                <th key={size ?? "none"}>{size ?? "Sin talla"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => (
              <tr key={color ?? "none"}>
                <th scope="row">{color ?? "Sin color"}</th>
                {sizes.map((size) => {
                  const cells = cell(color, size);
                  if (!cells.length)
                    return (
                      <td key={size ?? "none"} className={r.matrixEmpty}>
                        —
                      </td>
                    );
                  const available = cells.every((c) => c.available == null)
                    ? null
                    : cells.reduce((n, c) => n + (c.available ?? 0), 0);
                  const daily = cells.reduce(
                    (n, c) => n + (c.dailyUnits ?? 0),
                    0,
                  );
                  const backorder = cells.reduce(
                    (n, c) => n + (c.backorder ?? 0),
                    0,
                  );
                  return (
                    <td
                      key={size ?? "none"}
                      className={
                        available != null && available <= 0 && daily > 0
                          ? r.risk
                          : undefined
                      }
                    >
                      {number(available)}
                      <small>
                        {decimalText(daily)}/día
                        {backorder > 0
                          ? ` · ${count(backorder)} esperando`
                          : ""}
                      </small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** "Inventario para decidir" (módulo 5), section 01 of Análisis. */
export function InventoryDecision({
  decision,
  sources,
  sourcesLoading,
  actionsLoading,
  insights,
}: {
  decision: ReturnType<typeof useInventoryDecision>;
  sources: MarketingSources | null;
  sourcesLoading: boolean;
  actionsLoading: boolean;
  insights: Resource<ProductInsightsPayload>;
}) {
  const [onlyAlerts, setOnlyAlerts] = useState(true);
  const [all, setAll] = useState(false);
  const result = decision?.decision ?? null;
  const rows = result
    ? onlyAlerts
      ? result.rows.filter(hasAlert)
      : result.rows
    : [];
  const visible = all ? rows : rows.slice(0, PAGE);
  const columns = decision?.inventory.columns;
  const proxy = result
    ? result.rows
        .filter((row) => (row.waitingProxy ?? 0) > 0)
        .sort((a, b) => (b.waitingProxy ?? 0) - (a.waitingProxy ?? 0))
    : [];
  return (
    <section
      id="analisis-inventario"
      className={r.section}
      aria-labelledby="inventory-decision-title"
    >
      <div className={r.sectionHead}>
        <div>
          <h2 id="inventory-decision-title">Inventario para decidir</h2>
          <p>
            Cada presentación por separado: disponible, pedidos esperando,
            unidades en camino, venta diaria y días de cobertura. Rojo: menos de{" "}
            {t.stockRedDays} días. Amarillo: menos de {t.stockYellowDays}.
          </p>
        </div>
      </div>
      {sourcesLoading && !decision ? (
        <p role="status">Consultando el inventario…</p>
      ) : !decision || !result ? (
        <p className={r.alert}>
          {sources?.shiphero.status === "error"
            ? "No se pudo consultar el inventario."
            : "Sube el product_table para ver el inventario (en el Reporte, sección Inventario)."}
        </p>
      ) : (
        <>
          <p className={r.caption}>
            {decision.inventory.origin === "csv" &&
            decision.inventory.snapshotDate
              ? `Archivo product_table del ${shortDate(decision.inventory.snapshotDate)}`
              : decision.inventory.snapshotDate
                ? `Inventario de ShipHero del ${shortDate(decision.inventory.snapshotDate)}`
                : "Inventario de ShipHero"}
            {decision.inventory.previous
              ? ` · reposición contra el ${shortDate(decision.inventory.previous.snapshotDate)}`
              : decision.inventory.origin === "csv"
                ? " · sin archivo anterior para comparar la reposición"
                : " · sin foto anterior para comparar la reposición"}
            {result.variantDemand
              ? " · venta diaria por talla y color (últimos 7 días completos)."
              : " · venta diaria por SKU (últimos 7 días, sin anulados)."}
          </p>
          {decision.reconnect && (
            <p role="alert" className={r.warnText}>
              ShipHero pide volver a conectar: el inventario no se actualiza.
              Revisa la conexión en Fuentes.
            </p>
          )}
          {decision.staleDate && (
            <p role="alert" className={r.warnText}>
              {staleInventoryText(
                decision.inventory.origin === "csv" ? "csv" : "shiphero",
                shortDate(decision.staleDate),
              )}
            </p>
          )}
          <InventoryAlerts
            alerts={result.alerts.filter((a) => a.code !== "inventario_viejo")}
            empty={
              actionsLoading
                ? "Consultando campañas activas…"
                : "Sin anuncios activos sin stock, pedidos esperando ni reposiciones nuevas."
            }
          />
          <div className={r.filters}>
            <label className={r.check}>
              <input
                type="checkbox"
                checked={onlyAlerts}
                onChange={(e) => {
                  setOnlyAlerts(e.target.checked);
                  setAll(false);
                }}
              />
              Solo con alerta ({count(result.rows.filter(hasAlert).length)} de{" "}
              {count(result.rows.length)})
            </label>
          </div>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Inventario por presentación"
          >
            <table className={r.inventoryTable}>
              <thead>
                <tr>
                  <th>Presentación</th>
                  <th>Disponible</th>
                  <th>Esperando</th>
                  <th>En camino</th>
                  <th>Venta diaria</th>
                  <th>Días</th>
                  <th>Reposición</th>
                  <th>Anuncio activo</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      {row.name}
                      <small>
                        {row.sku || "Sin SKU"}
                        {!row.cataloged ? " · sin ventas en el catálogo" : ""}
                      </small>
                    </th>
                    <td>{number(row.available)}</td>
                    <td
                      className={(row.backorder ?? 0) > 0 ? r.risk : undefined}
                    >
                      {columns?.backorder ? number(row.backorder) : "—"}
                      {!columns?.backorder && (row.waitingProxy ?? 0) > 0 && (
                        <small>
                          {count(row.waitingProxy!)} sin guía (iComfly)
                        </small>
                      )}
                    </td>
                    <td>
                      {number(row.incoming)}
                      {row.incomingSource === "plan" && <small>a mano</small>}
                    </td>
                    <td>{decimalText(row.dailyUnits)}</td>
                    <td>
                      <span
                        className={`${r.chip} ${coverageChipClass(row.coverage)}`}
                      >
                        {row.coverage.label}
                      </span>
                    </td>
                    <td>
                      {row.restocked == null
                        ? "—"
                        : row.restocked > 0
                          ? `+${count(row.restocked)}`
                          : "0"}
                    </td>
                    <td>
                      {row.activeAds.length
                        ? `Sí · ${Array.from(new Set(row.activeAds.map((a) => a.accountLabel))).join(", ")}`
                        : actionsLoading
                          ? "…"
                          : "No"}
                    </td>
                  </tr>
                ))}
                {!visible.length && (
                  <tr>
                    <td colSpan={8}>
                      {onlyAlerts
                        ? "Sin presentaciones con alerta."
                        : "Sin presentaciones con stock o ventas."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > PAGE && (
            <button
              type="button"
              className="mt-2"
              onClick={() => setAll(!all)}
              aria-expanded={all}
            >
              {all ? "Ver menos" : `Ver todas (${count(rows.length)})`}
            </button>
          )}
          {insights.loading && (
            <p role="status" className={r.caption}>
              Consultando la venta por talla y color en iComfly…
            </p>
          )}
          {result.notes
            .filter(
              (note) => !insights.loading || note !== VARIANT_DEMAND_MISSING,
            )
            .map((note) => (
              <p key={note} className={r.caption}>
                {note}
              </p>
            ))}

          <h3 className="mt-6">Stock por talla y color</h3>
          <p className={r.caption}>
            El total engaña: mira cada talla y color. Cada celda: disponible y
            venta diaria.
          </p>
          {result.sizeColor.length ? (
            result.sizeColor.map((group) => (
              <SizeColorMatrix key={group.base} group={group} />
            ))
          ) : (
            <p className={r.alert}>
              El archivo no separa talla ni color en los SKU.
            </p>
          )}

          {!columns?.backorder && (
            <>
              <h3 className="mt-6">Confirmados sin guía (iComfly)</h3>
              <p className={r.caption}>
                Sin la columna Backorder, la mejor señal de pedidos esperando:
                confirmados hace más de {count(t.waitingMinHours)} h sin guía y
                los de Producto Agotado. Puede ser stock, almacén o retraso.
              </p>
              {insights.loading ? (
                <p role="status">Consultando pedidos de iComfly…</p>
              ) : !insights.data ? (
                <p role="alert" className={r.risk}>
                  {insights.error ||
                    "No se pudieron leer los pedidos de iComfly."}
                </p>
              ) : proxy.length ? (
                <ul className={r.alertList}>
                  {proxy.slice(0, 10).map((row) => (
                    <li key={row.key} className={r.alert}>
                      <strong>
                        {row.name}: {count(row.waitingProxy!)}
                      </strong>
                      {row.sku || "Sin SKU"} · disponible{" "}
                      {number(row.available)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={r.alert}>
                  Sin pedidos confirmados esperando guía.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
