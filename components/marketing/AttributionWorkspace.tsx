"use client";
import { useMemo, useState } from "react";
import { useResource } from "./useMarketing";
import { periodQuery, type MarketingPeriod } from "@/lib/marketing-dates";
import type { MarketingAttribution } from "@/lib/marketing-attribution";
import {
  buildAttributionCostRows,
  type AttributionLevel,
} from "@/lib/marketing-attribution-cost";
import type { CharlieReport } from "@/lib/marketing-charlie-types";
import { useUsdMoney } from "./UsdContext";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { count, percentage } from "./format";
import s from "./dashboard.module.css";

export default function AttributionWorkspace({
  period,
  revision,
  campaigns,
  campaignsLoading = false,
}: {
  period: MarketingPeriod;
  revision: number;
  campaigns: MarketingIntelligence["campaigns"];
  campaignsLoading?: boolean;
}) {
  const resource = useResource<MarketingAttribution>(
    `/api/marketing/attribution?${periodQuery(period)}`,
    revision,
  );
  const [level, setLevel] = useState<AttributionLevel>("campaign");
  const [sort, setSort] = useState<
    "orders" | "deliveryRate" | "costPerDelivered"
  >("orders");
  const money = useUsdMoney();
  const report = useResource<CharlieReport>(
    level === "campaign"
      ? null
      : `/api/marketing/charlie?${periodQuery(period)}&scope=ads`,
    revision,
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const groups = useMemo(() => {
    return buildAttributionCostRows(
      resource.data?.groups ?? [],
      level,
      campaigns,
      report.data,
      period,
    )
      .filter((g) =>
        `${g.platform} ${g.campaignName} ${g.matchedCampaignName} ${g.adsetName} ${g.adName} ${g.campaignId} ${g.adsetId} ${g.adId}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
      .sort((a, b) => {
        const av = a[sort],
          bv = b[sort];
        if (av == null) return bv == null ? b.orders - a.orders : 1;
        if (bv == null) return -1;
        return (
          (sort === "costPerDelivered" ? av - bv : bv - av) ||
          b.orders - a.orders
        );
      });
  }, [resource.data, level, query, campaigns, report.data, period, sort]);
  const pages = Math.max(1, Math.ceil(groups.length / 15)),
    current = Math.min(page, pages - 1);
  return (
    <section className={s.section} aria-labelledby="utm-heading">
      <div className={s.sectionHead}>
        <div>
          <h2 id="utm-heading" className={s.heading}>
            Pedidos por origen UTM
          </h2>
          <p className={s.muted}>
            Pedidos creados en el período. Cruce por ID de campaña, conjunto y
            anuncio; entrega sobre entregados + no entregados, excluyendo los
            que siguen en ruta y los anulados. Costo por entregado = inversión
            registrada del período / entregados con UTM.
          </p>
        </div>
      </div>
      {resource.loading ? (
        <p role="status" className={s.muted}>
          Cruzando los UTM de los pedidos…
        </p>
      ) : resource.error ? (
        <p role="alert" className={s.notice}>
          {resource.error}
        </p>
      ) : (
        resource.data && (
          <>
            <p className={`${s.muted} mb-4`}>
              {count(resource.data.withUtm)} de{" "}
              {count(resource.data.totalOrders)} pedidos con datos de origen ·{" "}
              {count(resource.data.linkedCampaign)} con ID de campaña utilizable
              · {count(resource.data.withoutUtm)} sin origen registrado. Sin UTM
              no significa orgánico.
            </p>
            {(resource.data.conflicts > 0 || resource.data.ambiguous > 0) && (
              <p className={s.notice}>
                {count(resource.data.conflicts + resource.data.ambiguous)}{" "}
                pedidos con datos contradictorios o ambiguos quedaron fuera del
                cruce.
              </p>
            )}
            <div className={`${s.toolbar} mb-4`}>
              <label className={s.field}>
                Agrupar por
                <select
                  className={s.control}
                  value={level}
                  onChange={(e) => {
                    setLevel(e.target.value as typeof level);
                    setPage(0);
                  }}
                >
                  <option value="campaign">Campaña</option>
                  <option value="adset">Conjunto</option>
                  <option value="ad">Anuncio</option>
                </select>
              </label>
              <label className={s.field}>
                Ordenar por
                <select
                  className={s.control}
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as typeof sort);
                    setPage(0);
                  }}
                >
                  <option value="orders">Más pedidos</option>
                  <option value="deliveryRate">Mejor tasa de entrega</option>
                  <option value="costPerDelivered">
                    Menor costo por entregado
                  </option>
                </select>
              </label>
              <label className={s.field}>
                Buscar nombre o ID
                <input
                  className={s.control}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Nombre de campaña, conjunto o anuncio"
                />
              </label>
            </div>
            {level !== "campaign" && report.loading && (
              <p role="status" className={`${s.muted} mb-3`}>
                Consultando gasto por anuncio…
              </p>
            )}
            {level !== "campaign" &&
              (report.error ||
                report.data?.status === "error" ||
                report.data?.status === "pending") && (
                <p role="status" className={`${s.notice} mb-3`}>
                  El gasto por anuncio no está disponible. Los resultados de
                  entrega se conservan.
                </p>
              )}
            <div className={s.tableWrap}>
              <table className={`${s.table} min-w-[1200px]`}>
                <caption className="sr-only">
                  Pedidos únicos agrupados por UTM, resultados actuales y
                  efectividad de operaciones cerradas
                </caption>
                <thead>
                  <tr>
                    <th>
                      Origen /{" "}
                      {level === "campaign"
                        ? "campaña"
                        : level === "adset"
                          ? "conjunto"
                          : "anuncio"}
                    </th>
                    <th>Cruce con publicidad</th>
                    {[
                      "Pedidos",
                      "Entregados",
                      "No entregados",
                      "Pendientes",
                      "Anulados",
                      "Cerrados",
                      "Tasa de entrega (cerrados)",
                      "Inversión (USD)",
                      "Costo por entregado (USD)",
                    ].map((label) => (
                      <th className={s.numeric} key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(current * 15, (current + 1) * 15).map((g) => {
                    const label =
                      level === "campaign"
                        ? g.matchedCampaignName || g.campaignName
                        : level === "adset"
                          ? g.adsetName
                          : g.adName;
                    const id =
                      level === "campaign"
                        ? g.campaignId
                        : level === "adset"
                          ? g.adsetId
                          : g.adId;
                    return (
                      <tr
                        key={JSON.stringify([
                          g.platform,
                          g.campaignId,
                          g.adsetId,
                          g.adId,
                        ])}
                      >
                        <th scope="row">
                          <span>{label || "Sin nombre UTM"}</span>
                          <small className="block font-normal text-muted-foreground">
                            {g.platform} · {id || "Sin ID para este nivel"}
                          </small>
                          {level !== "campaign" && (
                            <small className="block font-normal text-muted-foreground">
                              {g.campaignName} · {g.campaignId}
                            </small>
                          )}
                        </th>
                        <td>
                          {g.accountName ||
                            (campaignsLoading
                              ? "Consultando…"
                              : "Sin coincidencia en las campañas consultadas")}
                        </td>
                        {[
                          g.orders,
                          g.delivered,
                          g.failed,
                          g.open,
                          g.annulled,
                          g.closed,
                        ].map((v, i) => (
                          <td key={i} className={s.numeric}>
                            {count(v)}
                          </td>
                        ))}
                        <td className={s.numeric}>
                          {percentage(
                            g.delivered + g.failed
                              ? g.delivered / (g.delivered + g.failed)
                              : null,
                          )}
                        </td>
                        <td className={s.numeric}>
                          {(
                            level === "campaign"
                              ? campaignsLoading
                              : report.loading
                          )
                            ? "Consultando…"
                            : g.spend == null
                              ? g.spendMessage
                              : money(g.spend, g.currency)}
                        </td>
                        <td className={s.numeric} title={g.spendMessage}>
                          {(
                            level === "campaign"
                              ? campaignsLoading
                              : report.loading
                          )
                            ? "Consultando…"
                            : g.costPerDelivered == null
                              ? g.spendMessage
                              : money(g.costPerDelivered, g.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!groups.length && (
                <p className={s.empty}>
                  No hay pedidos vinculados ni inversión disponible para este
                  período o búsqueda.
                </p>
              )}
            </div>
            {pages > 1 && (
              <div className={`${s.toolbar} mt-3`}>
                <button
                  className={s.button}
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                >
                  Anterior
                </button>
                <span className={s.muted}>
                  {current + 1} / {pages}
                </span>
                <button
                  className={s.button}
                  disabled={current >= pages - 1}
                  onClick={() => setPage(current + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
            <p className={`${s.muted} mt-3`}>
              Origen registrado por iComfly. No equivale a las conversiones
              atribuidas por Meta o TikTok. Los ID completos se conservan como
              texto. Se incluyen campañas y anuncios con inversión aunque no
              tengan pedidos UTM vinculados. Con pendientes o pedidos sin UTM,
              el costo es provisional. TikTok utiliza el gasto por anuncio
              importado; los días o anuncios no registrados no se estiman.
            </p>
          </>
        )
      )}
    </section>
  );
}
