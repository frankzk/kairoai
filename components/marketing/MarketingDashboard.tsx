"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  marketingDate,
  marketingPeriod,
  periodFromParams,
  presetPeriod,
  type MarketingPeriod,
  type MarketingPreset,
} from "@/lib/marketing-dates";
import { buildMarketingIntelligence } from "@/lib/marketing-intelligence";
import { leerYo } from "@/lib/sesion-cliente";
import { useMarketing } from "./useMarketing";
import { useCharlie } from "./useCharlie";
import { buildCharlieModel } from "@/lib/marketing-charlie";
import { UsdProvider } from "./UsdContext";
import {
  CharlieCurrency,
  CharlieExecutive,
  CharlieMatrix,
  CharlieStructure,
  CharlieSubtraction,
} from "./CharliePanels";
import { Overview, SourceConnections, Trends } from "./MarketingViews";
import { CampaignWorkspace } from "./CampaignWorkspace";
import { ProductWorkspace } from "./ProductWorkspace";
import CampaignsTable from "./CampaignsTable";
import { shortDate } from "./format";
import s from "./dashboard.module.css";

type View =
  | "summary"
  | "details"
  | "trends"
  | "sources"
  | "matrix"
  | "structure"
  | "subtraction";
const presets: Array<[MarketingPreset, string]> = [
  ["today", "Hoy"],
  ["yesterday", "Ayer"],
  ["week", "Esta semana"],
  ["month", "Este mes"],
  ["last-month", "Mes anterior"],
  ["7d", "Últimos 7 días"],
  ["14d", "Últimos 14 días"],
  ["28d", "Últimos 28 días"],
  ["30d", "Últimos 30 días"],
  ["custom", "Personalizado"],
];
export default function MarketingDashboard() {
  const [period, setPeriod] = useState<MarketingPeriod | null>(null);
  const [preset, setPreset] = useState<MarketingPreset>("month");
  const [view, setView] = useState<View>("summary");
  const [detailView, setDetailView] = useState<"campaigns" | "products">(
    "campaigns",
  );
  const [revision, setRevision] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dateError, setDateError] = useState("");
  const [canViewManagement, setCanViewManagement] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      initial = periodFromParams(params);
    const key = params.get("preset") as MarketingPreset;
    const dynamicPreset =
      presets.some(([id]) => id === key) && key !== "custom";
    const chosen = dynamicPreset
      ? presetPeriod(key as Exclude<MarketingPreset, "custom">)
      : initial && initial.to <= marketingDate()
        ? initial
        : presetPeriod("month");
    setPeriod(chosen);
    setFrom(chosen.from);
    setTo(chosen.to);
    setPreset(
      dynamicPreset
        ? key
        : initial && initial.to <= marketingDate()
          ? "custom"
          : "month",
    );
    const requested = params.get("view");
    if (
      [
        "summary",
        "details",
        "trends",
        "sources",
        "matrix",
        "structure",
        "subtraction",
      ].includes(requested || "")
    )
      setView(requested as View);
    const yo = leerYo();
    setCanViewManagement(
      Boolean(
        yo?.permisos.some(
          (permission) => permission === "pedidos" || permission === "finanzas",
        ),
      ),
    );
    setCanEdit(
      Boolean(
        yo?.permisos.includes("marketing") &&
        !(yo.permisos as string[]).includes("solo_lectura"),
      ),
    );
  }, []);
  useEffect(() => {
    if (!period) return;
    const query = new URLSearchParams({
      view,
      preset,
      from: period.from,
      to: period.to,
    });
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${query}`,
    );
  }, [period, preset, view]);
  const api = useMarketing(period, revision);
  const data = api.summary.data;
  const charlieActive = !["details", "trends", "sources"].includes(view);
  const charlie = useCharlie(period, revision, charlieActive);
  const [frequencyDay, setFrequencyDay] = useState("");
  const charlieModel = useMemo(
    () =>
      period
        ? buildCharlieModel(
            data ?? { period, totals: { generated: 0, delivered: 0 } },
            charlie.business.data,
            api.sources.data,
            charlie.report.data,
            charlie.settings.data,
            frequencyDay,
          )
        : null,
    [
      data,
      period,
      charlie.business.data,
      api.sources.data,
      charlie.report.data,
      charlie.settings.data,
      frequencyDay,
    ],
  );
  const model = useMemo(
    () =>
      data
        ? buildMarketingIntelligence(data, api.sources.data, api.settings.data)
        : null,
    [data, api.sources.data, api.settings.data],
  );
  const missing = (
    [
      ["meta", "Meta Ads"],
      ["tiktok", "TikTok Ads"],
      ["shiphero", "ShipHero"],
    ] as const
  )
    .filter(([key]) => api.sources.data?.[key].status !== "ready")
    .map(([, name]) => name);
  const busy =
    api.summary.loading ||
    api.sources.loading ||
    charlie.settings.loading ||
    (charlieActive && (charlie.report.loading || charlie.business.loading));
  const settingsReady = Boolean(
    api.settings.data &&
    !api.settings.loading &&
    !api.settings.error &&
    canEdit,
  );
  function selectPreset(key: MarketingPreset) {
    setPreset(key);
    setDateError("");
    if (key !== "custom") {
      const next = presetPeriod(key);
      setPeriod(next);
      setFrom(next.from);
      setTo(next.to);
    }
  }
  return (
    <UsdProvider fx={charlie.settings.data?.fx ?? null}>
      <main className={s.workspace}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>Mireva Costa Rica / Operación comercial</p>
            <h1 className={s.title}>Marketing</h1>
            <p className={`${s.muted} mt-1`}>
              {period
                ? `${shortDate(period.from)} al ${shortDate(period.to)}`
                : "Preparando período"}{" "}
              · Hora de Costa Rica
            </p>
          </div>
          <div className={s.toolbar}>
            <label className={s.field}>
              Período
              <select
                className={`${s.control} min-w-[165px]`}
                value={preset}
                onChange={(event) =>
                  selectPreset(event.target.value as MarketingPreset)
                }
              >
                {presets.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={s.button}
              onClick={() => {
                if (preset !== "custom") selectPreset(preset);
                setRevision((value) => value + 1);
              }}
              disabled={
                !period ||
                busy ||
                Boolean(api.saving) ||
                Boolean(charlie.saving)
              }
            >
              {busy ? "Actualizando…" : "Actualizar"}
            </button>
            <button
              className={s.button}
              onClick={() =>
                setView(view === "sources" ? "summary" : "sources")
              }
              aria-pressed={view === "sources"}
            >
              Conexiones
            </button>
          </div>
        </header>
        {preset === "custom" && (
          <form
            className={`${s.toolbar} mt-5`}
            onSubmit={(event) => {
              event.preventDefault();
              const next = marketingPeriod(from, to);
              if (!next || to > marketingDate()) {
                setDateError(
                  "Elige fechas válidas, sin días futuros y con un máximo de 93 días.",
                );
                return;
              }
              setDateError("");
              setPeriod(next);
            }}
          >
            <label className={s.field}>
              Desde
              <input
                aria-describedby={
                  dateError ? "marketing-date-error" : undefined
                }
                className={s.control}
                type="date"
                min="2020-01-01"
                max={marketingDate()}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                required
              />
            </label>
            <label className={s.field}>
              Hasta
              <input
                aria-describedby={
                  dateError ? "marketing-date-error" : undefined
                }
                className={s.control}
                type="date"
                min={from || "2020-01-01"}
                max={marketingDate()}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                required
              />
            </label>
            <button
              className={`${s.button} ${s.primary}`}
              type="submit"
              disabled={Boolean(api.saving)}
            >
              Aplicar fechas
            </button>
            {dateError && (
              <p
                id="marketing-date-error"
                role="alert"
                className={`${s.warn} w-full text-xs`}
              >
                {dateError}
              </p>
            )}
          </form>
        )}
        <nav className={s.tabs} aria-label="Vistas de marketing">
          {[
            ["summary", "Decisión financiera"],
            ["matrix", "Matriz 4Pi"],
            ["structure", "Control y Testing"],
            ["subtraction", "Sustracción"],
          ].map(([key, label], index) => (
            <button
              key={key}
              type="button"
              className={s.tab}
              aria-pressed={view === key}
              onClick={() => setView(key as View)}
            >
              <span className={s.tabIndex}>0{index + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className={`${s.toolbar} mb-5`}>
          <button
            className={s.button}
            aria-pressed={view === "details"}
            onClick={() => setView("details")}
          >
            Productos y campañas
          </button>
          <button
            className={s.button}
            aria-pressed={view === "trends"}
            onClick={() => setView("trends")}
          >
            Tendencias y reposición
          </button>
          <span className={s.muted}>
            {charlie.settings.loading
              ? "USD · consultando referencia de conversión"
              : charlie.settings.data?.fx.rate
                ? `USD · ${charlie.settings.data.fx.rate} CRC/USD · referencia ${charlie.settings.data.fx.date}`
                : "USD · referencia de conversión pendiente"}
          </span>
        </div>
        <div className={s.notice} role="status">
          <span>
            {api.sources.loading
              ? "Consultando inversión y disponibilidad de las conexiones…"
              : api.sources.error
                ? "No se pudieron consultar las conexiones. La inversión queda sin datos."
                : missing.length
                  ? `${missing.join(", ")}: conexión pendiente o consulta no disponible. La inversión puede ser parcial.`
                  : "Plataformas e inventario consultados. Las ventas siguen sin atribuir a campañas."}
          </span>
          {view !== "sources" && (
            <button className={s.link} onClick={() => setView("sources")}>
              Ver fuentes
            </button>
          )}
        </div>
        {(api.settings.error || api.saveError) && (
          <div role="alert" className={`${s.notice} ${s.warn}`}>
            {api.saveError ||
              "No se pudieron cargar las asignaciones y prioridades. Los costos por producto quedan sin datos; vuelve a actualizar."}
          </div>
        )}
        {view === "sources" ? (
          <SourceConnections
            sources={api.sources.data}
            loading={api.sources.loading}
          />
        ) : ["matrix", "structure", "subtraction"].includes(view) ? (
          charlie.report.loading || !charlieModel || !period ? (
            <div
              className={s.skeleton}
              role="status"
              aria-label="Consultando anuncios de las cinco cuentas"
            />
          ) : charlie.report.error ||
            charlie.report.data?.status !== "ready" ? (
            <div role="alert" className={s.empty}>
              {charlie.report.data?.message ||
                charlie.report.error ||
                "No se pudieron consultar los anuncios."}
            </div>
          ) : (
            <>
              {view === "matrix" ? (
                <CharlieMatrix
                  model={charlieModel}
                  period={period}
                  onDay={setFrequencyDay}
                />
              ) : view === "structure" ? (
                <CharlieStructure
                  model={charlieModel}
                  canEdit={Boolean(canEdit && charlie.settings.data)}
                  saving={charlie.saving}
                  save={charlie.save}
                  error={charlie.error}
                />
              ) : (
                <CharlieSubtraction
                  model={charlieModel}
                  period={period}
                  onDay={setFrequencyDay}
                />
              )}
            </>
          )
        ) : api.summary.loading ? (
          <div role="status" aria-label="Cargando pedidos y resultados">
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className={`${s.skeleton} !h-24`} />
              ))}
            </div>
            <div className="grid gap-6 md:grid-cols-[1.6fr_1fr]">
              <div className={s.skeleton} />
              <div className={s.skeleton} />
            </div>
          </div>
        ) : api.summary.error ? (
          <section role="alert" className={s.empty}>
            <h2 className={s.heading}>No se pudieron consultar los pedidos</h2>
            <p className={`${s.muted} mt-2`}>{api.summary.error}</p>
            <button
              className={`${s.button} mt-4`}
              onClick={() => setRevision((value) => value + 1)}
            >
              Reintentar
            </button>
            {view === "details" && (
              <div className="mt-6">
                <CampaignsTable
                  sources={api.sources.data}
                  loading={api.sources.loading}
                  error={api.sources.error}
                />
              </div>
            )}
          </section>
        ) : data && model ? (
          <>
            {data.totals.generated === 0 && (
              <p className={`${s.muted} mb-5`}>
                No hay pedidos creados en este período. La inversión consultada
                se conserva; el costo por pedido requiere pedidos.
              </p>
            )}
            {view === "summary" ? (
              <>
                {charlieModel && (
                  <CharlieExecutive
                    model={charlieModel}
                    loading={
                      charlie.business.loading ||
                      charlie.settings.loading ||
                      api.sources.loading
                    }
                    error={charlie.business.error || charlie.settings.error}
                    reportLoading={charlie.report.loading}
                  />
                )}
                <CharlieCurrency
                  key={charlie.settings.data?.config.crc_per_usd ?? "automatic"}
                  settings={charlie.settings.data}
                  loading={charlie.settings.loading}
                  error={charlie.error}
                  canEdit={Boolean(canEdit && charlie.settings.data)}
                  saving={charlie.saving}
                  save={charlie.save}
                />
                <details className={s.section}>
                  <summary className={s.link}>
                    Ver resumen operativo, productos y liquidaciones
                  </summary>
                  <div className="mt-5">
                    <Overview
                      data={data}
                      model={model}
                      sourcesLoading={api.sources.loading}
                      go={setView}
                    />
                  </div>
                </details>
              </>
            ) : view === "details" ? (
              <>
                <div className={`${s.toolbar} mb-6`}>
                  <button
                    className={`${s.button} ${detailView === "campaigns" ? s.primary : ""}`}
                    aria-pressed={detailView === "campaigns"}
                    onClick={() => setDetailView("campaigns")}
                  >
                    Campañas y presupuesto
                  </button>
                  <button
                    className={`${s.button} ${detailView === "products" ? s.primary : ""}`}
                    aria-pressed={detailView === "products"}
                    onClick={() => setDetailView("products")}
                  >
                    Productos prioritarios
                  </button>
                  <span className={s.muted}>
                    CPA máximo USD 8.50 · Stock mínimo 100
                  </span>
                </div>
                {detailView === "campaigns" ? (
                  <CampaignWorkspace
                    model={model}
                    catalog={data.catalog}
                    ready={settingsReady}
                    loading={api.sources.loading}
                    saving={api.saving}
                    saved={api.saved}
                    save={api.save}
                  />
                ) : (
                  <ProductWorkspace
                    products={model.products}
                    ready={settingsReady}
                    saving={api.saving}
                    save={api.save}
                  />
                )}
              </>
            ) : (
              <>
                <Trends data={data} model={model} />
                {api.sources.data?.shiphero.status !== "ready" && (
                  <div className={s.notice}>
                    Puedes configurar proveedores y plazos ahora. Las
                    sugerencias de compra necesitan stock real de ShipHero; no
                    se calculan con inventario desconocido.
                  </div>
                )}
                <ProductWorkspace
                  products={model.products}
                  ready={settingsReady}
                  saving={api.saving}
                  save={api.save}
                  replenishment
                />
              </>
            )}
          </>
        ) : null}
        <footer className={s.footer}>
          Pedidos según su fecha de creación; estados según la última
          sincronización. Presupuesto y stock son actuales. La asignación
          campaña-producto no atribuye pedidos individuales.{" "}
          {data && (
            <>
              Cálculo operativo:{" "}
              {new Intl.DateTimeFormat("es-CR", {
                timeZone: "America/Costa_Rica",
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(data.calculatedAt))}
              .
            </>
          )}
          {canViewManagement && (
            <Link
              href="/admin/finance?store=mireva-cr"
              className={`${s.link} ml-2`}
            >
              Ir a Gestión
            </Link>
          )}
        </footer>
      </main>
    </UsdProvider>
  );
}
