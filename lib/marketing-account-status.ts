// Estado de las cuentas y tipo de cambio aplicado (documento de mejoras,
// módulo 11). Puro y usable en el navegador: se prueba en
// tests/marketing-account-status.test.ts.
//
// `appliedRates` es el único lugar que explica con qué tasa se convierte:
// CRC (cuentas de Meta en colones y precios de la tienda) y PEN (TikTok,
// que llega en soles desde Make). La conversión misma la hace `asUsd`
// (lib/marketing-usd-rate.ts) con el mismo `fx`.
import type { UsdRate } from "./marketing-charlie-types";
import type {
  MetaAccountStatus,
  TiktokFeedStatus,
} from "./marketing-insights-types";
import type { AccountLabel } from "./marketing-settings-types";
import { accountLabel } from "./marketing-actions";
import { shiftDate } from "./marketing-dates";
import { dateTimeCrText, moneyText, shortDateText } from "./marketing-copy";
import {
  MARKETING_FX_REFERENCE,
  MARKETING_TARGETS,
  type MarketingTargets,
} from "./marketing-targets";

export type RateSource = "hacienda" | "bcrp" | "manual" | "unavailable";

export interface AppliedRate {
  currency: "CRC" | "PEN";
  /** Units of `currency` per USD actually applied; null = not converted. */
  rate: number | null;
  source: RateSource;
  date: string | null;
  /** Team reference (3.5 PEN, 505 CRC). */
  reference: number;
  /** (rate − reference) / reference × 100. */
  driftPct: number | null;
  /** |driftPct| above MARKETING_FX_REFERENCE.maxDriftPct. */
  drift: boolean;
}

export const RATE_SOURCE_LABEL: Record<RateSource, string> = {
  hacienda: "Hacienda",
  bcrp: "BCRP",
  manual: "fija a mano",
  unavailable: "sin tasa",
};

function applied(
  currency: "CRC" | "PEN",
  rate: number | null | undefined,
  source: RateSource,
  date: string | null | undefined,
  reference: number,
): AppliedRate {
  const valid = rate != null && Number.isFinite(rate) && rate > 0;
  const driftPct = valid ? ((rate - reference) / reference) * 100 : null;
  return {
    currency,
    rate: valid ? rate : null,
    source: valid ? source : "unavailable",
    date: valid ? (date ?? null) : null,
    reference,
    driftPct,
    drift:
      driftPct != null &&
      Math.abs(driftPct) > MARKETING_FX_REFERENCE.maxDriftPct,
  };
}

/** The rates `asUsd` applies with this `fx`, next to the team reference. */
export function appliedRates(fx: UsdRate | null): {
  crc: AppliedRate;
  pen: AppliedRate;
} {
  return {
    crc: applied(
      "CRC",
      fx?.rate,
      fx?.source === "manual" ? "manual" : "hacienda",
      fx?.date,
      MARKETING_FX_REFERENCE.crcPerUsd,
    ),
    pen: applied(
      "PEN",
      fx?.pen?.rate,
      fx?.pen?.source === "manual" ? "manual" : "bcrp",
      fx?.pen?.date,
      MARKETING_FX_REFERENCE.penPerUsd,
    ),
  };
}

const TWO = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const SIGNED = new Intl.NumberFormat("es-CR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** "517,30" / "3,52". */
export const rateNumberText = (value: number) => TWO.format(value);

/** Team reference: "505" for CRC, "3,50" for PEN. */
export const referenceText = (rate: AppliedRate) =>
  rate.currency === "CRC"
    ? new Intl.NumberFormat("es-CR").format(rate.reference)
    : TWO.format(rate.reference);

/** "+2,4 %". */
export const driftText = (driftPct: number) =>
  `${SIGNED.format(Math.round(driftPct * 10) / 10)} %`;

/** "1 USD = 517,30 CRC (Hacienda, 4 nov) · referencia del equipo 505 (+2,4 %)". */
export function appliedRateText(rate: AppliedRate): string {
  if (rate.rate == null)
    return `Sin tasa ${rate.currency}: los importes en ${rate.currency} quedan sin convertir · referencia del equipo ${referenceText(rate)}`;
  const when = rate.date ? `, ${shortDateText(rate.date)}` : "";
  return `1 USD = ${rateNumberText(rate.rate)} ${rate.currency} (${RATE_SOURCE_LABEL[rate.source]}${when}) · referencia del equipo ${referenceText(rate)}${rate.driftPct == null ? "" : ` (${driftText(rate.driftPct)})`}`;
}

/** Toolbar: "USD · 517,30 CRC/USD (Hacienda, 4 nov · equipo 505) · 3,52 PEN/USD (BCRP, 4 nov · equipo 3,50)". */
export function appliedRatesShortText(rates: {
  crc: AppliedRate;
  pen: AppliedRate;
}): string {
  const part = (rate: AppliedRate) =>
    rate.rate == null
      ? `${rate.currency} sin tasa (equipo ${referenceText(rate)})`
      : `${rateNumberText(rate.rate)} ${rate.currency}/USD (${RATE_SOURCE_LABEL[rate.source]}${rate.date ? `, ${shortDateText(rate.date)}` : ""} · equipo ${referenceText(rate)})`;
  return `USD · ${part(rates.crc)} · ${part(rates.pen)}`;
}

/* ---------- Estado de las cuentas ---------- */

export const DISABLE_REASON_LABEL: Record<number, string> = {
  1: "Política de anuncios",
  2: "Revisión de propiedad intelectual",
  3: "Riesgo de pago",
  4: "Cuenta cerrada por Meta",
  5: "Revisión de la cuenta",
  6: "Integridad del negocio",
  7: "Cierre permanente",
  11: "Política del Business Manager",
  12: "Cuenta mal representada",
  15: "Cuenta comprometida",
};

export const disableReasonText = (code: number) =>
  DISABLE_REASON_LABEL[code] ?? `Motivo de Meta (código ${code})`;

export type AccountTone = "risk" | "wait" | "good";

export interface AccountStatusRow {
  platform: "meta" | "tiktok";
  accountId: string;
  /** Team label (CR4, TikTok…). */
  label: string;
  /** Account name in the platform (may be empty). */
  name: string;
  /** Short state for the chip. */
  state: string;
  tone: AccountTone;
  title: string;
  detail: string;
  /** Goes to the report banner (not for "could not ask now"). */
  problem: boolean;
}

export const TIKTOK_STATUS_NOTE =
  "Make no envía el estado de la cuenta de TikTok; solo hasta qué día llegó el gasto.";

function metaRow(
  account: MetaAccountStatus,
  labels: AccountLabel[],
  t: MarketingTargets,
): AccountStatusRow {
  const base = {
    platform: "meta" as const,
    accountId: account.accountId,
    label: accountLabel("meta", account.accountId, account.name ?? "", labels),
    name: account.name ?? "",
  };
  const row = (
    state: string,
    tone: AccountTone,
    title: string,
    detail: string,
    problem = tone !== "good",
  ): AccountStatusRow => ({ ...base, state, tone, title, detail, problem });
  switch (account.state) {
    case "activa": {
      const { spendCap, amountSpent, currency } = account;
      if (spendCap && amountSpent != null) {
        const used = amountSpent / spendCap;
        const pct = Math.min(999, Math.round(used * 100));
        const amounts = `${moneyText(amountSpent, currency)} de ${moneyText(spendCap, currency)}`;
        if (used >= 1)
          return row(
            "Límite alcanzado",
            "risk",
            `Límite de gasto alcanzado (${pct} %)`,
            `${amounts}. Meta no entrega anuncios hasta subir el límite.`,
          );
        if (used >= t.accountSpendCapWarn)
          return row(
            "Límite cerca",
            "wait",
            `Límite de gasto casi alcanzado (${pct} %)`,
            `${amounts}. Sube el límite en Meta o la cuenta se detiene.`,
          );
        return row(
          "Activa",
          "good",
          "Activa",
          `Límite de gasto: ${pct} % usado.`,
        );
      }
      return row("Activa", "good", "Activa", "Sin límite de gasto.");
    }
    case "deshabilitada":
      return row(
        "Restringida",
        "risk",
        account.disableReason
          ? `Restringida: ${disableReasonText(account.disableReason)}`
          : "Restringida",
        "Meta no entrega los anuncios de esta cuenta. Revisa la calidad de la cuenta en Meta.",
      );
    case "pago_pendiente":
      return row(
        "Pago pendiente",
        "risk",
        "Pago pendiente",
        "Meta detiene los anuncios hasta que se pague. Revisa el método de pago.",
      );
    case "en_revision":
      return row(
        "En revisión",
        "wait",
        "En revisión de Meta",
        "Meta está revisando la cuenta; los anuncios pueden frenarse.",
      );
    case "periodo_gracia":
      return row(
        "Período de gracia",
        "wait",
        "Período de gracia de pago",
        "Paga pronto o Meta detiene los anuncios.",
      );
    case "cerrada":
      return row(
        "Cerrada",
        "risk",
        "Cuenta cerrada",
        "La cuenta está cerrada en Meta y sigue configurada en Kairo.",
      );
    case "sin_acceso":
      return row(
        "Sin acceso",
        "risk",
        "Sin acceso: el token de Kairo no puede leer esta cuenta",
        "Por eso el gasto de Meta puede salir «Sin datos». Hay que dar acceso a la cuenta al usuario del sistema.",
      );
    default:
      return row(
        "Sin respuesta",
        "wait",
        "No se pudo consultar",
        "Meta no respondió para esta cuenta. Vuelve a intentar más tarde.",
        false,
      );
  }
}

/**
 * Rows for the "Estado de las cuentas" list and the report banner. Meta: one
 * row per configured account. TikTok: Make only sends spend, so the row says
 * up to which day the data arrived.
 */
export function accountStatusRows(input: {
  meta: MetaAccountStatus[] | null;
  metaError: boolean;
  tiktok: TiktokFeedStatus[];
  tiktokError?: boolean;
  labels: AccountLabel[];
  today: string;
  t?: MarketingTargets;
}): {
  rows: AccountStatusRow[];
  problems: AccountStatusRow[];
  notes: string[];
} {
  const t = input.t ?? MARKETING_TARGETS;
  const rows: AccountStatusRow[] = [];
  const notes: string[] = [];
  if (input.meta)
    rows.push(...input.meta.map((account) => metaRow(account, input.labels, t)));
  else if (input.metaError)
    rows.push({
      platform: "meta",
      accountId: "",
      label: "Meta",
      name: "",
      state: "Sin respuesta",
      tone: "wait",
      title: "No se pudo consultar Meta",
      detail: "Vuelve a intentar más tarde.",
      problem: false,
    });
  else notes.push("Meta no está configurado para esta tienda.");

  const lateBefore = shiftDate(input.today, -t.tiktokFeedLagDays);
  for (const feed of input.tiktok) {
    const label = accountLabel("tiktok", feed.advertiserId, feed.name, input.labels);
    const base = {
      platform: "tiktok" as const,
      accountId: feed.advertiserId,
      label,
      name: feed.name,
    };
    const loaded = feed.updatedAt
      ? ` Última carga de Make: ${dateTimeCrText(feed.updatedAt)}.`
      : "";
    if (!feed.lastDate)
      rows.push({
        ...base,
        state: "Sin datos",
        tone: "risk",
        title: "Make no ha enviado gasto de TikTok",
        detail: `Revisa el escenario de Make.${loaded}`,
        problem: true,
      });
    else if (feed.lastDate < lateBefore)
      rows.push({
        ...base,
        state: "Atrasado",
        tone: "risk",
        title: `Make no envía TikTok desde el ${shortDateText(feed.lastDate)}`,
        detail: `El gasto y las conversiones de TikTok están atrasados: revisa el escenario de Make.${loaded}`,
        problem: true,
      });
    else
      rows.push({
        ...base,
        state: "Al día",
        tone: "good",
        title: `Datos hasta el ${shortDateText(feed.lastDate)}`,
        detail: `TikTok llega al día siguiente por Make.${loaded}`,
        problem: false,
      });
  }
  if (input.tiktokError)
    rows.push({
      platform: "tiktok",
      accountId: "",
      label: "TikTok",
      name: "",
      state: "Sin respuesta",
      tone: "wait",
      title: "No se pudo leer el gasto de TikTok",
      detail: "Vuelve a intentar más tarde.",
      problem: false,
    });
  else if (!input.tiktok.length)
    notes.push("Make no ha enviado datos de TikTok para esta tienda.");
  notes.push(TIKTOK_STATUS_NOTE);
  return { rows, problems: rows.filter((row) => row.problem), notes };
}
