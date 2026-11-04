"use client";
import { useMemo, useState } from "react";
import { useResource } from "./useMarketing";
import { periodQuery, type MarketingPeriod } from "@/lib/marketing-dates";
import type {
  MarketingAttribution,
  AttributionGroup,
} from "@/lib/marketing-attribution";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { count, percentage } from "./format";
import s from "./dashboard.module.css";

export default function AttributionWorkspace({
  period,
  revision,
  campaigns,
}: {
  period: MarketingPeriod;
  revision: number;
  campaigns: MarketingIntelligence["campaigns"];
}) {
  const resource = useResource<MarketingAttribution>(
    `/api/marketing/attribution?${periodQuery(period)}`,
    revision,
  );
  const [level, setLevel] = useState<"campaign" | "adset" | "ad">("campaign");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const groups = useMemo(() => {
    const map = new Map<string, AttributionGroup>();
    for (const group of resource.data?.groups ?? []) {
      const k = JSON.stringify([
        group.platform,
        group.campaignId,
        level !== "campaign" ? group.adsetId : null,
        level === "ad" ? group.adId : null,
      ]);
      const prev = map.get(k);
      if (!prev)
        map.set(k, {
          ...group,
          adsetId: level !== "campaign" ? group.adsetId : null,
          adId: level === "ad" ? group.adId : null,
        });
      else
        for (const field of [
          "orders",
          "delivered",
          "failed",
          "open",
          "annulled",
        ] as const)
          prev[field] += group[field];
    }
    return Array.from(map.values())
      .filter((g) =>
        `${g.platform} ${g.campaignName} ${g.adsetName} ${g.adName} ${g.campaignId} ${g.adsetId} ${g.adId}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
      .sort((a, b) => b.orders - a.orders);
  }, [resource.data, level, query]);
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
            que siguen en ruta.
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
            <div className={s.tableWrap}>
              <table className={`${s.table} min-w-[850px]`}>
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
                      "En curso",
                      "Anulados",
                      "Entrega cerrados",
                    ].map((label) => (
                      <th className={s.numeric} key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.slice(current * 15, (current + 1) * 15).map((g) => {
                    const matches = campaigns.filter(
                      (c) => c.platform === g.platform && c.id === g.campaignId,
                    );
                    const label =
                      level === "campaign"
                        ? g.campaignName
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
                          {matches.length === 1
                            ? matches[0].accountName
                            : matches.length > 1
                              ? "Cruce ambiguo"
                              : "Sin coincidencia en las campañas consultadas"}
                        </td>
                        {[
                          g.orders,
                          g.delivered,
                          g.failed,
                          g.open,
                          g.annulled,
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!groups.length && (
                <p className={s.empty}>
                  No hay pedidos con ID de campaña utilizable para este período
                  o búsqueda.
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
              texto.
            </p>
          </>
        )
      )}
    </section>
  );
}
