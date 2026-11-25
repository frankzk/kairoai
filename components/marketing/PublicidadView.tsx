"use client";
// Pestaña "Publicidad" de Marketing (25/11/2026): la tabla del administrador
// de anuncios (campañas, conjuntos de anuncios y anuncios con sus métricas)
// dentro de Kairo, con el período de arriba. SOLO LECTURA: no hay interruptor
// de encender/apagar, ni edición de presupuesto, ni botón de crear campaña
// (el token de Meta es de lectura y el equipo pidió "solo ver").
//
// Los números son los que reporta Meta, no los pedidos reales de Kairo; todo
// se muestra en USD como el resto de Marketing ("Conversión pendiente" cuando
// no hay tipo de cambio, nunca un número inventado). Las reglas (qué filas se
// listan, métricas derivadas, totales) están en lib/marketing-publicidad.ts.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsUpDown,
  Columns,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  marketingDate,
  periodQuery,
  type MarketingPeriod,
} from "@/lib/marketing-dates";
import { periodLabelText, timeCrText } from "@/lib/marketing-copy";
import {
  PUBLICIDAD_COLUMNS,
  availablePublicidadColumns,
  filterPublicidadRows,
  publicidadRowUsd,
  publicidadTotals,
  realOrdersByRow,
  resultTypeLabel,
  sortPublicidadRows,
  type PublicidadColumn,
  type PublicidadDerived,
  type PublicidadLevel,
  type PublicidadPayload,
  type PublicidadPlatform,
  type PublicidadSortKey,
  type PublicidadUsdRow,
} from "@/lib/marketing-publicidad";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import { useUsdRate } from "./UsdContext";
import { useResource } from "./useMarketing";
import { count, money, shortDate } from "./format";
import s from "./dashboard.module.css";
import r from "./team-report.module.css";
import p from "./publicidad.module.css";

const LEVELS: Array<{
  id: PublicidadLevel;
  tab: string;
  column: string;
  plural: string;
}> = [
  { id: "campaign", tab: "Campañas", column: "Campaña", plural: "campañas" },
  {
    id: "adset",
    tab: "Conjuntos de anuncios",
    column: "Conjunto de anuncios",
    plural: "conjuntos",
  },
  { id: "ad", tab: "Anuncios", column: "Anuncio", plural: "anuncios" },
];
const PLATFORMS: Array<{ id: PublicidadPlatform; label: string; dot: string }> =
  [
    { id: "meta", label: "Meta", dot: "var(--mk-meta)" },
    { id: "tiktok", label: "TikTok", dot: "var(--mk-tiktok)" },
  ];
const KPIS = [
  "Inversión",
  "Impresiones",
  "Clics",
  "CTR",
  "CPC",
  "Leads",
  "Compras",
  "Revenue",
  "ROAS",
] as const;
const PAGE = 100;
const COLUMNS_KEY = "kairo:marketing:publicidad:columnas";
const PENDING = "Conversión pendiente";

const percent2 = new Intl.NumberFormat("es-CR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimal2 = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd = (value: number) => money(value, "USD");
/** Table cells: "$1 200,66". The page header already says the amounts are USD. */
const usdCell = (value: number) => `$${decimal2.format(value)}`;
/**
 * Width of each metric column when the table is fitted to the section (px).
 * The name column takes what is left; below `NAME_MIN` the table goes back to
 * its natural width with a horizontal scroll.
 */
const COLUMN_WIDTH: Record<string, number> = {
  status: 80,
  purchases: 58,
  costPerPurchase: 70,
  purchaseValue: 78,
  roas: 50,
  leads: 46,
  budget: 76,
  spend: 74,
  results: 86,
  costPerResult: 72,
  impressions: 74,
  clicks: 54,
  ctr: 58,
  realOrders: 80,
};
// 170 + the 13 default columns = 1046 px: a 1366 px laptop with the side menu.
const NAME_MIN = 170;
const Dash = () => <span className={p.dash}>—</span>;

interface DrillFilter {
  campaign?: { id: string; name: string; accountId: string };
  adset?: { id: string; name: string; accountId: string };
}
interface Loaded {
  key: string | null;
  data: PublicidadPayload | null;
  loading: boolean;
  error: string;
}

function readColumnChoices(): Partial<Record<PublicidadColumn, boolean>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    // Private mode or blocked storage: the default columns.
    return {};
  }
}

export function PublicidadView({
  period,
  revision,
}: {
  period: MarketingPeriod | null;
  /** The page's "Actualizar": asks Meta again (skips the short cache). */
  revision: number;
}) {
  const fx = useUsdRate();
  const today = marketingDate();
  const [platform, setPlatform] = useState<PublicidadPlatform>("meta");
  const [level, setLevel] = useState<PublicidadLevel>("campaign");
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<DrillFilter>({});
  const [sort, setSort] = useState<{
    key: PublicidadSortKey;
    direction: "asc" | "desc";
  }>({ key: "spend", direction: "desc" });
  const [limit, setLimit] = useState(PAGE);
  const [nonce, setNonce] = useState(0);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [choices, setChoices] = useState<
    Partial<Record<PublicidadColumn, boolean>>
  >({});
  const [knownAccounts, setKnownAccounts] = useState<Record<string, string>>(
    {},
  );
  const columnsRef = useRef<HTMLDivElement>(null);
  // Width the section gives the table: decides whether it fits without scroll.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setFrameWidth(Math.floor(entry.contentRect.width)),
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setChoices(readColumnChoices()), []);
  function chooseColumn(id: PublicidadColumn, visible: boolean) {
    setChoices((current) => {
      const next = { ...current, [id]: visible };
      try {
        window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; the choice still applies to this visit.
      }
      return next;
    });
  }
  function resetColumns() {
    setChoices({});
    try {
      window.localStorage.removeItem(COLUMNS_KEY);
    } catch {
      // Nothing to forget.
    }
  }
  useEffect(() => {
    if (!columnsOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setColumnsOpen(false);
      } else if (!columnsRef.current?.contains(event.target as Node))
        setColumnsOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [columnsOpen]);

  const future = Boolean(period && period.to > today);
  const scope =
    level === "ad" && drill.adset
      ? drill.adset
      : level !== "campaign"
        ? drill.campaign
        : undefined;
  const url =
    period && !future
      ? `/api/marketing/publicidad?${periodQuery(period)}&platform=${platform}&level=${level}${
          scope
            ? `&account=${scope.accountId}&${level === "ad" && drill.adset ? "adset" : "campaign"}=${scope.id}`
            : ""
        }`
      : null;
  const refreshKey = revision + nonce;
  const lastRefresh = useRef(refreshKey);
  const [state, setState] = useState<Loaded>({
    key: null,
    data: null,
    loading: true,
    error: "",
  });
  useEffect(() => {
    if (!url) return;
    // Same URL again = someone pressed "Actualizar": skip the server cache.
    const refresh = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    const controller = new AbortController();
    setState({ key: url, data: null, loading: true, error: "" });
    fetch(refresh ? `${url}&refresh=1` : url, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as PublicidadPayload;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ key: url, data, loading: false, error: "" });
        setKnownAccounts((current) => ({
          ...current,
          ...Object.fromEntries(
            data.accounts.map((a) => [
              `${data.platform}:${a.accountId}`,
              a.accountName,
            ]),
          ),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            key: url,
            data: null,
            loading: false,
            error: "No se pudo consultar la publicidad. Vuelve a actualizar.",
          });
      });
    return () => controller.abort();
  }, [url, refreshKey]);
  const current: Loaded = !url
    ? { key: null, data: null, loading: !future, error: "" }
    : state.key !== url
      ? { key: url, data: null, loading: true, error: "" }
      : state;
  const data = current.data;

  // Pedidos reales por UTM (Kairo): solo se piden si alguien enciende la columna.
  const available = availablePublicidadColumns(platform, level);
  const shown = (id: PublicidadColumn) =>
    available.includes(id) &&
    (choices[id] ??
      !PUBLICIDAD_COLUMNS.find((column) => column.id === id)?.optional);
  const wantsReal = shown("realOrders");
  const control = useResource<MarketingControl>(
    wantsReal && period && !future
      ? `/api/marketing/control?${periodQuery(period)}`
      : null,
    refreshKey,
  );
  const realOrders = useMemo(
    () =>
      control.data ? realOrdersByRow(control.data.days, platform, level) : null,
    [control.data, platform, level],
  );

  const allRows = useMemo(
    () => (data?.rows ?? []).map((row) => publicidadRowUsd(row, fx)),
    [data, fx],
  );
  const rows = useMemo(
    () =>
      sortPublicidadRows(
        filterPublicidadRows(allRows, { account, search }),
        sort.key,
        sort.direction,
      ),
    [allRows, account, search, sort],
  );
  const totals = useMemo(() => publicidadTotals(rows), [rows]);
  const realTotal = realOrders
    ? rows.reduce((sum, row) => sum + (realOrders.get(row.id) ?? 0), 0)
    : null;
  const visible = rows.slice(0, limit);
  const meta = LEVELS.find((entry) => entry.id === level)!;
  const columns = PUBLICIDAD_COLUMNS.filter((column) => shown(column.id));
  // Fitted: every visible column inside the section, no scroll of its own and
  // the header pinned to the page. Otherwise (phone, many columns) the table
  // keeps its natural width and scrolls sideways inside the frame.
  const fit =
    frameWidth >=
    NAME_MIN +
      columns.reduce((sum, column) => sum + (COLUMN_WIDTH[column.id] ?? 80), 0);
  const accountOptions = Object.entries(knownAccounts)
    .filter(([key]) => key.startsWith(`${platform}:`))
    .map(([key, name]) => [key.slice(platform.length + 1), name] as const)
    .sort((a, b) => a[1].localeCompare(b[1], "es"));
  const severalAccounts = !account && (data?.accounts.length ?? 0) > 1;
  const tiktok = data?.platform === "tiktok" ? data.tiktok : undefined;
  const levelWithoutData = (id: PublicidadLevel) =>
    platform === "tiktok" &&
    Boolean(tiktok) &&
    (id === "campaign" ? !tiktok!.campaignsUntil : !tiktok!.adsUntil);

  function changeLevel(next: PublicidadLevel) {
    setLevel(next);
    setLimit(PAGE);
    // A campaign filter means nothing in Campañas; an ad set one only in Anuncios.
    setDrill((filter) =>
      next === "campaign"
        ? {}
        : next === "adset"
          ? { campaign: filter.campaign }
          : filter,
    );
  }
  function changePlatform(next: PublicidadPlatform) {
    if (next === platform) return;
    setPlatform(next);
    setLevel("campaign");
    setAccount("");
    setDrill({});
    setLimit(PAGE);
  }
  function open(row: PublicidadUsdRow) {
    const target = { id: row.id, name: row.name, accountId: row.accountId };
    setLimit(PAGE);
    setSearch("");
    if (level === "campaign") {
      setDrill({ campaign: target });
      setLevel("adset");
    } else if (level === "adset") {
      setDrill((filter) => ({
        campaign:
          filter.campaign ??
          (row.campaignId
            ? {
                id: row.campaignId,
                name: row.campaignName || row.campaignId,
                accountId: row.accountId,
              }
            : undefined),
        adset: target,
      }));
      setLevel("ad");
    }
  }
  function sortBy(key: PublicidadSortKey) {
    setSort((value) =>
      value.key === key
        ? { key, direction: value.direction === "desc" ? "asc" : "desc" }
        : {
            key,
            direction: key === "name" || key === "status" ? "asc" : "desc",
          },
    );
  }

  const moneyCell = (
    value: number | null,
    pending: boolean,
    format: (value: number) => string = usdCell,
  ) =>
    value == null ? (
      pending ? (
        <span className={p.pending}>{PENDING}</span>
      ) : (
        <Dash />
      )
    ) : (
      format(value)
    );
  const countCell = (value: number | null) =>
    value == null || value === 0 ? <Dash /> : count(Math.round(value));
  function cell(
    id: PublicidadColumn,
    row: {
      spend: number | null;
      impressions: number;
      clicks: number;
      purchases: number | null;
      purchaseValue: number | null;
      leads: number | null;
      results: number | null;
      resultType?: string;
      costPerResult: number | null;
      derived: PublicidadDerived;
      pending: boolean;
    },
    full?: PublicidadUsdRow,
  ) {
    switch (id) {
      case "status":
        return !full ? (
          <Dash />
        ) : full.status === "unknown" ? (
          <Dash />
        ) : (
          <span
            data-state={full.status}
            className={`${p.state} ${r.chip} ${
              full.status === "active"
                ? r.chipOk
                : full.status === "other"
                  ? r.chipYellow
                  : r.chipMuted
            }`}
          >
            {full.statusLabel}
          </span>
        );
      case "purchases":
        return countCell(row.purchases);
      case "costPerPurchase":
        return moneyCell(row.derived.costPerPurchase, row.pending);
      case "purchaseValue":
        return row.purchaseValue === 0 ? (
          <Dash />
        ) : (
          moneyCell(row.purchaseValue, row.pending)
        );
      case "roas":
        // Sin valor de conversión el ROAS no dice nada: "—", como el valor.
        return !row.derived.roas ? <Dash /> : decimal2.format(row.derived.roas);
      case "leads":
        return countCell(row.leads);
      case "budget":
        if (!full) return <Dash />;
        if (full.budgetPending)
          return <span className={p.pending}>{PENDING}</span>;
        if (!full.budget)
          return full.budgetInAdsets ? (
            <span
              className={`${p.dash} ${p.wrap}`}
              title="La campaña no tiene presupuesto propio: se define en cada conjunto de anuncios."
            >
              En los conjuntos
            </span>
          ) : (
            <Dash />
          );
        return (
          <>
            {usdCell(full.budget.amount)}
            <small>
              {full.budget.kind === "daily" ? "Diario" : "Total"}
              {full.budget.scope === "campaign"
                ? " · Presupuesto de campaña"
                : ""}
            </small>
          </>
        );
      case "spend":
        return moneyCell(row.spend, row.pending);
      case "results":
        return row.results == null || row.results === 0 ? (
          row.resultType === "mixed" ? (
            <span
              className={`${p.dash} ${p.wrap}`}
              title="Resultados de distinto tipo: no se suman."
            >
              Varios tipos
            </span>
          ) : (
            <Dash />
          )
        ) : (
          <>
            {count(Math.round(row.results))}
            {row.resultType && <small>{resultTypeLabel(row.resultType)}</small>}
          </>
        );
      case "costPerResult":
        return moneyCell(row.costPerResult, row.pending && row.results != null);
      case "impressions":
        return countCell(row.impressions);
      case "clicks":
        return countCell(row.clicks);
      case "ctr":
        return row.derived.ctr == null ? (
          <Dash />
        ) : (
          percent2.format(row.derived.ctr)
        );
      case "realOrders": {
        if (control.loading) return "…";
        if (!realOrders) return <Dash />;
        const orders = full ? realOrders.get(full.id) : realTotal;
        return orders ? count(orders) : <Dash />;
      }
    }
  }

  const kpiValues: Record<(typeof KPIS)[number], ReactNode> = {
    Inversión: moneyCell(totals.spend, totals.spend == null && rows.length > 0, usd),
    Impresiones: countCell(totals.impressions),
    Clics: countCell(totals.clicks),
    CTR:
      totals.derived.ctr == null ? (
        <Dash />
      ) : (
        percent2.format(totals.derived.ctr)
      ),
    CPC: moneyCell(totals.derived.cpc, totals.spend == null && rows.length > 0, usd),
    Leads: countCell(totals.leads),
    Compras: countCell(totals.purchases),
    Revenue:
      totals.purchaseValue === 0 ? (
        <Dash />
      ) : (
        moneyCell(totals.purchaseValue, totals.spend == null && rows.length > 0, usd)
      ),
    ROAS: !totals.derived.roas ? (
      <Dash />
    ) : (
      decimal2.format(totals.derived.roas)
    ),
  };
  const kpis = KPIS.filter(
    (label) =>
      platform === "meta" ||
      (label !== "Leads" &&
        (level !== "campaign" || (label !== "Revenue" && label !== "ROAS"))),
  );

  const accountName = (id: string) => knownAccounts[`meta:${id}`] || id;
  const notes: Array<{ warn: boolean; text: string }> = [];
  if (data) {
    for (const failed of data.unavailable)
      notes.push({
        warn: true,
        text: `No se pudo leer la cuenta ${accountName(failed.accountId)}. ${failed.reason} Sus filas no están en la tabla ni en los totales.`,
      });
    const noEntities = data.accounts.filter((a) => a.entities !== "ok");
    if (noEntities.length)
      notes.push({
        warn: true,
        text: `${noEntities.map((a) => a.accountName).join(", ")}: Meta no dejó leer ${noEntities.some((a) => a.entities === "unavailable") ? "el estado ni el presupuesto" : "todo el estado y presupuesto"}. Las métricas sí están; lo que falta se muestra como "—".`,
      });
    const noResults = data.accounts.filter((a) => a.results !== "ok");
    if (noResults.length)
      notes.push({
        warn: false,
        text: `${noResults.map((a) => a.accountName).join(", ")}: Meta no entregó "Resultados" ni "Costo por resultado" en esta consulta; esas columnas quedan en "—".`,
      });
    if (tiktok)
      notes.push({
        warn: false,
        text: `Kairo no tiene acceso directo a TikTok: se muestra lo que Make guarda cada día. Campañas ${tiktok.campaignsUntil ? `hasta el ${shortDate(tiktok.campaignsUntil)}` : "sin datos todavía"}; grupos de anuncios y anuncios ${tiktok.adsUntil ? `hasta el ${shortDate(tiktok.adsUntil)}` : "sin datos todavía"}. Ese reporte no trae estado, presupuesto, leads ni resultados${level === "campaign" ? ", ni valor de compra por campaña" : ""}: esas columnas no se muestran.`,
      });
    if (wantsReal && control.error)
      notes.push({
        warn: true,
        text: "No se pudieron consultar los pedidos reales por UTM de Kairo; la columna queda sin datos.",
      });
  }

  const emptyText = future
    ? "El período incluye fechas futuras: elige un rango hasta hoy."
    : current.error
      ? current.error
      : data?.status === "pending"
        ? data.message || "Pendiente de configurar acceso de lectura."
        : data && !data.rows.length
          ? data.unavailable.length && !data.accounts.length
            ? "No se pudo leer ninguna cuenta. Vuelve a actualizar en unos minutos."
            : platform === "tiktok"
              ? `Make no ha guardado ${meta.plural} de TikTok en este período.`
              : `Sin ${meta.plural} con entrega ni activos en este período${drill.campaign || drill.adset ? " para este filtro" : ""}.`
          : data && !rows.length
            ? "Ninguna fila coincide con la cuenta o la búsqueda."
            : "";

  return (
    <div className={r.report}>
      <section className={p.view} aria-labelledby="publicidad-titulo">
        <h2 id="publicidad-titulo" className="sr-only">
          Publicidad
        </h2>
        <div className={p.bar}>
          <div className={p.group} role="group" aria-label="Plataforma">
            {PLATFORMS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={s.subtab}
                aria-pressed={platform === entry.id}
                onClick={() => changePlatform(entry.id)}
              >
                <span
                  className={p.platformDot}
                  style={{ background: entry.dot }}
                  aria-hidden
                />
                {entry.label}
              </button>
            ))}
          </div>
          <div className={p.group}>
            {data && !current.loading && (
              <span className={p.updated}>
                {period ? `${periodLabelText(period, today)} · ` : ""}
                Consultado {timeCrText(data.generatedAt)}
              </span>
            )}
            <button
              type="button"
              className={s.button}
              onClick={() => setNonce((value) => value + 1)}
              disabled={!url || current.loading}
            >
              <RefreshCw size={13} aria-hidden />
              {current.loading && url ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
        </div>
        <nav className={p.levels} aria-label="Nivel">
          {LEVELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={p.level}
              aria-pressed={level === entry.id}
              disabled={levelWithoutData(entry.id) && level !== entry.id}
              title={
                levelWithoutData(entry.id)
                  ? "Make todavía no ha enviado este reporte de TikTok."
                  : undefined
              }
              onClick={() => changeLevel(entry.id)}
            >
              {entry.tab}
            </button>
          ))}
        </nav>
        <div className={p.controls} ref={columnsRef}>
          <select
            aria-label="Cuenta publicitaria"
            value={account}
            onChange={(event) => {
              const next = event.target.value;
              setAccount(next);
              setLimit(PAGE);
              // The drill-down belongs to one account: another account clears it.
              if (next && scope && scope.accountId !== next) {
                setDrill({});
                setLevel("campaign");
              }
            }}
          >
            <option value="">Todas las cuentas</option>
            {accountOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className={p.search}>
            <span className="sr-only">Buscar por nombre</span>
            <Search size={14} aria-hidden />
            <input
              type="search"
              placeholder={`Buscar ${meta.plural}…`}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(PAGE);
              }}
            />
          </label>
          <span className={p.spacer} />
          <button
            type="button"
            className={s.button}
            aria-expanded={columnsOpen}
            aria-controls="publicidad-columnas"
            onClick={() => setColumnsOpen((value) => !value)}
          >
            <Columns size={13} aria-hidden />
            Columnas
          </button>
          {columnsOpen && (
            <div
              id="publicidad-columnas"
              className={p.columns}
              role="group"
              aria-label="Columnas visibles"
            >
              <p>Columnas visibles (se recuerdan en este navegador).</p>
              {PUBLICIDAD_COLUMNS.filter((column) =>
                available.includes(column.id),
              ).map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={shown(column.id)}
                    onChange={(event) =>
                      chooseColumn(column.id, event.target.checked)
                    }
                  />
                  <span>
                    {column.label}
                    {column.id === "realOrders" && (
                      <small>
                        Dato de Kairo, no de{" "}
                        {platform === "meta" ? "Meta" : "TikTok"}: pedidos sin
                        anulados cuyo UTM trae{" "}
                        {level === "ad" ? "este anuncio" : "esta campaña"}.
                      </small>
                    )}
                  </span>
                </label>
              ))}
              <div className={p.columnsFoot}>
                <button
                  type="button"
                  className={p.textButton}
                  onClick={resetColumns}
                >
                  Restablecer
                </button>
                <button
                  type="button"
                  className={p.textButton}
                  onClick={() => setColumnsOpen(false)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>
        {(drill.campaign || (drill.adset && level === "ad")) && (
          <div className={p.crumbs} aria-label="Filtro activo">
            <span>Filtrado por</span>
            {drill.campaign && (
              <span className={p.crumb}>
                <span title={drill.campaign.name}>
                  Campaña: {drill.campaign.name}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar el filtro de la campaña ${drill.campaign.name}`}
                  onClick={() => {
                    setDrill({});
                    setLimit(PAGE);
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            )}
            {drill.adset && level === "ad" && (
              <span className={p.crumb}>
                <span title={drill.adset.name}>
                  Conjunto: {drill.adset.name}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar el filtro del conjunto ${drill.adset.name}`}
                  onClick={() => {
                    setDrill((filter) => ({ campaign: filter.campaign }));
                    setLimit(PAGE);
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            )}
          </div>
        )}
        {notes.length > 0 && (
          <div className={p.notes}>
            {notes.map((note) => (
              <p
                key={note.text}
                role={note.warn ? "alert" : "note"}
                className={`${p.note} ${note.warn ? p.noteWarn : ""}`}
              >
                {note.text}
              </p>
            ))}
          </div>
        )}
        <dl
          className={p.kpis}
          aria-label={`Totales de ${meta.plural} listados`}
          aria-busy={current.loading}
          style={{ "--kpis": kpis.length } as CSSProperties}
        >
          {kpis.map((label) => (
            <div key={label} className={p.kpi}>
              <dt>{label}</dt>
              <dd>
                {current.loading ? (
                  <span className={p.skeleton} />
                ) : rows.length ? (
                  kpiValues[label]
                ) : (
                  <Dash />
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div
          ref={frameRef}
          className={`${r.tableWrap} ${p.frame}`}
          data-fit={fit}
          tabIndex={fit ? undefined : 0}
          role="region"
          aria-label={`${meta.tab} de ${platform === "meta" ? "Meta" : "TikTok"}`}
        >
          <table className={p.table} aria-busy={current.loading}>
            <thead>
              <tr>
                <th
                  scope="col"
                  className={p.name}
                  aria-sort={
                    sort.key === "name"
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <SortButton
                    label={meta.column}
                    active={sort.key === "name"}
                    direction={sort.direction}
                    onClick={() => sortBy("name")}
                  />
                </th>
                {columns.map((column) =>
                  column.id === "realOrders" ? (
                    <th
                      key={column.id}
                      scope="col"
                      style={fit ? { width: COLUMN_WIDTH[column.id] } : undefined}
                    >
                      {column.label}
                    </th>
                  ) : (
                    <th
                      key={column.id}
                      scope="col"
                      className={column.id === "status" ? p.left : undefined}
                      style={fit ? { width: COLUMN_WIDTH[column.id] } : undefined}
                      aria-sort={
                        sort.key === column.id
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <SortButton
                        label={column.label}
                        active={sort.key === column.id}
                        direction={sort.direction}
                        onClick={() => sortBy(column.id as PublicidadSortKey)}
                      />
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {current.loading &&
                Array.from({ length: 8 }, (_, index) => (
                  <tr key={index}>
                    <th scope="row" className={p.name}>
                      <span className={`${p.skeleton} ${p.skeletonWide}`} />
                    </th>
                    {columns.map((column) => (
                      <td key={column.id}>
                        <span className={p.skeleton} />
                      </td>
                    ))}
                  </tr>
                ))}
              {!current.loading && emptyText && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className={p.empty}
                    role={current.error ? "alert" : undefined}
                  >
                    {emptyText}
                    {current.error && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={p.textButton}
                          onClick={() => setNonce((value) => value + 1)}
                        >
                          Reintentar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {!current.loading &&
                visible.map((row) => {
                  const parents = [
                    level !== "campaign" && !drill.campaign
                      ? row.campaignName
                      : "",
                    level === "ad" && !drill.adset ? row.adsetName : "",
                  ].filter(Boolean);
                  return (
                    <tr key={`${row.accountId}:${row.id}`}>
                      <th scope="row" className={p.name}>
                        {level === "ad" ? (
                          <span className={p.rowName} title={row.name}>
                            {row.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={p.drill}
                            title={
                              level === "campaign"
                                ? "Ver los conjuntos de anuncios de esta campaña"
                                : "Ver los anuncios de este conjunto"
                            }
                            onClick={() => open(row)}
                          >
                            <span title={row.name}>{row.name}</span>
                            <ChevronRight size={13} aria-hidden />
                          </button>
                        )}
                        {parents.length > 0 && (
                          <small className={p.rowMeta}>
                            {parents.join(" › ")}
                          </small>
                        )}
                        <small className={`${p.rowMeta} ${p.rowId}`}>
                          {severalAccounts && row.accountName && (
                            <span className={p.rowAccount}>
                              {row.accountName}
                            </span>
                          )}
                          <CopyId id={row.id} what={meta.column} />
                        </small>
                      </th>
                      {columns.map((column) => (
                        <td
                          key={column.id}
                          className={
                            column.id === "status" ? p.left : undefined
                          }
                        >
                          {cell(column.id, row, row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
            {!current.loading && rows.length > 0 && (
              <tfoot>
                <tr>
                  <th scope="row" className={p.name}>
                    Resultados de {count(rows.length)}{" "}
                    {rows.length === 1
                      ? meta.column.toLocaleLowerCase("es")
                      : meta.plural}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={column.id === "status" ? p.left : undefined}
                    >
                      {cell(column.id, {
                        ...totals,
                        costPerResult: totals.derived.costPerResult,
                        pending: totals.spend == null,
                      })}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!current.loading && rows.length > limit && (
          <div className={p.more}>
            <span>
              Se muestran {count(limit)} de {count(rows.length)} {meta.plural};
              los totales cuentan todos.
            </span>
            <button
              type="button"
              className={s.button}
              onClick={() => setLimit((value) => value + PAGE)}
            >
              Mostrar {count(Math.min(PAGE, rows.length - limit))} más
            </button>
          </div>
        )}
        <p className={p.foot}>
          {platform === "meta"
            ? "Los datos son los que reporta Meta: compras y valor de conversión del píxel, leads y resultados de Meta (atribución 7 días clic / 1 día vista). No son los pedidos reales de Kairo. Costo por compra, ROAS, CTR y CPC se calculan con los totales; los importes van en USD con la referencia de conversión de arriba. Se listan las filas con gasto o impresiones en el período y las activas sin entrega; las pausadas sin gasto no aparecen. \"Eliminado\" es una campaña, conjunto o anuncio que gastó en el período y que Meta ya no lista (se eliminó o archivó); si se volvió a crear con el mismo nombre, la nueva sale en otra fila. Es solo lectura: desde Kairo no se enciende, apaga ni edita nada en Meta."
            : "Los datos son los que TikTok reportó a Make, no los pedidos reales de Kairo; compras = Complete Payment. Los importes van en USD con la referencia de conversión de arriba. Es solo lectura."}
        </p>
      </section>
    </div>
  );
}

/** The Meta / TikTok id of a row: tells apart entities recreated with the same name. Click copies it. */
function CopyId({ id, what }: { id: string; what: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={p.copyId}
      data-copied={copied}
      title={`Copiar el ID de ${what.toLocaleLowerCase("es")}`}
      onClick={() => {
        navigator.clipboard
          ?.writeText(id)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      <span aria-live="polite">{copied ? "ID copiado" : `ID ${id}`}</span>
    </button>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active
    ? ChevronsUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <button
      type="button"
      className={p.sort}
      data-active={active}
      onClick={onClick}
      title={`Ordenar por ${label.toLocaleLowerCase("es")}`}
    >
      {label}
      <Icon size={12} aria-hidden />
    </button>
  );
}
