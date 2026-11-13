"use client";
import { useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { ProductInsightsPayload } from "@/lib/marketing-insights-types";
import { assignedCampaigns, campaignSpendRows } from "@/lib/marketing-real-cpa";
import {
  buildUnadvertised,
  type UnadvertisedRow,
} from "@/lib/marketing-unadvertised";
import { inventoryStaleDate } from "@/lib/marketing-inventory-decide";
import { decimalText } from "@/lib/marketing-copy";
import { marketingDate, shiftDate } from "@/lib/marketing-dates";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, money, shortDate } from "./format";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
const t = MARKETING_TARGETS;
const PAGE = 15;
/** Days of daily spend loaded by the actions sources (today−13..today). */
const SPEND_DAYS = 14;

/** Eight weekly bars, oldest → newest, with the numbers for screen readers. */
function WeeklyBars({ weekly }: { weekly: number[] }) {
  if (!weekly.length) return <span>—</span>;
  const max = Math.max(1, ...weekly);
  return (
    <span
      className={r.spark}
      role="img"
      aria-label={`Unidades por semana, de la más vieja a la última: ${weekly
        .map((n) => count(Math.round(n)))
        .join(", ")}`}
    >
      {weekly.map((n, i) => (
        <span
          key={i}
          style={{ height: `${Math.max(4, (n / max) * 100)}%` }}
          className={i === weekly.length - 1 ? r.sparkLast : undefined}
        />
      ))}
    </span>
  );
}

const productCell = (row: UnadvertisedRow) => (
  <th scope="row">
    {row.name}
    <small>
      {row.sku}
      {!row.cataloged ? " · sin ventas en el catálogo" : ""}
    </small>
  </th>
);

/** "Stock disponible sin publicidad" (módulo 6), section 02 of Análisis. */
export function UnadvertisedStock({
  data,
  model,
  sources,
  settings,
  fx,
  actions,
  insights,
}: {
  data: MarketingSummary;
  model: MarketingIntelligence;
  sources: Resource<MarketingSources>;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  actions: Resource<MarketingSources>;
  insights: Resource<ProductInsightsPayload>;
}) {
  const [allNoAds, setAllNoAds] = useState(false);
  const inventory =
    sources.data?.shiphero.status === "ready"
      ? sources.data.shiphero.data
      : null;
  const result = useMemo(() => {
    if (!inventory || !actions.data) return null;
    const today = marketingDate();
    const campaigns = assignedCampaigns(data, actions.data, settings);
    const dates = Array.from({ length: SPEND_DAYS }, (_, i) =>
      shiftDate(today, i - (SPEND_DAYS - 1)),
    );
    return buildUnadvertised({
      catalog: model.products.map((p) => ({
        key: p.key,
        sku: p.sku,
        name: p.name,
        recentUnits: p.recentUnits,
      })),
      stock: inventory.stock,
      campaigns,
      spend: campaignSpendRows(campaigns, dates, fx),
      weekly: insights.data
        ? { blocks: insights.data.blocks, units: insights.data.units }
        : null,
      today,
    });
  }, [
    inventory,
    actions.data,
    data,
    settings,
    fx,
    model.products,
    insights.data,
  ]);

  const staleDate = inventory ? inventoryStaleDate(inventory) : null;
  const missingPlatforms = (["meta", "tiktok"] as const).filter(
    (p) => actions.data && actions.data[p].status !== "ready",
  );
  const noAds = result
    ? allNoAds
      ? result.noAds
      : result.noAds.slice(0, PAGE)
    : [];

  return (
    <section
      id="analisis-sin-publicidad"
      className={r.section}
      aria-labelledby="unadvertised-title"
    >
      <div className={r.sectionHead}>
        <div>
          <h2 id="unadvertised-title">Stock disponible sin publicidad</h2>
          <p>
            Dónde poner el gasto que falta para llegar a{" "}
            {money(t.dailySpendUsd)} por día: productos con stock y sin
            anuncios, y productos que vendían antes y ahora no.
          </p>
        </div>
      </div>
      {sources.loading && !inventory ? (
        <p role="status">Consultando el inventario…</p>
      ) : !inventory ? (
        <p className={r.alert}>
          {sources.data?.shiphero.status === "error"
            ? "No se pudo consultar el inventario."
            : "Sube el product_table para ver el stock (en el Reporte, sección Inventario)."}
        </p>
      ) : actions.loading && !actions.data ? (
        <p role="status">Consultando el gasto de las campañas…</p>
      ) : !result ? (
        <p role="alert" className={r.risk}>
          {actions.error || "No se pudo consultar el gasto de Meta y TikTok."}
        </p>
      ) : (
        <>
          {staleDate && (
            <p role="alert" className={r.warnText}>
              {inventory.origin === "csv"
                ? `El inventario es del ${shortDate(staleDate)}. Sube el archivo de hoy: el stock puede haber cambiado.`
                : `El inventario de ShipHero es del ${shortDate(staleDate)}: el stock puede haber cambiado. Revisa la conexión en Fuentes.`}
            </p>
          )}
          {missingPlatforms.length > 0 && (
            <p role="alert" className={r.warnText}>
              Sin datos de{" "}
              {missingPlatforms
                .map((p) => (p === "meta" ? "Meta" : "TikTok"))
                .join(" ni ")}
              : un producto que solo se anuncia ahí puede aparecer como sin
              anuncios.
            </p>
          )}
          <h3>Con stock y sin anuncios ({count(t.unadvertisedDays)} días)</h3>
          <p className={r.caption}>
            Más de {count(t.unadvertisedMinUnits)} unidades disponibles y nada
            de gasto desde el {shortDate(result.spendFrom)} (ni hoy). Si un
            producto tiene una campaña sin asignar, aparece aquí: asígnala en
            «Asignar productos».
          </p>
          <div
            className={r.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Productos con stock y sin anuncios"
          >
            <table className={r.unadvertisedTable}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Disponible</th>
                  <th>Venta diaria</th>
                  <th>Último gasto</th>
                </tr>
              </thead>
              <tbody>
                {noAds.map((row) => (
                  <tr key={row.key}>
                    {productCell(row)}
                    <td>{count(row.available)}</td>
                    <td>{decimalText(row.dailyUnits)}</td>
                    <td>
                      {row.lastSpendDate
                        ? shortDate(row.lastSpendDate)
                        : `Sin gasto en ${count(SPEND_DAYS)} días`}
                      {row.campaigns === 0 && (
                        <small>Sin campaña asignada</small>
                      )}
                      {row.spendUnknownFrom && (
                        <small>
                          Gasto sin dato del {shortDate(row.spendUnknownFrom)}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
                {!noAds.length && (
                  <tr>
                    <td colSpan={4}>
                      Sin productos con más de {count(t.unadvertisedMinUnits)}{" "}
                      unidades y sin anuncios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {result.noAds.length > PAGE && (
            <button
              type="button"
              className="mt-2"
              onClick={() => setAllNoAds(!allNoAds)}
              aria-expanded={allNoAds}
            >
              {allNoAds
                ? "Ver menos"
                : `Ver todos (${count(result.noAds.length)})`}
            </button>
          )}

          <h3 className="mt-6">Vendían antes y ahora tienen stock</h3>
          <p className={r.caption}>
            Antes = mejor promedio de 2 semanas seguidas entre hace 3 y hace 8
            semanas (mínimo {count(t.soldBeforeMinWeekly)} por semana). Ahora =
            últimos 7 días completos, la mitad o menos. Con stock para al menos
            una semana al ritmo de antes. Unidades reales, sin anulados. Una
            talla o color solo aparece si su producto completo también bajó
            (iComfly no siempre separa la variante).
          </p>
          {insights.loading && !insights.data ? (
            <p role="status">Consultando ventas de las últimas 8 semanas…</p>
          ) : !insights.data ? (
            <p role="alert" className={r.risk}>
              {insights.error ||
                "No se pudieron leer las ventas por semana de iComfly."}
            </p>
          ) : (
            <div
              className={r.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Productos que vendían antes y ahora tienen stock"
            >
              <table className={r.unadvertisedTable}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Antes (por semana)</th>
                    <th>Ahora</th>
                    <th>8 semanas</th>
                    <th>Stock</th>
                    <th>Gasto 7 días</th>
                  </tr>
                </thead>
                <tbody>
                  {result.soldBefore.map((row) => (
                    <tr key={row.key}>
                      {productCell(row)}
                      <td>{decimalText(row.beforeWeekly ?? 0)}</td>
                      <td className={r.risk}>{decimalText(row.nowWeekly)}</td>
                      <td>
                        <WeeklyBars weekly={row.weekly} />
                      </td>
                      <td>
                        {count(row.available)}
                        {row.weeksOfStockAtBefore != null && (
                          <small>
                            {decimalText(row.weeksOfStockAtBefore)} semanas al
                            ritmo de antes
                          </small>
                        )}
                      </td>
                      <td>
                        {row.spend7dUsd > 0
                          ? money(row.spend7dUsd)
                          : "Sin gasto"}
                      </td>
                    </tr>
                  ))}
                  {!result.soldBefore.length && (
                    <tr>
                      <td colSpan={6}>
                        Ningún producto bajó a la mitad teniendo stock.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {result.notes
            // The weekly-data note is already the state of the second table.
            .filter((note) => !note.includes("8 semanas"))
            .map((note) => (
              <p key={note} className={r.caption}>
                {note}
              </p>
            ))}
        </>
      )}
    </section>
  );
}
