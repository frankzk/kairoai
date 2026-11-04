"use client";
import { useState } from "react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { asUsd } from "@/lib/marketing-usd-rate";
import { money } from "./format";
import r from "./team-report.module.css";
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
const usd = (value: number | null | undefined) =>
  value == null ? "Sin datos" : money(value, "USD");
export function CampaignGroups({
  sources,
  model,
  catalog,
  fx,
  ready,
  loading,
  saving,
  saved,
  save,
}: {
  sources: MarketingSources | null;
  model: MarketingIntelligence;
  catalog: MarketingSummary["catalog"];
  fx: UsdRate | null;
  ready: boolean;
  loading: boolean;
  saving: string;
  saved: string;
  save: Save;
}) {
  const groups = (["meta", "tiktok"] as const).flatMap(
    (platform) =>
      sources?.[platform].data?.accounts.map((a) => ({
        name: a.accountName || a.accountId,
        platform,
        id: a.accountId,
      })) ?? [],
  );
  return (
    <>
      {groups.map((g) => (
        <AccountTable
          key={`${g.platform}:${g.id}`}
          title={`${g.platform === "meta" ? "Meta Ads" : "TikTok Ads"} / ${g.name}`}
          rows={model.campaigns.filter(
            (c) => c.platform === g.platform && c.accountId === g.id,
          )}
          catalog={catalog}
          fx={fx}
          ready={ready}
          loading={loading}
          saving={saving}
          saved={saved}
          save={save}
        />
      ))}
    </>
  );
}
function AccountTable({
  title,
  rows,
  catalog,
  fx,
  ready,
  loading,
  saving,
  saved,
  save,
}: {
  title: string;
  rows: MarketingIntelligence["campaigns"];
  catalog: MarketingSummary["catalog"];
  fx: UsdRate | null;
  ready: boolean;
  loading: boolean;
  saving: string;
  saved: string;
  save: Save;
}) {
  const [sort, setSort] = useState<
      "name" | "platformCpa" | "dailyBudget" | "spend"
    >("spend"),
    [asc, setAsc] = useState(false),
    [page, setPage] = useState(0),
    [query, setQuery] = useState("");
  const filtered = rows
    .filter((c) =>
      c.name.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")),
    )
    .sort(
      (a, b) =>
        (asc ? 1 : -1) *
        (sort === "name"
          ? a.name.localeCompare(b.name)
          : (asUsd(a[sort], a.currency, fx) ?? -1) -
            (asUsd(b[sort], b.currency, fx) ?? -1)),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 10)),
    current = Math.min(page, pages - 1);
  function order(key: typeof sort) {
    setSort(key);
    setAsc(sort === key ? !asc : key === "name");
    setPage(0);
  }
  return (
    <div className={r.account}>
      <div className={r.sectionHead}>
        <h3>{title}</h3>
        <label className={r.field}>
          Filtrar campañas
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Nombre de campaña"
          />
        </label>
      </div>
      <div
        className={r.tableWrap}
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {(
                [
                  ["name", "Campaña"],
                  ["platformCpa", "CPA plataforma"],
                  ["dailyBudget", "Presupuesto diario"],
                  ["spend", "Monto gastado"],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  aria-sort={
                    sort === key ? (asc ? "ascending" : "descending") : "none"
                  }
                >
                  <button onClick={() => order(key)}>
                    {label} {sort === key ? (asc ? "↑" : "↓") : "↕"}
                  </button>
                </th>
              ))}
              <th>Producto anunciado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 10, current * 10 + 10).map((c) => (
              <tr key={c.key}>
                <th scope="row">
                  {c.name}
                  <small>{c.effectiveStatus || c.id}</small>
                </th>
                <td>
                  {usd(asUsd(c.platformCpa, c.currency, fx))}
                  {c.platform === "tiktok" && c.purchases == null && (
                    <small>Compras verificadas pendientes</small>
                  )}
                </td>
                <td>
                  {loading
                    ? "Consultando…"
                    : usd(asUsd(c.dailyBudget, c.currency, fx))}
                  <small>
                    {c.budgetKind === "adsets"
                      ? "Suma de conjuntos"
                      : c.budgetKind === "lifetime"
                        ? "Presupuesto de duración, sin diario"
                        : c.budgetMessage ||
                          (c.budgetKind === "campaign"
                            ? "A nivel de campaña"
                            : c.platform === "tiktok"
                              ? "Presupuesto pendiente de API"
                              : "")}
                  </small>
                </td>
                <td>{usd(asUsd(c.spend, c.currency, fx))}</td>
                <td>
                  <CampaignAssignment
                    campaign={c}
                    catalog={catalog}
                    ready={ready}
                    saving={saving}
                    saved={saved}
                    save={save}
                  />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={5}>Sin campañas que coincidan.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={r.pagination}>
        <p>{filtered.length} campañas</p>
        <button
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
          aria-label={`Página anterior de ${title}`}
        >
          ←
        </button>
        <span>
          {current + 1}/{pages}
        </span>
        <button
          disabled={current === pages - 1}
          onClick={() => setPage(current + 1)}
          aria-label={`Página siguiente de ${title}`}
        >
          →
        </button>
      </div>
    </div>
  );
}
function CampaignAssignment({
  campaign: c,
  catalog,
  ready,
  saving,
  saved,
  save,
}: {
  campaign: MarketingIntelligence["campaigns"][number];
  catalog: MarketingSummary["catalog"];
  ready: boolean;
  saving: string;
  saved: string;
  save: Save;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? c.mapping?.product_key ?? "",
    dirty = value !== (c.mapping?.product_key ?? "");
  return (
    <div className={r.assignment}>
      {!editing ? (
        <>
          <span className={r.productName} title={c.mapping?.product_name}>
            {c.mapping?.product_name || "Sin asignar"}
          </span>
          {ready && (
            <button
              aria-label={`Asignar producto a ${c.name}`}
              onClick={() => setEditing(true)}
            >
              {c.mapping ? "Cambiar producto" : "Asignar producto"}
            </button>
          )}
        </>
      ) : (
        <>
          <select
            aria-label={`Producto para ${c.name}`}
            disabled={!ready || saving === c.key}
            value={value}
            onChange={(e) => setDraft(e.target.value)}
          >
            <option value="">Sin asignar</option>
            {catalog.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
                {p.sku ? ` · ${p.sku}` : ""}
              </option>
            ))}
          </select>
          {dirty && (
            <button
              disabled={!ready || Boolean(saving)}
              onClick={async () => {
                const p = catalog.find((p) => p.key === value);
                if (
                  await save(c.key, {
                    kind: "mapping",
                    platform: c.platform,
                    account_id: c.accountId,
                    campaign_id: c.id,
                    product_key: p?.key ?? null,
                  })
                ) {
                  setDraft(null);
                  setEditing(false);
                }
              }}
            >
              {saving === c.key ? "Guardando…" : "Guardar"}
            </button>
          )}
          <button
            disabled={saving === c.key}
            onClick={() => {
              setDraft(null);
              setEditing(false);
            }}
          >
            Cancelar
          </button>
        </>
      )}
      {saved === c.key && !dirty && (
        <small role="status">Asignación guardada</small>
      )}
    </div>
  );
}
