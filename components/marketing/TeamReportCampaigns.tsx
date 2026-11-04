"use client";
import { useState } from "react";
import {
  matchCampaignProduct,
  type MarketingFamily,
} from "@/lib/marketing-product-families";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingIntelligence } from "@/lib/marketing-intelligence";
import { asUsd } from "@/lib/marketing-usd-rate";
import { money } from "./format";
import r from "./team-report.module.css";
import s from "./dashboard.module.css";
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
const usd = (value: number | null | undefined) =>
  value == null ? "Sin datos" : money(value, "USD");
export function CampaignGroups({
  sources,
  model,
  catalog,
  families,
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
  families?: MarketingFamily[];
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
          families={families}
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
  families,
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
  families?: MarketingFamily[];
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
                    families={families}
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
export function CampaignAssignment({
  campaign: c,
  families = [],
  ready,
  saving,
  saved,
  save,
}: {
  campaign: MarketingIntelligence["campaigns"][number];
  catalog: MarketingSummary["catalog"];
  families?: MarketingFamily[];
  ready: boolean;
  saving: string;
  saved: string;
  save: Save;
}) {
  const currentFamily = families.find(
    (f) =>
      f.key === c.mapping?.family_key ||
      f.members.some((v) => v.key === c.mapping?.product_key),
  );
  const currentKeys =
    c.mapping?.variant_scope === "selected"
      ? (c.mapping.variant_keys ?? [])
      : c.mapping && c.mapping.variant_scope !== "all"
        ? [c.mapping.product_key]
        : [];
  const [editing, setEditing] = useState(false),
    [familyKey, setFamilyKey] = useState(""),
    [mode, setMode] = useState<"all" | "selected">("all"),
    [keys, setKeys] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [failed, setFailed] = useState(false);
  const family = families.find((f) => f.key === familyKey),
    suggestion = matchCampaignProduct(c.name, families);
  const changed =
    familyKey !== (currentFamily?.key ?? "") ||
    mode !== (c.mapping?.variant_scope === "all" ? "all" : "selected") ||
    JSON.stringify([...keys].sort()) !==
      JSON.stringify([...currentKeys].sort());
  function edit() {
    setFamilyKey(currentFamily?.key ?? "");
    setMode(
      c.mapping?.variant_scope === "all" || !c.mapping ? "all" : "selected",
    );
    setKeys(currentKeys);
    setEditing(true);
    setQuery("");
    setFailed(false);
  }
  async function persist(
    f: MarketingFamily | undefined,
    m: "all" | "selected",
    selected: string[],
  ) {
    setFailed(false);
    const base = {
      kind: "mapping",
      platform: c.platform,
      account_id: c.accountId,
      campaign_id: c.id,
    };
    const ok = await save(
      c.key,
      f
        ? {
            ...base,
            family_key: f.key,
            variant_scope: m,
            variant_keys: m === "all" ? [] : selected,
          }
        : { ...base, product_key: null, disable_auto: true },
    );
    if (ok) setEditing(false);
    else setFailed(true);
  }
  const matches = families.filter(
    (f) =>
      `${f.name} ${f.members.map((v) => v.sku).join(" ")}`
        .toLocaleLowerCase("es")
        .includes(query.toLocaleLowerCase("es")) || f.key === familyKey,
  );
  return (
    <div className={r.assignment}>
      {!editing ? (
        <>
          <span className={r.productName} title={c.mapping?.product_name}>
            {c.mapping?.product_name || "Sin asignar"}
          </span>
          {c.mapping && (
            <small>
              {c.mapping.variant_scope === "all"
                ? `Todas las variantes · ${currentFamily?.members.length ?? "?"} referencias`
                : `${currentKeys.length || 1} referencia(s) seleccionada(s)`}
            </small>
          )}
          {c.mapping?.automatic && (
            <small className={s.good}>
              Automática: {c.mapping.match_reason}
            </small>
          )}
          {!c.mapping && suggestion.kind !== "none" && (
            <small>
              {suggestion.kind === "ambiguous"
                ? "Coincidencia ambigua: revisa el producto"
                : "Sugerencias disponibles, requieren revisión"}
            </small>
          )}
          {ready && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                className={s.button}
                aria-label={`Asignar producto a ${c.name}`}
                onClick={edit}
              >
                {c.mapping ? "Cambiar producto" : "Asignar producto"}
              </button>
              {c.mapping?.automatic && currentFamily && (
                <button
                  className={s.button}
                  disabled={Boolean(saving)}
                  onClick={() =>
                    persist(
                      currentFamily,
                      c.mapping!.variant_scope === "all" ? "all" : "selected",
                      currentKeys,
                    )
                  }
                >
                  Fijar asignación
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <input
            className={s.control}
            type="search"
            aria-label={`Buscar producto para ${c.name}`}
            placeholder="Buscar producto o SKU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className={s.control}
            aria-label={`Producto para ${c.name}`}
            disabled={!ready || Boolean(saving)}
            value={familyKey}
            onChange={(e) => {
              setFamilyKey(e.target.value);
              setMode("all");
              setKeys([]);
            }}
          >
            <option value="">Sin asignar (desactiva automática)</option>
            {matches.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name} · {f.members.length} referencias
                {suggestion.candidates.some((x) => x.key === f.key)
                  ? " · coincidencia sugerida"
                  : ""}
              </option>
            ))}
          </select>
          {family && (
            <>
              <select
                className={s.control}
                aria-label={`Alcance de variantes para ${c.name}`}
                value={mode}
                onChange={(e) => setMode(e.target.value as "all" | "selected")}
              >
                <option value="all">
                  Todas las variantes y registros históricos
                </option>
                <option value="selected">Elegir variantes</option>
              </select>
              {family.review && (
                <small className={s.warn}>
                  SKU o nombre ambiguo entre productos. Revisa sus miembros.
                </small>
              )}
              {mode === "selected" && (
                <fieldset className={r.variantList}>
                  <legend>Variantes y registros históricos</legend>
                  {family.members.map((v) => (
                    <label key={v.key}>
                      <input
                        type="checkbox"
                        checked={keys.includes(v.key)}
                        onChange={(e) =>
                          setKeys((old) =>
                            e.target.checked
                              ? [...old, v.key]
                              : old.filter((k) => k !== v.key),
                          )
                        }
                      />
                      <span>
                        {v.name}
                        <small>
                          {v.sku || "Sin SKU"}
                          {v.historical ? " · histórico" : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <small>
                {mode === "all"
                  ? `Incluye ${family.members.length} referencias y nuevas variantes del producto.`
                  : `${keys.length} referencias elegidas; la selección no se amplía sola.`}{" "}
                Cada pedido cuenta una vez.
              </small>
            </>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <button
            className={`${s.button} ${s.primary} ${r.saveAssignment}`}
              disabled={
                !ready ||
                Boolean(saving) ||
                (family && mode === "selected" && !keys.length) ||
                (!changed && !c.mapping?.automatic)
              }
              onClick={() => persist(family, mode, keys)}
            >
              {saving === c.key ? "Guardando…" : "Guardar"}
            </button>
            <button
              className={s.button}
              disabled={saving === c.key}
              onClick={() => {
                setEditing(false);
                setFailed(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}
      {failed && (
        <small role="alert" className={s.bad}>
          No se pudo guardar. Revisa las variantes y vuelve a intentarlo.
        </small>
      )}
      {saved === c.key && !editing && (
        <small role="status">Asignación guardada</small>
      )}
    </div>
  );
}
