"use client";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CircleAlert,
  CircleCheck,
  Eye,
  Hourglass,
  Power,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { MarketingSummary } from "@/lib/marketing";
import type { MarketingSources } from "@/lib/marketing-source-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { CharlieReport, UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingControl } from "@/lib/marketing-real-orders";
import {
  budgetText,
  DECISION_RULES,
  type CampaignDecision,
  type DecisionAction,
  type DoneAction,
} from "@/lib/marketing-decisions";
import {
  agoText,
  buildActionQueue,
  canMarkDone,
  filterFromAnchor,
  filterQueue,
  learningUntilText,
  markDonePayload,
  queueCounts,
  queueGroup,
  QUEUE_FILTERS,
  type QueueFilter,
  type QueueItem,
  type QueueKind,
} from "@/lib/marketing-action-queue";
import { decimalText, periodLabelText } from "@/lib/marketing-copy";
import { marketingDate, shiftDate } from "@/lib/marketing-dates";
import { count, money } from "./format";
import { CostCapControl } from "./CostCapControl";
import { useCampaignActions } from "./useCampaignActions";
import { useDecisions } from "./useDecisions";
import type { MarketingChanges } from "./useMarketing";
import r from "./team-report.module.css";
import rs from "./resumen.module.css";
import a from "./acciones.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };
type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
type Tone = "good" | "warn" | "bad" | "neutral";

const usd = (value: number | null) => money(value, "USD");
const ordersText = (value: number | null) =>
  value == null
    ? "Sin datos"
    : Number.isInteger(value)
      ? count(value)
      : decimalText(value);
/** Minutes during which the author can undo a "Hecho". */
const UNDO_MINUTES = 30;
const PAGE = 25;

const KIND_ICON: Record<QueueKind, ReactNode> = {
  escalar: <TrendingUp aria-hidden="true" />,
  bajar: <TrendingDown aria-hidden="true" />,
  apagar: <Power aria-hidden="true" />,
  costcap: <Target aria-hidden="true" />,
  aprendizaje: <Hourglass aria-hidden="true" />,
  vigilar: <Eye aria-hidden="true" />,
};
const KIND_TONE: Record<QueueKind, Tone> = {
  escalar: "good",
  bajar: "warn",
  apagar: "bad",
  costcap: "good",
  aprendizaje: "neutral",
  vigilar: "neutral",
};
const DECISION_KIND: Record<DecisionAction, QueueKind | null> = {
  escalar: "escalar",
  bajar: "bajar",
  apagar: "apagar",
  aprendizaje: "aprendizaje",
  mantener: null,
  sin_datos: null,
};

/** Wall clock that ticks every 30 s ("Hecho · hace 5 min"). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * Acciones (vista del media buyer): la cola de acciones del día ordenada por
 * impacto, con "Hecho" (registro de cambios), la tabla compacta de campañas
 * activas y el control de las COST CAP.
 */
export function ActionsView({
  data,
  settings,
  fx,
  actions,
  control,
  changes,
  costCapAds,
  canEdit,
  logChange,
  deleteChange,
  filterLabel,
  focus = null,
}: {
  data: MarketingSummary;
  settings: MarketingSettings | null;
  fx: UsdRate | null;
  actions: Resource<MarketingSources>;
  control: Resource<MarketingControl>;
  changes: Resource<MarketingChanges>;
  costCapAds: Resource<CharlieReport>;
  canEdit: boolean;
  /** Kept for the dashboard's shared props (account labels live in Detalle). */
  saving?: string;
  save?: Save;
  logChange: (body: Record<string, unknown>) => Promise<string | null>;
  deleteChange?: (id: string) => Promise<string | null>;
  filterLabel: string | null;
  /** Anchor of a Resumen link (decisiones-escalar…): selects its filter on arrival. */
  focus?: { id: string; n: number } | null;
}) {
  const { actionResult, actionRows, costCap } = useCampaignActions({
    data,
    actions,
    control,
    changes,
    settings,
    fx,
  });
  const decisions = useDecisions({
    data,
    actions,
    control,
    changes,
    settings,
    fx,
    actionRows: actionResult ? actionRows : null,
    costCapAds,
  });
  const now = useNow();
  const changesPending = changes.data?.status === "pending_migration";
  const changesReady = Boolean(changes.data) && !changesPending;
  const today = control.data
    ? marketingDate(new Date(control.data.generatedAt))
    : marketingDate(now);
  const windowText = periodLabelText(
    {
      from: shiftDate(today, -DECISION_RULES.windowDays),
      to: shiftDate(today, -1),
    },
    today,
  );
  const sourceNotes =
    actionResult?.notes.filter((note) => note !== actionResult.launchNote) ??
    [];
  return (
    <div className={a.acciones}>
      <ActionQueue
        campaigns={decisions.campaigns}
        creatives={decisions.creatives}
        creativesStatus={decisions.creativesStatus}
        creativesError={decisions.creativesError}
        loading={decisions.loading}
        error={decisions.error}
        windowText={windowText}
        canEdit={canEdit}
        changesReady={changesReady}
        changesNote={
          changesPending
            ? "Registro de cambios: pendiente aplicar la migración. No se puede marcar «Hecho» todavía."
            : changes.error
              ? `No se pudo leer el registro de cambios: ${changes.error} «Hecho» no está disponible.`
              : ""
        }
        sourceNotes={sourceNotes}
        logChange={logChange}
        deleteChange={deleteChange}
        now={now}
        focus={focus}
      />
      <CampaignTable
        campaigns={decisions.campaigns}
        loading={decisions.loading}
        error={decisions.error}
        windowText={windowText}
      />
      <div className={`${r.report} ${a.costCap}`}>
        <CostCapControl
          control={costCap}
          loading={actions.loading || control.loading}
          error={actions.error}
          filterLabel={filterLabel}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Cola */

function ActionQueue({
  campaigns,
  creatives,
  creativesStatus,
  creativesError,
  loading,
  error,
  windowText,
  canEdit,
  changesReady,
  changesNote,
  sourceNotes,
  logChange,
  deleteChange,
  now,
  focus,
}: {
  campaigns: CampaignDecision[] | null;
  creatives: ReturnType<typeof useDecisions>["creatives"];
  creativesStatus: "ready" | "loading" | "unavailable";
  creativesError: string;
  loading: boolean;
  error: string;
  windowText: string;
  canEdit: boolean;
  changesReady: boolean;
  changesNote: string;
  sourceNotes: string[];
  logChange: (body: Record<string, unknown>) => Promise<string | null>;
  deleteChange?: (id: string) => Promise<string | null>;
  now: Date;
  focus: { id: string; n: number } | null;
}) {
  const [filters, setFilters] = useState<QueueFilter[]>(
    () => filterFromAnchor(focus?.id) ?? ["todas"],
  );
  // A Resumen link lands on its filter (also when Acciones is already open).
  useEffect(() => {
    const next = filterFromAnchor(focus?.id);
    if (next) setFilters(next);
  }, [focus?.id, focus?.n]);
  // "Hecho" of this session: shown at once and kept in place until reload.
  const [local, setLocal] = useState<
    Record<string, { at: string; action: DoneAction }>
  >({});
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState<{ key: string; text: string } | null>(
    null,
  );
  const sessionKeys = useMemo(() => new Set(Object.keys(local)), [local]);
  const queue = useMemo(() => {
    if (!campaigns) return null;
    const items = buildActionQueue({
      campaigns,
      creatives,
      keepInPlace: sessionKeys,
    });
    return items.map((item) =>
      !item.done && local[item.key]
        ? {
            ...item,
            done: {
              action: local[item.key].action,
              at: local[item.key].at,
              by: null,
              id: null,
              adId: item.adId,
            },
          }
        : item,
    );
  }, [campaigns, creatives, sessionKeys, local]);
  const counts = useMemo(() => (queue ? queueCounts(queue) : null), [queue]);
  const visible = queue ? filterQueue(queue, filters) : [];
  const showCostCapNote =
    creativesStatus !== "ready" &&
    (filters.includes("costcap") || filters.includes("todas"));

  async function markDone(item: QueueItem) {
    setBusy(item.key);
    setFailure(null);
    const at = new Date();
    const result = await logChange(markDonePayload(item, at));
    setBusy("");
    if (result) setFailure({ key: item.key, text: result });
    else
      setLocal((current) => ({
        ...current,
        [item.key]: { at: at.toISOString(), action: item.kind as DoneAction },
      }));
  }
  async function undo(item: QueueItem) {
    if (!item.done?.id || !deleteChange) return;
    setBusy(item.key);
    setFailure(null);
    const result = await deleteChange(item.done.id);
    setBusy("");
    if (result) setFailure({ key: item.key, text: result });
    else
      setLocal((current) => {
        const next = { ...current };
        delete next[item.key];
        return next;
      });
  }

  let lastGroup = "";
  return (
    <section className={rs.card} aria-labelledby="cola-title">
      {/* Resumen links: each anchor opens the queue with its filter. */}
      <span id="decisiones-escalar" className={a.anchor} />
      <span id="decisiones-bajar" className={a.anchor} />
      <span id="decisiones-costcap" className={a.anchor} />
      <div className={rs.cardHead}>
        <h2 id="cola-title">Cola de acciones</h2>
        <p>
          CPA real del {windowText} (3 días completos) · ordenada por impacto
        </p>
      </div>
      <div
        className={a.chips}
        role="group"
        aria-label="Filtrar la cola de acciones"
      >
        {QUEUE_FILTERS.map(([key, label]) => {
          const pressed =
            filters.includes(key) ||
            (key === "todas" && !filters.length);
          const n =
            key === "costcap" && creativesStatus !== "ready"
              ? null
              : (counts?.[key] ?? null);
          return (
            <button
              key={key}
              type="button"
              className={a.chip}
              aria-pressed={pressed}
              onClick={() => setFilters([key])}
            >
              {key !== "todas" && key !== "alertas" && (
                <span className={a.chipIcon}>
                  {KIND_ICON[key as QueueKind]}
                </span>
              )}
              {key === "alertas" && (
                <span className={a.chipIcon}>
                  <CircleAlert aria-hidden="true" />
                </span>
              )}
              {label}
              <span className={a.chipCount}>
                {n == null ? "…" : count(n)}
              </span>
            </button>
          );
        })}
      </div>
      {changesNote && (
        <p className={a.note} role="status">
          {changesNote}
        </p>
      )}
      {sourceNotes.map((note) => (
        <p key={note} className={a.note} role="alert">
          {note}
        </p>
      ))}
      {loading && !queue ? (
        <p role="status" className={rs.quiet}>
          Consultando campañas y pedidos reales…
        </p>
      ) : !queue ? (
        <p role="alert" className={a.note}>
          {error || "No se pudieron evaluar las campañas."}
        </p>
      ) : (
        <div className={a.queueWrap}>
          <table className={a.queue}>
            <caption className="sr-only">
              Cola de acciones, ordenada por impacto
            </caption>
            <thead>
              <tr>
                <th scope="col">Campaña</th>
                <th scope="col">Acción y porqué</th>
                <th scope="col" className={a.num}>
                  CPA real 3d
                </th>
                <th scope="col" className={a.num}>
                  Pedidos 3d
                </th>
                <th scope="col" className={a.num}>
                  Gasto 3d
                </th>
                <th scope="col">Presupuesto</th>
                <th scope="col">Impacto</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const group = sessionKeys.has(item.key)
                  ? queueGroup({ ...item, done: null })
                  : queueGroup(item);
                const header =
                  group !== lastGroup && group !== "pendiente" ? (
                    <tr key={`${group}-head`} className={a.groupRow}>
                      <th colSpan={8} scope="rowgroup">
                        {group === "espera"
                          ? "Sin acción hoy"
                          : "Hechas (últimas 72 h)"}
                      </th>
                    </tr>
                  ) : null;
                lastGroup = group;
                return [
                  header,
                  <QueueRow
                    key={item.key}
                    item={item}
                    now={now}
                    canMark={canMarkDone(item, { canEdit, changesReady })}
                    canEdit={canEdit}
                    busy={busy === item.key}
                    disabled={Boolean(busy)}
                    failure={failure?.key === item.key ? failure.text : ""}
                    onDone={() => markDone(item)}
                    onUndo={
                      deleteChange &&
                      item.done?.id &&
                      canEdit &&
                      now.getTime() - Date.parse(item.done.at) <
                        UNDO_MINUTES * 60_000
                        ? () => undo(item)
                        : undefined
                    }
                  />,
                ];
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={8} className={a.empty}>
                    {emptyText(filters)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {showCostCapNote && (
        <p className={rs.quiet} role="status">
          {creativesStatus === "loading"
            ? "Pasar a COST CAP: consultando anuncios de los últimos 3 días…"
            : `Pasar a COST CAP: ${creativesError || "anuncios no disponibles."}`}
        </p>
      )}
      <p className={rs.foot}>
        Impacto: apagar y bajar, gasto sobre la meta (gasto − pedidos reales ×{" "}
        {usd(DECISION_RULES.targetCpaUsd)}); escalar y COST CAP, pedidos extra
        con +{Math.round(DECISION_RULES.scaleStep * 100)} % si el CPA se
        mantiene. Por campaña (las fuentes no traen conjuntos de anuncios; una
        ABO se evalúa entera). Pedidos con ≈: reparto por producto. Hoy solo
        avisa. «Hecho» queda en el registro de cambios: un presupuesto tocado
        no se escala en {count(DECISION_RULES.learningHours)} h.
      </p>
    </section>
  );
}

function emptyText(filters: QueueFilter[]) {
  const f = filters[0] ?? "todas";
  if (f === "escalar")
    return `Ninguna campaña con CPA real ≤ ${usd(DECISION_RULES.targetCpaUsd)} y ${count(DECISION_RULES.scaleMinRealOrders)} o más pedidos reales.`;
  if (f === "bajar" || f === "apagar")
    return filters.length > 1
      ? "Ninguna campaña para bajar o apagar."
      : f === "bajar"
        ? `Ninguna campaña con CPA real entre ${usd(DECISION_RULES.targetCpaUsd)} y ${usd(DECISION_RULES.lowerMaxCpaUsd)}.`
        : "Ninguna campaña para apagar.";
  if (f === "costcap")
    return `Ningún anuncio con más de ${count(DECISION_RULES.costCapMoreThanOrders)} pedidos reales y CPA real menor a ${usd(DECISION_RULES.costCapMaxCpaUsd)}.`;
  if (f === "aprendizaje") return "Ninguna campaña en aprendizaje.";
  if (f === "alertas") return "Ninguna alerta de hoy.";
  return "Nada que tocar hoy.";
}

export function ActionTag({ kind, label }: { kind: QueueKind; label: string }) {
  return (
    <span className={rs.status} data-tone={KIND_TONE[kind]}>
      {KIND_ICON[kind]}
      {label}
    </span>
  );
}

function Platform({
  platform,
  account,
}: {
  platform: "meta" | "tiktok";
  account: string;
}) {
  return (
    <span className={a.platform}>
      <span className={a.swatch} data-platform={platform} aria-hidden="true" />
      {platform === "meta" ? "Meta" : "TikTok"} · {account}
    </span>
  );
}

/**
 * Where the 3-day real CPA falls against the rules: a thin track with the
 * three zones (≤ meta, hasta 11, más) and a dot. The number beside it is the
 * value; the mark only places it.
 */
function CpaMarker({ cpa }: { cpa: number | null }) {
  const rules = DECISION_RULES;
  const max = rules.lowerMaxCpaUsd * 1.5;
  if (cpa == null) return null;
  const at = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <span
      className={a.marker}
      aria-hidden="true"
      style={
        {
          "--mk-at-target": at(rules.targetCpaUsd),
          "--mk-at-lower": at(rules.lowerMaxCpaUsd),
        } as CSSProperties
      }
    >
      <span className={a.markerDot} style={{ left: at(cpa) }} />
    </span>
  );
}

function BudgetCell({ item }: { item: QueueItem }) {
  if (item.kind === "costcap")
    return (
      <>
        Nueva COST CAP
        <small>puja {usd(DECISION_RULES.targetCpaUsd)}</small>
      </>
    );
  if (item.budget == null)
    return item.kind === "escalar" || item.kind === "bajar" ? (
      <>
        {item.kind === "escalar" ? "+" : "−"}
        {Math.round(
          (item.kind === "escalar"
            ? DECISION_RULES.scaleStep
            : DECISION_RULES.reduceStep) * 100,
        )}{" "}
        %<small>sin presupuesto en la fuente</small>
      </>
    ) : (
      <span className={a.dim}>—</span>
    );
  if (item.kind === "apagar")
    return (
      <span className={a.budget}>
        <span>{budgetText(item.budget, item.currency)} →</span>{" "}
        <strong>pausar</strong>
      </span>
    );
  if (item.suggestedBudget == null)
    return <>{budgetText(item.budget, item.currency)}/día</>;
  return (
    <span className={a.budget}>
      <span>{budgetText(item.budget, item.currency)} →</span>{" "}
      <strong>{budgetText(item.suggestedBudget, item.currency)}</strong>
    </span>
  );
}

function QueueRow({
  item,
  now,
  canMark,
  canEdit,
  busy,
  disabled,
  failure,
  onDone,
  onUndo,
}: {
  item: QueueItem;
  now: Date;
  canMark: boolean;
  canEdit: boolean;
  busy: boolean;
  disabled: boolean;
  failure: string;
  onDone: () => void;
  onUndo?: () => void;
}) {
  const approx = item.approximate ? "≈ " : "";
  return (
    <tr className={a.row} data-done={item.done ? "true" : undefined}>
      <th scope="row" className={a.nameCell}>
        <span className={a.name} title={item.name}>
          {item.name}
        </span>
        <span className={a.meta}>
          <Platform platform={item.platform} account={item.accountLabel} />
          {item.product && <span className={a.sub}>· {item.product}</span>}
        </span>
        {item.campaignName && (
          <small className={a.level} title={item.campaignName}>
            en {item.campaignName}
          </small>
        )}
        {item.levelNote && <small className={a.level}>{item.levelNote}</small>}
      </th>
      <td className={a.actionCell}>
        <ActionTag kind={item.kind} label={item.label} />
        <span className={a.why}>{item.why}</span>
        {item.todayAlert && (
          <span className={`${r.riskBadge} ${a.todayFlag}`}>
            <CircleAlert aria-hidden="true" />
            {item.todayAlert}
          </span>
        )}
      </td>
      <td className={a.num} data-label="CPA real 3d">
        <span className={a.value}>
          {item.cpaReal == null ? (
            <span className={a.dim}>Sin pedidos</span>
          ) : (
            `${approx}${usd(item.cpaReal)}`
          )}
        </span>
        <CpaMarker cpa={item.cpaReal} />
      </td>
      <td className={a.num} data-label="Pedidos 3d">
        {item.real == null ? "Sin datos" : `${approx}${ordersText(item.real)}`}
      </td>
      <td className={a.num} data-label="Gasto 3d">
        {usd(item.spendUsd)}
      </td>
      <td className={a.budgetCell} data-label="Presupuesto">
        <BudgetCell item={item} />
      </td>
      <td className={a.impact} data-label="Impacto">
        {item.impactText ?? <span className={a.dim}>—</span>}
      </td>
      <td className={a.stateCell} data-label="Estado">
        {item.done ? (
          <span className={a.done}>
            <span className={a.doneText}>
              <CircleCheck aria-hidden="true" />
              Hecho
            </span>
            <small>
              {agoText(item.done.at, now)}
              {item.done.by ? ` · por ${item.done.by}` : ""}
            </small>
            {item.learningUntil && item.kind === "escalar" && (
              <small>{learningUntilText(item.learningUntil)}</small>
            )}
            {onUndo && (
              <button
                type="button"
                className={a.link}
                onClick={onUndo}
                disabled={disabled}
              >
                {busy ? "Deshaciendo…" : "Deshacer"}
              </button>
            )}
          </span>
        ) : canMark ? (
          <button
            type="button"
            className={a.doneButton}
            onClick={onDone}
            disabled={disabled}
            aria-label={`Marcar hecho: ${item.label} en ${item.name}`}
            title="Lo anota en el registro de cambios con la hora de ahora."
          >
            <Check aria-hidden="true" />
            {busy ? "Guardando…" : "Hecho"}
          </button>
        ) : item.actionable ? (
          <span className={a.dim}>{canEdit ? "No disponible" : "Pendiente"}</span>
        ) : item.learningUntil ? (
          <small className={a.dim}>
            {learningUntilText(item.learningUntil)}
          </small>
        ) : (
          <span className={a.dim}>—</span>
        )}
        {failure && (
          <small role="alert" className={a.failure}>
            {failure}
          </small>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------ Campañas */

type SortKey = "gasto" | "cpa" | "pedidos";
const SORT_LABEL: Record<SortKey, string> = {
  gasto: "Gasto 3d",
  pedidos: "Pedidos 3d",
  cpa: "CPA real 3d",
};

function sortValue(d: CampaignDecision, key: SortKey): number | null {
  if (key === "gasto") return d.window.spendUsd;
  if (key === "pedidos") return d.window.real;
  return d.window.cpaReal;
}

function CampaignTable({
  campaigns,
  loading,
  error,
  windowText,
}: {
  campaigns: CampaignDecision[] | null;
  loading: boolean;
  error: string;
  windowText: string;
}) {
  const [account, setAccount] = useState("");
  const [platform, setPlatform] = useState<"" | "meta" | "tiktok">("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "gasto",
    desc: true,
  });
  const [limit, setLimit] = useState(PAGE);
  const accounts = useMemo(
    () =>
      Array.from(new Set((campaigns ?? []).map((c) => c.accountLabel))).sort(
        (x, y) => x.localeCompare(y, "es"),
      ),
    [campaigns],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    return (campaigns ?? [])
      .filter(
        (c) =>
          (!account || c.accountLabel === account) &&
          (!platform || c.platform === platform) &&
          (!q ||
            `${c.name} ${c.product ?? ""}`
              .toLocaleLowerCase("es")
              .includes(q)),
      )
      .sort((x, y) => {
        const vx = sortValue(x, sort.key),
          vy = sortValue(y, sort.key);
        // Unknown values (no orders, no data) always go last.
        if (vx == null || vy == null)
          return vx == null && vy == null
            ? x.name.localeCompare(y.name, "es")
            : vx == null
              ? 1
              : -1;
        return (sort.desc ? vy - vx : vx - vy) || x.name.localeCompare(y.name, "es");
      });
  }, [campaigns, account, platform, query, sort]);
  const shown = rows.slice(0, limit);
  const header = (key: SortKey) => {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        className={a.num}
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          className={a.sort}
          onClick={() =>
            setSort((s) =>
              s.key === key
                ? { key, desc: !s.desc }
                : { key, desc: key !== "cpa" },
            )
          }
        >
          {SORT_LABEL[key]}
          {active ? (
            sort.desc ? (
              <ArrowDown aria-hidden="true" />
            ) : (
              <ArrowUp aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown aria-hidden="true" className={a.dimIcon} />
          )}
        </button>
      </th>
    );
  };
  return (
    <section className={rs.card} aria-labelledby="campanas-title">
      <div className={rs.cardHead}>
        <h2 id="campanas-title">Campañas activas</h2>
        <p>Del {windowText} · USD · con la decisión de cada una</p>
      </div>
      <div className={a.filters}>
        <label className={a.field}>
          Cuenta
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setLimit(PAGE);
            }}
          >
            <option value="">Todas</option>
            {accounts.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={a.field}>
          Plataforma
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value as "" | "meta" | "tiktok");
              setLimit(PAGE);
            }}
          >
            <option value="">Meta y TikTok</option>
            <option value="meta">Meta</option>
            <option value="tiktok">TikTok</option>
          </select>
        </label>
        <label className={`${a.field} ${a.search}`}>
          Buscar
          <input
            type="search"
            value={query}
            placeholder="Campaña o producto"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
        </label>
      </div>
      {loading && !campaigns ? (
        <p role="status" className={rs.quiet}>
          Consultando campañas…
        </p>
      ) : !campaigns ? (
        <p role="alert" className={a.note}>
          {error || "No se pudieron consultar las campañas."}
        </p>
      ) : (
        <>
          <div
            className={a.tableWrap}
            tabIndex={0}
            role="region"
            aria-label="Campañas activas"
          >
            <table className={a.campaigns}>
              <thead>
                <tr>
                  <th scope="col">Campaña</th>
                  <th scope="col">Tipo</th>
                  {header("gasto")}
                  {header("pedidos")}
                  {header("cpa")}
                  <th scope="col" className={a.num}>
                    Presupuesto/día
                  </th>
                  <th scope="col">Decisión</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const kind = DECISION_KIND[c.action];
                  const approx = c.approximate ? "≈ " : "";
                  return (
                    <tr key={c.key}>
                      <th scope="row" className={a.nameCell}>
                        <span className={a.name} title={c.name}>
                          {c.name}
                        </span>
                        <span className={a.meta}>
                          <Platform
                            platform={c.platform}
                            account={c.accountLabel}
                          />
                          <span className={a.sub}>
                            · {c.product ?? "Sin producto"}
                          </span>
                        </span>
                      </th>
                      <td>
                        <span className={a.type}>{c.type}</span>
                      </td>
                      <td className={a.num}>{usd(c.window.spendUsd)}</td>
                      <td className={a.num}>
                        {c.window.real == null
                          ? "Sin datos"
                          : `${approx}${ordersText(c.window.real)}`}
                      </td>
                      <td className={a.num}>
                        <span className={a.value}>
                          {c.window.cpaReal == null ? (
                            <span className={a.dim}>—</span>
                          ) : (
                            `${approx}${usd(c.window.cpaReal)}`
                          )}
                        </span>
                        <CpaMarker cpa={c.window.cpaReal} />
                      </td>
                      <td className={a.num}>
                        {c.dailyBudget == null ? (
                          <span className={a.dim}>—</span>
                        ) : (
                          budgetText(c.dailyBudget, c.currency)
                        )}
                      </td>
                      <td title={c.detail}>
                        {kind ? (
                          <ActionTag kind={kind} label={c.label} />
                        ) : (
                          <span className={rs.status} data-tone="neutral">
                            <span className={rs.dash} aria-hidden="true" />
                            {c.label}
                          </span>
                        )}
                        {c.done && (
                          <small className={a.doneSmall}>
                            <CircleCheck aria-hidden="true" />
                            Hecho
                          </small>
                        )}
                        {c.todayAlert && (
                          <small className={a.alertSmall}>
                            <CircleAlert aria-hidden="true" />
                            Alerta de hoy
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={7} className={a.empty}>
                      {campaigns.length
                        ? "No hay campañas que coincidan."
                        : "Sin campañas activas con gasto."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={a.pager}>
            <span>
              {count(Math.min(limit, rows.length))} de {count(rows.length)}{" "}
              campañas
            </span>
            {rows.length > limit && (
              <button
                type="button"
                className={a.link}
                onClick={() => setLimit((n) => n + PAGE)}
              >
                Mostrar {count(Math.min(PAGE, rows.length - limit))} más
              </button>
            )}
          </div>
        </>
      )}
      <p className={rs.foot}>
        Solo campañas activas o con gasto reciente. Pausadas, presupuesto,
        puja y el historial de cambios: Detalle › Reporte completo.
      </p>
    </section>
  );
}
