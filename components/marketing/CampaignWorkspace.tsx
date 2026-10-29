"use client";
import { useMemo, useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { count, money } from "./format";
import s from "./dashboard.module.css";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
export function CampaignWorkspace({
  model,
  catalog,
  ready,
  loading,
  saving,
  save,
  saved,
}: {
  model: MarketingIntelligence;
  catalog: MarketingSummary["catalog"];
  ready: boolean;
  loading: boolean;
  saving: string;
  save: Save;
  saved: string;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("");
  const [sort, setSort] = useState<
    "spend" | "dailyBudget" | "platformCpa" | "name"
  >("spend");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [failedKey, setFailedKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
              : (a[sort] ?? -1) - (b[sort] ?? -1);
          return ascending ? order : -order;
        }),
    [model.campaigns, account, query, sort, ascending],
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
            Un producto por campaña. El presupuesto es el diario actual, incluso
            si consultas otro período.
          </p>
        </div>
        <span className={s.badge}>
          {count(model.assignedCampaigns)} asignadas /{" "}
          {count(model.campaigns.length)}
        </span>
      </div>
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
                    const selected =
                      drafts[campaign.key] ??
                      campaign.mapping?.product_key ??
                      "";
                    const changed =
                      selected !== (campaign.mapping?.product_key ?? "");
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
                        <td className="w-[250px]">
                          <label className={s.field}>
                            <span className="sr-only">
                              Producto de {campaign.name}
                            </span>
                            <select
                              aria-label={`Producto de ${campaign.name}`}
                              className={`${s.control} w-full`}
                              disabled={!ready || Boolean(saving)}
                              value={selected}
                              onChange={(event) =>
                                setDrafts((old) => ({
                                  ...old,
                                  [campaign.key]: event.target.value,
                                }))
                              }
                            >
                              <option value="">
                                {ready
                                  ? "Sin asignar"
                                  : "Asignaciones no disponibles"}
                              </option>
                              {campaign.mapping &&
                                !catalog.some(
                                  (product) =>
                                    product.key ===
                                    campaign.mapping!.product_key,
                                ) && (
                                  <option value={campaign.mapping.product_key}>
                                    {campaign.mapping.product_name} (guardado)
                                  </option>
                                )}
                              {catalog.map((product) => (
                                <option key={product.key} value={product.key}>
                                  {product.name}
                                  {product.sku ? ` · ${product.sku}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          {changed && (
                            <div className="mt-2 flex gap-2">
                              <button
                                className={`${s.button} ${s.primary}`}
                                disabled={Boolean(saving)}
                                onClick={async () => {
                                  const ok = await save(campaign.key, {
                                    kind: "mapping",
                                    platform: campaign.platform,
                                    account_id: campaign.accountId,
                                    campaign_id: campaign.id,
                                    product_key: selected || null,
                                  });
                                  setFailedKey(ok ? "" : campaign.key);
                                  if (ok)
                                    setDrafts((old) => {
                                      const next = { ...old };
                                      delete next[campaign.key];
                                      return next;
                                    });
                                }}
                              >
                                {saving === campaign.key
                                  ? "Guardando…"
                                  : "Guardar"}
                              </button>
                              <button
                                className={s.button}
                                disabled={Boolean(saving)}
                                onClick={() =>
                                  setDrafts((old) => {
                                    const next = { ...old };
                                    delete next[campaign.key];
                                    return next;
                                  })
                                }
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                          {changed && failedKey === campaign.key && (
                            <p
                              role="alert"
                              className={`${s.warn} mt-2 text-xs`}
                            >
                              No se pudo guardar. Revisa la conexión e inténtalo
                              de nuevo.
                            </p>
                          )}
                          {!changed && saved === campaign.key && (
                            <span
                              role="status"
                              className={`${s.good} mt-2 block text-[11px]`}
                            >
                              Asignación guardada
                            </span>
                          )}
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
