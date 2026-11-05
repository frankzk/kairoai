"use client";
import { useMemo, useState } from "react";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { AccountsPayload } from "@/lib/marketing-insights-types";
import {
  accountStatusRows,
  appliedRates,
  appliedRateText,
  referenceText,
  type AccountTone,
  type AppliedRate,
} from "@/lib/marketing-account-status";
import { marketingDate } from "@/lib/marketing-dates";
import { MARKETING_FX_REFERENCE } from "@/lib/marketing-targets";
import { dateTimeCr } from "./format";
import r from "./team-report.module.css";

type Resource<T> = { data: T | null; loading: boolean; error: string };

export const TONE_CHIP: Record<AccountTone, string> = {
  risk: r.chipRed,
  wait: r.chipYellow,
  good: r.chipOk,
};

/** Rows and problems of the account status, shared by the panel and the report banner. */
export function useAccountStatus(
  accounts: Resource<AccountsPayload>,
  settings: MarketingSettings | null,
) {
  return useMemo(
    () =>
      accounts.data
        ? accountStatusRows({
            meta: accounts.data.meta,
            metaError: accounts.data.metaError,
            tiktok: accounts.data.tiktok,
            tiktokError: accounts.data.tiktokError,
            labels: settings?.accountLabels ?? [],
            today: marketingDate(new Date(accounts.data.checkedAt)),
          })
        : null,
    [accounts.data, settings],
  );
}

function RateLine({
  rate,
  canEdit,
  busy,
  onSave,
}: {
  rate: AppliedRate;
  canEdit: boolean;
  busy: boolean;
  onSave: (value: number | null) => void;
}) {
  const fixed = rate.source === "manual";
  return (
    <li className={r.statusRow}>
      <div>
        <strong>
          {rate.currency === "CRC" ? "Colones (CRC)" : "Soles (PEN)"}
          {rate.drift && (
            <span className={`${r.chip} ${r.chipYellow} ml-2`}>
              Lejos de la referencia
            </span>
          )}
        </strong>
        <p>{appliedRateText(rate)}</p>
      </div>
      {canEdit && (
        <div className={r.statusActions}>
          {!(fixed && rate.rate === rate.reference) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSave(rate.reference)}
            >
              Usar {referenceText(rate)} fijo
            </button>
          )}
          {fixed && (
            <button type="button" disabled={busy} onClick={() => onSave(null)}>
              Volver a la tasa oficial
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** "Estado de las cuentas" (módulo 11), section 06 of Análisis. */
export function AccountStatus({
  accounts,
  settings,
  fx,
  canEdit,
  saveRate,
}: {
  accounts: Resource<AccountsPayload>;
  settings: MarketingSettings | null;
  /** Rates applied in the dashboard (falls back to the ones of the status read). */
  fx: UsdRate | null;
  canEdit: boolean;
  saveRate: (
    currency: "CRC" | "PEN",
    rate: number | null,
  ) => Promise<string | null>;
}) {
  const status = useAccountStatus(accounts, settings);
  const rates = appliedRates(fx ?? accounts.data?.fx ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>({
    error: false,
    text: "",
  });
  async function save(currency: "CRC" | "PEN", rate: number | null) {
    setBusy(true);
    setMessage({ error: false, text: "" });
    const error = await saveRate(currency, rate);
    setBusy(false);
    setMessage(
      error
        ? { error: true, text: error }
        : {
            error: false,
            text:
              rate == null
                ? `${currency}: de vuelta a la tasa oficial.`
                : `${currency}: tasa fija guardada.`,
          },
    );
  }
  return (
    <section
      id="analisis-cuentas"
      className={r.section}
      aria-labelledby="accounts-title"
    >
      <div className={r.sectionHead}>
        <div>
          <p className={r.kicker}>06 / Estado de las cuentas</p>
          <h2 id="accounts-title">Estado de las cuentas</h2>
          <p>
            Si alguna cuenta está restringida, sin pago o sin datos, y con qué
            tipo de cambio se pasa todo a USD.
          </p>
        </div>
        {accounts.data && (
          <span className={r.period}>
            Consultado {dateTimeCr(accounts.data.checkedAt)}
          </span>
        )}
      </div>
      {accounts.loading && !accounts.data ? (
        <p role="status">Consultando el estado de Meta y TikTok…</p>
      ) : !status ? (
        <p role="alert" className={r.risk}>
          No se pudo consultar el estado de las cuentas.{" "}
          {accounts.error}
        </p>
      ) : (
        <>
          {status.rows.length ? (
            <ul className={r.statusList}>
              {status.rows.map((row) => (
                <li
                  key={`${row.platform}:${row.accountId}`}
                  className={`${r.statusRow} ${row.tone === "risk" ? r.statusRisk : ""}`}
                >
                  <div>
                    <strong>
                      {row.label}
                      {row.name && row.name !== row.label && (
                        <span className={r.statusName}> · {row.name}</span>
                      )}
                    </strong>
                    <p>
                      <b>{row.title}.</b> {row.detail}
                    </p>
                  </div>
                  <span className={`${r.chip} ${TONE_CHIP[row.tone]}`}>
                    {row.state}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={r.alert}>Sin cuentas configuradas.</p>
          )}
          {status.notes.map((note) => (
            <p key={note} className={r.caption}>
              {note}
            </p>
          ))}
        </>
      )}

      <h3 className="mt-6">Tipo de cambio aplicado</h3>
      <ul className={r.statusList}>
        <RateLine
          rate={rates.crc}
          canEdit={canEdit}
          busy={busy}
          onSave={(value) => save("CRC", value)}
        />
        <RateLine
          rate={rates.pen}
          canEdit={canEdit}
          busy={busy}
          onSave={(value) => save("PEN", value)}
        />
      </ul>
      {message.text && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? r.risk : r.caption}
        >
          {message.text}
        </p>
      )}
      <p className={r.caption}>
        Meta cobra en USD; TikTok en soles (PEN); los precios de la tienda en
        colones (CRC). Kairo usa la venta de Hacienda (CRC) y del BCRP (PEN) del
        día, o la tasa fija si alguien la guardó. Referencia del equipo:{" "}
        {referenceText(rates.crc)} CRC y {referenceText(rates.pen)} PEN por
        dólar; se marca cuando la tasa aplicada se aleja más de{" "}
        {MARKETING_FX_REFERENCE.maxDriftPct} %.
      </p>
    </section>
  );
}
