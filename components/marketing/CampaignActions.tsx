"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  launchText,
  ordersText,
  type CampaignActionRow,
  type SuggestedAction,
  type buildCampaignActionRows,
} from "@/lib/marketing-actions";
import type { Coverage } from "@/lib/marketing-coverage";
import type { AccountLabel } from "@/lib/marketing-settings-types";
import type { CampaignChange } from "@/lib/marketing-source-types";
import { MARKETING_TARGETS } from "@/lib/marketing-targets";
import { count, dateTimeCr, money } from "./format";
import r from "./team-report.module.css";

type Save = (key: string, body: Record<string, unknown>) => Promise<boolean>;
type Result = ReturnType<typeof buildCampaignActionRows>;
type LogChange = (body: Record<string, unknown>) => Promise<string | null>;

const usd = (value: number | null | undefined) => money(value, "USD");
const t = MARKETING_TARGETS;
const PAGE = 15;
const KINDS: Array<[CampaignChange["kind"], string]> = [
  ["presupuesto", "Presupuesto"],
  ["puja", "Puja"],
  ["creativo", "Creativo"],
  ["estado", "Estado (pausa o activa)"],
  ["lanzamiento", "Lanzamiento"],
  ["otro", "Otro"],
];
const SHORT_LABELS = ["Madre", "CR2", "CR3", "CR4", "CR5"];

const toneChip = (tone: SuggestedAction["tone"]) =>
  tone === "risk"
    ? r.chipRed
    : tone === "good"
      ? r.chipOk
      : tone === "wait"
        ? r.chipYellow
        : r.chipMuted;
const coverageChip = (coverage: Coverage) =>
  coverage.tone === "red"
    ? r.chipRed
    : coverage.tone === "yellow"
      ? r.chipYellow
      : coverage.tone === "ok"
        ? r.chipOk
        : r.chipMuted;

/** "datetime-local" value for now in Costa Rica (UTC−6, no daylight saving). */
const nowCr = () =>
  new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 16);

function lastChangeText(row: CampaignActionRow) {
  const change = row.lastChange;
  if (!change)
    return row.platform === "tiktok"
      ? "Sin registro de cambios (TikTok: solo a mano)"
      : "Sin registro de cambios";
  const source =
    change.source === "manual"
      ? `a mano${change.by ? ` por ${change.by}` : ""}`
      : change.source === "meta"
        ? "Meta"
        : "última edición en Meta";
  return `Último cambio: ${change.kind} · ${dateTimeCr(change.at)} (${source})`;
}

/** "Qué hacer hoy con cada campaña" (módulo 2): Meta and TikTok tables with the suggested action. */
export function CampaignActions({
  result,
  loading,
  error,
  metaAccounts,
  labels,
  labelsError,
  changes,
  canEdit,
  saving,
  save,
  logChange,
}: {
  result: Result | null;
  loading: boolean;
  error: string;
  metaAccounts: Array<{ accountId: string; accountName: string; auto: string }>;
  labels: AccountLabel[];
  labelsError: string;
  changes: { pending: boolean; loading: boolean; error: string };
  canEdit: boolean;
  saving: string;
  save: Save;
  logChange: LogChange;
}) {
  const updatedOnly = result?.meta.some(
    (row) => row.changesStatus === "updated_time",
  );
  return (
    <section className={r.section} aria-labelledby="actions-title">
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>02 / Acciones</p>
          <h2 id="actions-title">Qué hacer hoy con cada campaña</h2>
          <p>
            Gasto, pedidos reales y CPA real de hoy, ayer y los 7 días
            anteriores. Pedidos con ≈: UTM + reparto por producto asignado y
            gasto. Kairo no cambia nada en Meta ni en TikTok.
          </p>
        </div>
      </div>
      {loading && !result ? (
        <p role="status">Consultando campañas y cambios…</p>
      ) : !result ? (
        <p role="alert" className={r.risk}>
          {error || "No se pudieron consultar las campañas."}
        </p>
      ) : (
        <>
          {result.notes
            .filter(
              (note) =>
                note !== result.launchNote && note !== result.unavailable.meta,
            )
            .map((note) => (
              <p
                key={note}
                role="alert"
                className={`${r.banner} ${r.bannerRisk}`}
              >
                {note}
              </p>
            ))}
          {changes.pending && (
            <p className={r.banner}>
              Registro de cambios: pendiente aplicar la migración. Las reglas
              usan solo los cambios de Meta.
            </p>
          )}
          {changes.error && !changes.pending && (
            <p className={r.banner}>
              No se pudo leer el registro de cambios a mano. {changes.error}
            </p>
          )}
          {updatedOnly && (
            <p className={r.banner}>
              Cambios según la última edición en Meta (sin detalle).
            </p>
          )}
          <ActionTable
            title="Meta"
            rows={result.meta}
            unavailable={result.unavailable.meta}
            canEdit={canEdit && !changes.pending}
            logChange={logChange}
            header={
              canEdit && metaAccounts.length > 0 ? (
                <AccountLabels
                  accounts={metaAccounts}
                  labels={labels}
                  error={labelsError}
                  saving={saving}
                  save={save}
                />
              ) : null
            }
          />
          <ActionTable
            title="TikTok"
            rows={result.tiktok}
            unavailable={result.unavailable.tiktok}
            canEdit={canEdit && !changes.pending}
            logChange={logChange}
            header={
              <>
                <p
                  className={`${r.banner} ${result.launchLimitReached ? r.bannerRisk : ""}`}
                  role={result.launchLimitReached ? "alert" : undefined}
                >
                  {result.launchNote}
                </p>
                <p className={r.caption}>
                  TikTok: montos en soles; los datos llegan al día siguiente por
                  Make. Sin presupuesto, puja ni estado desde Make. Registra los
                  lanzamientos a mano con «Registrar cambio».
                </p>
              </>
            }
          />
          <Rules />
        </>
      )}
    </section>
  );
}

function ActionTable({
  title,
  rows,
  unavailable,
  canEdit,
  logChange,
  header,
}: {
  title: string;
  rows: CampaignActionRow[];
  /** The source failed: say so instead of "no campaigns". */
  unavailable: string | null;
  canEdit: boolean;
  logChange: LogChange;
  header: ReactNode;
}) {
  const [account, setAccount] = useState("");
  const [onlyAction, setOnlyAction] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState("");
  const accounts = Array.from(
    new Set(rows.map((row) => row.accountLabel)),
  ).sort();
  const filtered = rows.filter(
    (row) =>
      (!account || row.accountLabel === account) &&
      (!onlyAction || !["mantener", "pausada"].includes(row.action.code)) &&
      `${row.name} ${row.product?.name ?? ""}`
        .toLocaleLowerCase("es")
        .includes(query.toLocaleLowerCase("es")),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE)),
    current = Math.min(page, pages - 1),
    visible = filtered.slice(current * PAGE, current * PAGE + PAGE);
  return (
    <div className={r.account}>
      <h3>{title}</h3>
      {unavailable && (
        <p role="alert" className={`${r.banner} ${r.bannerRisk}`}>
          {unavailable}
        </p>
      )}
      {header}
      <div className={r.filters}>
        <label className={r.field}>
          Cuenta
          <select
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPage(0);
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
        <label className={r.field}>
          Buscar campaña
          <input
            type="search"
            value={query}
            placeholder="Campaña o producto"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className={r.check}>
          <input
            type="checkbox"
            checked={onlyAction}
            onChange={(e) => {
              setOnlyAction(e.target.checked);
              setPage(0);
            }}
          />
          Solo con acción
        </label>
      </div>
      <div
        className={r.tableWrap}
        tabIndex={0}
        role="region"
        aria-label={`Acciones por campaña · ${title}`}
      >
        <table className={r.actionsTable}>
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Cuenta</th>
              <th>Hoy</th>
              <th>Ayer</th>
              <th>7 días</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <ActionRow
                key={row.key}
                row={row}
                canEdit={canEdit}
                editing={editing === row.key}
                onEdit={(open) => setEditing(open ? row.key : "")}
                logChange={logChange}
              />
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={6}>
                  {rows.length
                    ? "No hay campañas que coincidan."
                    : unavailable
                      ? `Sin datos de ${title}.`
                      : "Sin campañas con gasto en los últimos 14 días."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={r.pagination}>
        <p>{count(filtered.length)} campañas</p>
        <button
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
          aria-label={`Campañas anteriores de ${title}`}
        >
          ←
        </button>
        <span>
          {current + 1} / {pages}
        </span>
        <button
          disabled={current === pages - 1}
          onClick={() => setPage(current + 1)}
          aria-label={`Campañas siguientes de ${title}`}
        >
          →
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  row,
  canEdit,
  editing,
  onEdit,
  logChange,
}: {
  row: CampaignActionRow;
  canEdit: boolean;
  editing: boolean;
  onEdit: (open: boolean) => void;
  logChange: LogChange;
}) {
  const launch = launchText(row);
  const members =
    row.coverage && "members" in row.coverage
      ? (
          row.coverage as Coverage & {
            members: Array<{ key: string; sku: string; coverage: Coverage }>;
          }
        ).members
      : [];
  return (
    <>
      <tr>
        <th scope="row">
          {row.name}
          <div className={r.chips}>
            <span className={r.chip}>{row.type}</span>
            {row.status && row.status !== "activa" && (
              <span className={`${r.chip} ${r.chipMuted}`}>
                {row.status === "pausada" ? "Pausada" : "Inactiva"}
              </span>
            )}
            {row.coverage && (
              <span
                className={`${r.chip} ${coverageChip(row.coverage)}`}
                title={members
                  .map((m) => `${m.sku || m.key}: ${m.coverage.label}`)
                  .join("\n")}
              >
                Stock: {row.coverage.label}
              </span>
            )}
          </div>
          <small>
            {row.product ? row.product.name : "Sin producto asignado"}
            {row.product &&
              ` · ${row.product.automatic ? `Automático · ${row.product.reason}` : row.product.reason}`}
          </small>
          {row.dailyBudget != null && (
            <small>
              Presupuesto {money(row.dailyBudget, row.currency)}/día
            </small>
          )}
          {row.bid != null ? (
            <small>Puja {money(row.bid, row.currency)}</small>
          ) : row.bidMixed ? (
            <small>Puja: varias en los conjuntos</small>
          ) : null}
          {launch && <small>{launch}</small>}
          {row.restocked != null && row.restocked > 0 && (
            <small>Entró stock: +{count(row.restocked)} u.</small>
          )}
        </th>
        <td>{row.accountLabel}</td>
        <WindowCell row={row} w={row.today} />
        <WindowCell row={row} w={row.yesterday} />
        <WindowCell row={row} w={row.days7} />
        <td className={r.actionCell}>
          <span className={`${r.chip} ${toneChip(row.action.tone)}`}>
            {row.action.label}
          </span>
          <p>{row.action.detail}</p>
          {row.action.due && (
            <small>Se puede tocar desde el {dateTimeCr(row.action.due)}</small>
          )}
          {row.notes.map((note) => (
            <small key={`${note.code}:${note.detail}`}>
              {note.label}: {note.detail}
              {note.due ? ` (${dateTimeCr(note.due)})` : ""}
            </small>
          ))}
          <small>{lastChangeText(row)}</small>
          {canEdit && !editing && (
            <button
              className="mt-2"
              onClick={() => onEdit(true)}
              aria-label={`Registrar cambio en ${row.name}`}
            >
              Registrar cambio
            </button>
          )}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6}>
            <ChangeForm
              row={row}
              onClose={() => onEdit(false)}
              logChange={logChange}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function WindowCell({
  row,
  w,
}: {
  row: CampaignActionRow;
  w: CampaignActionRow["today"];
}) {
  const tiktok = row.platform === "tiktok";
  const spend = tiktok ? money(w.spendNative, row.currency) : usd(w.spendUsd);
  return (
    <td>
      {w.spendNative == null && tiktok ? "Sin datos" : spend}
      {tiktok && w.spendUsd != null && row.currency !== "USD" && (
        <small>{usd(w.spendUsd)}</small>
      )}
      <small>
        {w.real == null
          ? "Pedidos reales: sin datos"
          : `${w.real !== w.utm ? "≈ " : ""}${ordersText(w.real)} pedidos reales${w.partial ? " (parcial)" : ""}`}
      </small>
      <small>CPA real {usd(w.cpaReal)}</small>
      <small>
        píxel: {w.pixel == null ? "sin datos" : count(w.pixel)} ·{" "}
        {usd(w.cpaPixel)}
      </small>
    </td>
  );
}

function ChangeForm({
  row,
  onClose,
  logChange,
}: {
  row: CampaignActionRow;
  onClose: () => void;
  logChange: LogChange;
}) {
  const [kind, setKind] = useState<CampaignChange["kind"]>("presupuesto");
  const [at, setAt] = useState(nowCr);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const failure = await logChange({
      platform: row.platform,
      account_id: row.accountId,
      campaign_id: row.campaignId,
      campaign_name: row.name.slice(0, 300),
      product_key: row.product?.key ?? null,
      kind,
      detail: detail.trim(),
      changed_at: new Date(`${at}:00-06:00`).toISOString(),
    });
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  }
  return (
    <form className={r.changeForm} onSubmit={submit}>
      <label className={r.field}>
        Tipo de cambio
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as CampaignChange["kind"])}
        >
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={r.field}>
        Fecha y hora (Costa Rica)
        <input
          type="datetime-local"
          value={at}
          max={nowCr()}
          required
          onChange={(e) => setAt(e.target.value)}
        />
      </label>
      <label className={r.field}>
        Detalle
        <input
          type="text"
          maxLength={200}
          value={detail}
          placeholder="Ej.: presupuesto 50 → 60"
          onChange={(e) => setDetail(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy || !at}>
        {busy ? "Guardando…" : "Guardar cambio"}
      </button>
      <button type="button" disabled={busy} onClick={onClose}>
        Cancelar
      </button>
      {error && (
        <small role="alert" className={r.risk}>
          {error}
        </small>
      )}
    </form>
  );
}

function AccountLabels({
  accounts,
  labels,
  error,
  saving,
  save,
}: {
  accounts: Array<{ accountId: string; accountName: string; auto: string }>;
  labels: AccountLabel[];
  error: string;
  saving: string;
  save: Save;
}) {
  return (
    <details className={r.rules}>
      <summary>Nombre corto de la cuenta (Madre, CR2…CR5)</summary>
      {error && <p className={r.caption}>{error}</p>}
      <div className={r.filters}>
        {accounts.map((account) => {
          const manual =
            labels.find(
              (l) =>
                l.platform === "meta" && l.account_id === account.accountId,
            )?.label ?? "";
          const options =
            manual && !SHORT_LABELS.includes(manual)
              ? [...SHORT_LABELS, manual]
              : SHORT_LABELS;
          return (
            <label key={account.accountId} className={r.field}>
              {account.accountName}
              <select
                value={manual}
                disabled={Boolean(saving)}
                onChange={(e) =>
                  save(`label:${account.accountId}`, {
                    kind: "account_label",
                    platform: "meta",
                    account_id: account.accountId,
                    label: e.target.value || null,
                  })
                }
              >
                <option value="">Automático ({account.auto})</option>
                {options.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </details>
  );
}

function Rules() {
  const pen = (value: number) => money(value, "PEN");
  const rules: Array<[string, string]> = [
    [
      `Prueba en Meta: ${usd(t.metaTestKillUsd)} gastados sin venta (campaña con gasto)`,
      "Apagar",
    ],
    [
      `Prueba en Meta: llega a ${usd(t.metaTestPassUsd)} con ${t.metaTestPassOrders} o más pedidos reales`,
      "Pasó la prueba",
    ],
    [`Prueba en TikTok: ${pen(t.tiktokTestKillPen)} sin venta`, "Apagar"],
    [
      `Prueba en TikTok: llega a ${pen(t.tiktokTestPassPen)} con ${t.tiktokTestPassOrders} o más pedidos reales`,
      "Pasó la prueba",
    ],
    [
      `CPA real de 3 días > ${usd(t.cpaUsd)}, o ${usd(t.cpaUsd)} o más de gasto sin pedidos reales`,
      "CPA alto",
    ],
    [
      `CPA real de 3 días ≤ ${usd(t.cpaUsd)} y último cambio hace ${t.holdHours} h o más`,
      `Escalar +${Math.round(t.scaleStep * 100)}% (con la fecha en que toca)`,
    ],
    [
      `Cambio de presupuesto, puja o creativo hace menos de ${t.holdHours} h (mínimo ${t.holdMinHours} h)`,
      "En espera, no tocar",
    ],
    [
      `El producto tiene menos de ${t.stockRedDays} días de stock`,
      "Pausar por stock",
    ],
    [
      "Campaña pausada por stock (gastó en los últimos 7 días, sin CPA alto) y el producto recibió stock",
      "Reactivar",
    ],
    [
      `Ya se lanzaron ${t.tiktokLaunchesPerDay} productos hoy en TikTok`,
      "Aviso: límite de lanzamientos alcanzado",
    ],
  ];
  return (
    <details className={r.rules}>
      <summary>Reglas que aplica la tabla</summary>
      <div
        className={r.tableWrap}
        tabIndex={0}
        role="region"
        aria-label="Reglas"
      >
        <table>
          <thead>
            <tr>
              <th>Regla</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(([rule, action]) => (
              <tr key={rule}>
                <td>{rule}</td>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={r.caption}>
        Pruebas: campañas lanzadas hace {t.testMaxAgeDays} días o menos. Sin
        producto asignado no hay pedidos reales ni stock: la acción pide
        asignarlo. CPA real = gasto / pedidos reales (sin anulados).
      </p>
    </details>
  );
}
