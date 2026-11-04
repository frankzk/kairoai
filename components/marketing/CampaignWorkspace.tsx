"use client";
import { useMemo, useState } from "react";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import { asUsd } from "@/lib/marketing-usd-rate";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { count, money } from "./format";
import s from "./dashboard.module.css";
import { CampaignAssignment } from "./TeamReportCampaigns";
import { useUsdMoney } from "./UsdContext";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
export function CampaignWorkspace({
  model,
  catalog,
  families,
  ready,
  loading,
  saving,
  save,
  saved,
  fx,
}: {
  model: MarketingIntelligence;
  catalog: MarketingSummary["catalog"];
  families?: import("@/lib/marketing-product-families").MarketingFamily[];
  ready: boolean;
  loading: boolean;
  saving: string;
  save: Save;
  saved: string;
  fx?: UsdRate | null;
}) {
  const money = useUsdMoney();
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("");
  const [sort, setSort] = useState<
    "spend" | "dailyBudget" | "platformCpa" | "name"
  >("spend");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [withSpendOnly, setWithSpendOnly] = useState(true);
  const accounts = useMemo(
    () =>
      Array.from(
        new Map(
          model.campaigns.map((campaign) => [
            `${campaign.platform}:${campaign.accountId}`,
            `${campaign.platform === "meta" ? "Meta" : "TikTok"} · ${campaign.accountName}`,
          ]),
        ),
      ),
    [model.campaigns],
  );
  const filtered = useMemo(
    () =>
      model.campaigns
        .filter(
          (campaign) =>
            (!withSpendOnly || campaign.spend > 0) &&
            (!unassignedOnly || !campaign.mapping) &&
            (!account ||
              `${campaign.platform}:${campaign.accountId}` === account) &&
            `${campaign.name} ${campaign.mapping?.product_name || ""}`
              .toLocaleLowerCase("es")
              .includes(query.trim().toLocaleLowerCase("es")),
        )
        .sort((a, b) => {
          const order =
            sort === "name"
              ? a.name.localeCompare(b.name)
              : (asUsd(a[sort], a.currency, fx ?? null) ?? -1) -
                (asUsd(b[sort], b.currency, fx ?? null) ?? -1);
          return ascending ? order : -order;
        }),
    [
      model.campaigns,
      account,
      query,
      sort,
      ascending,
      unassignedOnly,
      withSpendOnly,
      fx,
    ],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pages - 1);
  function sortBy(value: typeof sort) {
    setSort(value);
    setAscending(sort === value ? !ascending : value === "name");
    setPage(0);
  }
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 className={s.heading}>Campañas y producto anunciado</h2>
          <p className={s.muted}>
            Un producto por campaña, con todas sus variantes o una selección. El
            presupuesto es el diario actual, incluso si consultas otro período.
          </p>
        </div>
        <span className={s.badge}>
          {count(model.assignedCampaigns)} asignadas /{" "}
          {count(model.campaigns.length)}
        </span>
      </div>
      <div className={s.callout}>
        <p className={s.muted}>
          Las coincidencias exactas y únicas se aplican automáticamente al
          reporte. Puedes fijarlas o cambiarlas. Para las demás: elige el
          producto completo, incluye todas sus variantes o selecciona algunos
          SKU y guarda. Una sugerencia no se asigna sola.
        </p>
        <span className={s.badge}>
          {model.automaticCampaigns} automáticas · {model.unmapped.length}{" "}
          campañas con gasto sin producto
        </span>
      </div>
      {saved && (
        <p role="status" className={`${s.notice} ${s.good}`}>
          Asignación guardada. El reporte ya usa ese producto; desmarca «Solo
          sin producto» para revisarla.
        </p>
      )}
      <div className={`${s.toolbar} mb-4`}>
        <label className={s.field}>
          Buscar campaña o producto
          <input
            className={s.control}
            placeholder="Nombre de campaña o producto"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className={s.field}>
          Cuenta publicitaria
          <select
            className={s.control}
            value={account}
            onChange={(event) => {
              setAccount(event.target.value);
              setPage(0);
            }}
          >
            <option value="">Todas las cuentas</option>
            {accounts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={s.checkField}>
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => {
              setUnassignedOnly(e.target.checked);
              setPage(0);
            }}
          />
          Solo sin producto
        </label>
        <label className={s.checkField}>
          <input
            type="checkbox"
            checked={withSpendOnly}
            onChange={(e) => {
              setWithSpendOnly(e.target.checked);
              setPage(0);
            }}
          />
          Con gasto en el período
        </label>
        <span className={s.muted}>{count(filtered.length)} campañas</span>
      </div>
      {loading ? (
        <div
          className={s.skeleton}
          role="status"
          aria-label="Consultando campañas"
        />
      ) : !model.campaigns.length ? (
        <div className={s.empty}>
          No hay campañas consultables. Revisa las conexiones o selecciona otro
          período.
        </div>
      ) : (
        <>
          <div className={s.tableWrap}>
            <table className={`${s.table} min-w-[1030px]`}>
              <caption className="sr-only">
                Campañas de Meta y TikTok, presupuesto diario actual y
                asignación de producto
              </caption>
              <thead>
                <tr>
                  <th>
                    <button onClick={() => sortBy("name")}>
                      Campaña {sort === "name" ? (ascending ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                  <th>Producto anunciado</th>
                  <th className={s.numeric}>
                    <button onClick={() => sortBy("spend")}>
                      Inversión{" "}
                      {sort === "spend" ? (ascending ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                  <th className={s.numeric}>
                    <button onClick={() => sortBy("dailyBudget")}>
                      Presup. diario{" "}
                      {sort === "dailyBudget" ? (ascending ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                  <th className={s.numeric}>Clics</th>
                  <th className={s.numeric}>Compras plataforma</th>
                  <th className={s.numeric}>
                    <button onClick={() => sortBy("platformCpa")}>
                      CPA plataforma{" "}
                      {sort === "platformCpa" ? (ascending ? "↑" : "↓") : "↕"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .slice(currentPage * 15, (currentPage + 1) * 15)
                  .map((campaign) => {
                    const budgetNote =
                      campaign.budgetKind === "adsets"
                        ? "Suma de conjuntos activos"
                        : campaign.budgetKind === "campaign"
                          ? "En la campaña"
                          : campaign.budgetKind === "lifetime"
                            ? "Presupuesto total de duración"
                            : campaign.budgetKind === "mixed"
                              ? "Conjuntos con presupuesto total"
                              : "Consulta no disponible";
                    return (
                      <tr key={campaign.key}>
                        <td className="max-w-[260px]">
                          <span className="block font-medium leading-relaxed">
                            {campaign.name}
                          </span>
                          <span className={s.muted}>
                            {campaign.platform === "meta" ? "Meta" : "TikTok"} ·{" "}
                            {campaign.accountName}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {campaign.effectiveStatus === "ACTIVE"
                              ? "Activa"
                              : campaign.effectiveStatus === "PAUSED"
                                ? "Pausada"
                                : campaign.effectiveStatus ||
                                  "Estado no consultado"}
                          </span>
                        </td>
                        <td>
                          <CampaignAssignment
                            campaign={campaign}
                            catalog={catalog}
                            families={families}
                            ready={ready}
                            saving={saving}
                            saved={saved}
                            save={save}
                          />
                        </td>
                        <td className={s.numeric}>
                          {money(campaign.spend, campaign.currency)}
                        </td>
                        <td className={s.numeric}>
                          {money(campaign.dailyBudget, campaign.currency)}
                          <span className="mt-1 block whitespace-normal text-[10px] text-muted-foreground">
                            {budgetNote}
                          </span>
                        </td>
                        <td className={s.numeric}>{count(campaign.clicks)}</td>
                        <td className={s.numeric}>
                          {campaign.purchases == null
                            ? "Sin datos"
                            : count(campaign.purchases)}
                        </td>
                        <td
                          className={`${s.numeric} ${campaign.currency === "USD" && (campaign.platformCpa ?? 0) > 8.5 ? s.warn : ""}`}
                        >
                          {money(campaign.platformCpa, campaign.currency)}
                        </td>
                      </tr>
                    );
                  })}
                {!filtered.length && (
                  <tr>
                    <td colSpan={7}>
                      Todas las campañas de este filtro tienen producto.
                      Desmarca «Solo sin producto» para revisarlas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <div className={s.empty}>
              No hay campañas que coincidan con estos filtros.
            </div>
          )}
          <div className={`${s.toolbar} mt-4 justify-between`}>
            <span className={s.muted}>
              Página {currentPage + 1} de {pages}
            </span>
            <div className="flex gap-2">
              <button
                className={s.button}
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Anterior
              </button>
              <button
                className={s.button}
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}
      <p className={`${s.muted} mt-4`}>
        El CPA de plataforma usa sus compras reportadas, no pedidos únicos de
        Kairo. En Meta se consulta la ventana de 7 días tras clic y 1 día tras
        visualización. Las compras de distintas plataformas pueden solaparse. El
        presupuesto no se modifica desde este panel.
      </p>
      {model.campaigns.some((campaign) => campaign.budgetMessage) && (
        <p className={`${s.warn} mt-3 text-xs`}>
          Algunas cuentas no devolvieron presupuesto. Su inversión sigue
          disponible; pulsa Actualizar para volver a consultarlo.
        </p>
      )}
    </section>
  );
}

export function CampaignPriorityList({
  model,
}: {
  model: MarketingIntelligence;
}) {
  const money = useUsdMoney();
  const rows = model.campaigns.filter(
    (campaign) =>
      campaign.mapping &&
      model.products.some(
        (product) =>
          product.key === campaign.mapping!.product_key && product.priority,
      ),
  );
  return (
    <div>
      <h3 className={s.heading}>Campañas de productos prioritarios</h3>
      {!rows.length ? (
        <p className={`${s.muted} mt-3`}>
          Marca productos como prioritarios y asigna sus campañas para verlas
          aquí.
        </p>
      ) : (
        <ul className={`${s.list} mt-3`}>
          {rows.slice(0, 8).map((campaign) => (
            <li key={campaign.key} className={s.listItem}>
              <div className="flex justify-between gap-4">
                <span className={s.listTitle}>{campaign.name}</span>
                <span className="shrink-0 text-xs tabular-nums">
                  {money(campaign.spend, campaign.currency)}
                </span>
              </div>
              <p className={s.muted}>
                {campaign.mapping?.product_name} · {campaign.accountName}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
