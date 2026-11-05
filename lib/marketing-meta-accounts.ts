// Estado de cada cuenta de Meta y desglose por edad y género (05/11/2026,
// módulos 11 y 12). Solo servidor: el token se lee aquí y nunca sale.
//
// Cada cuenta se consulta por separado: una cuenta caída o sin acceso no
// tumba a las demás (al revés que el gasto de Meta en marketing-sources).
// Nunca se reenvía el mensaje del proveedor (puede traer datos de la cuenta).
//
// Los normalizadores (metaAccountStatus, ageGenderRows) son puros y se
// prueban en tests/marketing-meta-accounts.test.ts.
import type {
  AgeGenderRow,
  MetaAccountState,
  MetaAccountStatus,
} from "./marketing-insights-types";
import {
  ATTRIBUTION_WINDOWS,
  metaAccountIds,
  metaPages,
  purchasesOf,
} from "./marketing-sources";

type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

const ACCOUNT_TIMEOUT_MS = 10_000;
/** Graph error codes that mean "this token cannot read this account". */
const NO_ACCESS_CODES = new Set([10, 100, 190, 200, 270, 294]);

const STATE_BY_CODE: Record<number, MetaAccountState> = {
  1: "activa",
  2: "deshabilitada",
  3: "pago_pendiente",
  7: "en_revision",
  8: "pago_pendiente",
  9: "periodo_gracia",
  100: "cerrada",
  101: "cerrada",
};

const minor = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
};
const int = (value: unknown): number | null => {
  const n = Number(value);
  return value != null && value !== "" && Number.isInteger(n) ? n : null;
};

/** Pure: Graph `act_X` body (or error body) → status. Never keeps provider text. */
export function metaAccountStatus(
  id: string,
  body: unknown,
  httpStatus: number,
): MetaAccountStatus {
  const record = obj(body);
  const base: MetaAccountStatus = {
    accountId: id,
    name: null,
    state: "error",
    statusCode: null,
    disableReason: null,
    currency: null,
    amountSpent: null,
    spendCap: null,
  };
  if (httpStatus < 200 || httpStatus >= 300 || record.error) {
    const code = int(obj(record.error).code);
    return {
      ...base,
      state: code != null && NO_ACCESS_CODES.has(code) ? "sin_acceso" : "error",
    };
  }
  if (String(record.id ?? "") !== `act_${id}`) return base;
  const statusCode = int(record.account_status);
  const cap = minor(record.spend_cap);
  return {
    accountId: id,
    name: typeof record.name === "string" ? record.name.slice(0, 120) : null,
    state: (statusCode != null && STATE_BY_CODE[statusCode]) || "error",
    statusCode,
    disableReason: int(record.disable_reason),
    currency:
      typeof record.currency === "string" && /^[A-Z]{3}$/.test(record.currency)
        ? record.currency
        : null,
    amountSpent: minor(record.amount_spent),
    // Meta sends "0" for "no cap".
    spendCap: cap && cap > 0 ? cap : null,
  };
}

function graphBase(env: Env, id: string): string {
  const version = env.META_CR_GRAPH_VERSION || "";
  if (!/^\d+$/.test(id) || !/^v\d+\.\d+$/.test(version))
    throw new Error("Invalid Meta configuration");
  return `https://graph.facebook.com/${version}/act_${id}`;
}

export const metaConfigured = (env: Env) =>
  Boolean(
    env.META_CR_GRAPH_VERSION?.trim() &&
    env.META_CR_ACCESS_TOKEN?.trim() &&
    (env.META_CR_AD_ACCOUNT_IDS || env.META_CR_AD_ACCOUNT_ID),
  );

/**
 * One light call per configured account, independently. null when Meta is
 * not configured or the account list is invalid.
 */
export async function readMetaAccountStatuses(
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
): Promise<MetaAccountStatus[] | null> {
  if (!metaConfigured(env)) return null;
  let ids: string[];
  try {
    ids = metaAccountIds(env);
  } catch {
    return null;
  }
  const headers = { Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}` };
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const url = new URL(graphBase(env, id));
      url.searchParams.set(
        "fields",
        "id,name,account_status,disable_reason,currency,timezone_name,amount_spent,spend_cap",
      );
      const response = await fetcher(url, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      return metaAccountStatus(id, body, response.status);
    }),
  );
  return results.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : metaAccountStatus(ids[i], null, 0),
  );
}

const GENDERS = new Set(["female", "male"]);

/** Pure: account insights rows with `breakdowns=age,gender` → rows. Throws on a malformed metric. */
export function ageGenderRows(
  accountId: string,
  currency: string,
  rows: unknown[],
): AgeGenderRow[] {
  const merged = new Map<string, AgeGenderRow>();
  for (const raw of rows) {
    const row = obj(raw);
    const age = String(row.age ?? "").trim() || "Desconocida";
    const gender = GENDERS.has(String(row.gender))
      ? (String(row.gender) as "female" | "male")
      : "unknown";
    const spend = Number(row.spend ?? 0);
    if (!Number.isFinite(spend)) throw new Error("Invalid metric");
    const purchases = purchasesOf(row);
    const key = `${age}|${gender}`;
    const current = merged.get(key) ?? {
      accountId,
      currency,
      age,
      gender,
      spend: 0,
      purchases: 0,
    };
    current.spend = Math.round((current.spend + spend) * 100) / 100;
    current.purchases += purchases;
    merged.set(key, current);
  }
  return Array.from(merged.values()).sort(
    (a, b) => a.age.localeCompare(b.age) || a.gender.localeCompare(b.gender),
  );
}

/**
 * Spend and pixel purchases per age × gender for each account in
 * `[from, to]` (account dates). Failing accounts are listed in `failed`.
 */
export async function readMetaAgeGender(
  env: Env,
  fetcher: typeof fetch,
  from: string,
  to: string,
): Promise<{ rows: AgeGenderRow[]; failed: string[]; configured: boolean }> {
  if (!metaConfigured(env)) return { rows: [], failed: [], configured: false };
  let ids: string[];
  try {
    ids = metaAccountIds(env);
  } catch {
    return { rows: [], failed: [], configured: false };
  }
  const headers = { Authorization: `Bearer ${env.META_CR_ACCESS_TOKEN}` };
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const base = graphBase(env, id);
      const signal = AbortSignal.timeout(20_000);
      const account = await fetcher(`${base}?fields=id,currency`, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal,
      });
      const info = obj(await account.json().catch(() => null));
      if (!account.ok || info.error || String(info.id) !== `act_${id}`)
        throw new Error("Meta account unavailable");
      const currency = /^[A-Z]{3}$/.test(String(info.currency))
        ? String(info.currency)
        : "";
      if (!currency) throw new Error("Meta account currency unavailable");
      const rows = await metaPages(
        fetcher,
        (after) => {
          const url = new URL(`${base}/insights`);
          url.searchParams.set("level", "account");
          url.searchParams.set("fields", "spend,actions");
          url.searchParams.set("breakdowns", "age,gender");
          url.searchParams.set(
            "time_range",
            JSON.stringify({ since: from, until: to }),
          );
          url.searchParams.set(
            "action_attribution_windows",
            ATTRIBUTION_WINDOWS,
          );
          url.searchParams.set("limit", "200");
          if (after) url.searchParams.set("after", after);
          return url;
        },
        headers,
        signal,
      );
      return ageGenderRows(id, currency, rows);
    }),
  );
  const rows: AgeGenderRow[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") rows.push(...result.value);
    else failed.push(ids[i]);
  });
  return { rows, failed, configured: true };
}
