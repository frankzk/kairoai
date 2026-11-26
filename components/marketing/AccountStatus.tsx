"use client";
import { useMemo, useState } from "react";
import type { UsdRate } from "@/lib/marketing-charlie-types";
import type { MarketingSettings } from "@/lib/marketing-settings-types";
import type { AccountsPayload } from "@/lib/marketing-insights-types";
import {
  accountStatusRows,
  appliedRateText,
  rateNumberText,
  referenceText,
  storeRates,
  type AccountTone,
  type AppliedRate,
  type RateCurrency,
} from "@/lib/marketing-account-status";
import { marketingStoreInfo } from "@/lib/marketing-stores";
import { useMarketingStore } from "./MarketingStoreContext";
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
            tiktokNotConnected: accounts.data.tiktokNotConnected,
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
  // HNL has no official source in Kairo: the team types its rate.
  if (rate.reference == null)
    return (
      <TeamRateLine
        rate={rate}
        canEdit={canEdit}
        busy={busy}
        onSave={onSave}
      />
    );
  return (
    <li className={r.statusRow}>
      <div>
        <strong>
          {CURRENCY_NAME[rate.currency]}
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

const CURRENCY_NAME: Record<RateCurrency, string> = {
  CRC: "Colones (CRC)",
  PEN: "Soles (PEN)",
  HNL: "Lempiras (HNL)",
};

/**
 * A currency without an official source in Kairo (HNL): whoever can edit
 * Marketing types the team's rate (HNL per USD, dated today) or removes it.
 * Without one the amounts stay "sin tipo de cambio".
 */
function TeamRateLine({
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
  const [value, setValue] = useState(
    rate.rate == null ? "" : String(rate.rate),
  );
  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 && parsed < 1000;
  return (
    <li className={r.statusRow}>
      <div>
        <strong>
          {CURRENCY_NAME[rate.currency]}
          {rate.rate == null && (
            <span className={`${r.chip} ${r.chipYellow} ml-2`}>
              Sin tipo de cambio
            </span>
          )}
        </strong>
        <p>{appliedRateText(rate)}</p>
      </div>
      {canEdit && (
        <form
          className={r.statusActions}
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSave(parsed);
          }}
        >
          <label>
            <span className="sr-only">
              {rate.currency} por USD (tasa del equipo)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.0001"
              max="999"
              step="0.0001"
              placeholder={`${rate.currency} por USD`}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              style={{ width: "8rem" }}
            />
          </label>
          <button type="submit" disabled={busy || !valid}>
            {rate.rate == null ? "Guardar tasa del equipo" : "Cambiar tasa"}
          </button>
          {rate.rate != null && (
            <button type="button" disabled={busy} onClick={() => onSave(null)}>
              Quitar tasa
            </button>
          )}
        </form>
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
    currency: RateCurrency,
    rate: number | null,
  ) => Promise<string | null>;
}) {
  const status = useAccountStatus(accounts, settings);
  const store = marketingStoreInfo(useMarketingStore());
  const rates = storeRates(fx ?? accounts.data?.fx ?? null, store.currency);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string }>({
    error: false,
    text: "",
  });
  async function save(currency: RateCurrency, rate: number | null) {
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
                ? store.currency === "CRC"
                  ? `${currency}: de vuelta a la tasa oficial.`
                  : `${currency}: tasa quitada, los importes quedan sin tipo de cambio.`
                : `${currency}: tasa fija guardada (${rateNumberText(rate)} por USD).`,
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
        {rates.map((rate) => (
          <RateLine
            key={rate.currency}
            rate={rate}
            canEdit={canEdit}
            busy={busy}
            onSave={(value) => save(rate.currency, value)}
          />
        ))}
      </ul>
      {message.text && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? r.risk : r.caption}
        >
          {message.text}
        </p>
      )}
      {store.currency === "CRC" ? (
        <p className={r.caption}>
          Meta cobra en USD; TikTok en soles (PEN); los precios de la tienda en
          colones (CRC). Kairo usa la venta de Hacienda (CRC) y del BCRP (PEN)
          del día, o la tasa fija si alguien la guardó. Referencia del equipo:{" "}
          {referenceText(rates[0])} CRC y {referenceText(rates[1])} PEN por
          dólar; se marca cuando la tasa aplicada se aleja más de{" "}
          {MARKETING_FX_REFERENCE.maxDriftPct} %.
        </p>
      ) : (
        <p className={r.caption}>
          Los precios de {store.country} van en {store.currency}. Kairo todavía
          no lee una tasa oficial de {store.currency}: usa la tasa del equipo
          que se guarde aquí (quien puede editar Marketing). Sin ella, los
          importes en {store.currency} se muestran sin tipo de cambio y no se
          suman en USD.
        </p>
      )}
    </section>
  );
}
