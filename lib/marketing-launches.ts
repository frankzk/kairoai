// Seguimiento de lanzamientos (documento de mejoras, módulo 9): las campañas
// lanzadas en los últimos `testMaxAgeDays` días, agrupadas por producto, con
// cuánto llevan del gasto y de los pedidos reales que pide la prueba y en qué
// etapa están. La etapa sale de la misma regla de prueba de la tabla de
// acciones (`testRuleAction`), así las dos vistas nunca dicen cosas distintas.
//
// Puro: se prueba en tests/marketing-launches.test.ts.
import {
  campaignActive,
  testRuleAction,
  type CampaignActionRow,
  type SuggestedAction,
} from "./marketing-actions";
import type { UsdRate } from "./marketing-charlie-types";
import { marketingDate, shiftDate } from "./marketing-dates";
import { countText, moneyText, shortDateText } from "./marketing-copy";
import type { ManualCampaignChange } from "./marketing-source-types";
import { asUsd } from "./marketing-usd-rate";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";

export type LaunchStageCode =
  | "apagar"
  | "paso"
  | "no_paso"
  | "en_prueba"
  | "sin_datos"
  | "prueba_apagada";

export interface LaunchStage {
  code: LaunchStageCode;
  label: string;
  tone: SuggestedAction["tone"];
  /** Test spend ÷ pass spend, 0..1. */
  spendProgress: number;
  /** Real orders ÷ orders needed to pass, 0..1. */
  ordersProgress: number;
  detail: string;
}

export interface LaunchRow {
  campaignKey: string;
  platform: "meta" | "tiktok";
  accountLabel: string;
  campaignName: string;
  productKey: string | null;
  productName: string;
  launchDate: string | null;
  ageDays: number | null;
  /** Lifetime spend in the test currency (USD for Meta, PEN for TikTok); null = unknown. */
  testSpend: number | null;
  currency: "USD" | "PEN";
  spendUsd: number | null;
  /** Kill and pass spend of the test, in `currency`. */
  killSpend: number;
  passSpend: number;
  passOrders: number;
  /** Estimated real orders since launch (UTM + share by product); null = not available. */
  real: number | null;
  pixel: number | null;
  stage: LaunchStage;
  /** "auto" = launch date from Meta/TikTok; "manual" = only a manual "Lanzamiento" entry. */
  source: "auto" | "manual";
}

export interface LaunchGroup {
  productKey: string | null;
  productName: string;
  /** First and last launch date of the group. */
  firstDate: string | null;
  lastDate: string | null;
  launches: LaunchRow[];
}

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Kill, pass spend and orders of the test for a platform. */
export function testThresholds(
  platform: "meta" | "tiktok",
  t: MarketingTargets = MARKETING_TARGETS,
) {
  const meta = platform === "meta";
  return {
    currency: (meta ? "USD" : "PEN") as "USD" | "PEN",
    kill: meta ? t.metaTestKillUsd : t.tiktokTestKillPen,
    pass: meta ? t.metaTestPassUsd : t.tiktokTestPassPen,
    orders: meta ? t.metaTestPassOrders : t.tiktokTestPassOrders,
  };
}

/** Stage of a launched campaign: the test rule of the actions table, plus progress. */
export function launchStage(
  row: Pick<
    CampaignActionRow,
    | "platform"
    | "launch"
    | "product"
    | "status"
    | "today"
    | "yesterday"
    | "days3"
  >,
  t: MarketingTargets = MARKETING_TARGETS,
): LaunchStage {
  const th = testThresholds(row.platform, t);
  const spend = row.launch.testSpend;
  const real = row.launch.lifetimeReal;
  const progress = {
    spendProgress: spend == null ? 0 : clamp01(spend / th.pass),
    ordersProgress: real == null ? 0 : clamp01(real / th.orders),
  };
  const pixelText =
    row.launch.lifetimePixel != null
      ? ` Píxel: ${countText(row.launch.lifetimePixel)}.`
      : "";
  if (!row.product)
    return {
      code: "sin_datos",
      label: "Asigna el producto",
      tone: "info",
      ...progress,
      detail: `Sin producto asignado no hay pedidos reales para decidir.${pixelText}`,
    };
  if (spend == null)
    return {
      code: "sin_datos",
      label: "Sin gasto",
      tone: "info",
      ...progress,
      detail:
        row.launch.lifetimeSpendNative == null
          ? "Todavía sin gasto registrado."
          : "El gasto no se pudo convertir: falta el tipo de cambio.",
    };
  const test = testRuleAction(row, campaignActive(row), t);
  if (!test)
    return {
      code: "sin_datos",
      label: "Sin fecha de lanzamiento",
      tone: "info",
      ...progress,
      detail: "Meta o TikTok no dicen cuándo empezó a gastar.",
    };
  const { action } = test;
  if (test.passed)
    return {
      code: "paso",
      label: action.label,
      tone: "good",
      ...progress,
      detail: action.detail,
    };
  if (action.code === "apagar_prueba")
    return {
      code: "apagar",
      label: action.label,
      tone: "risk",
      ...progress,
      detail: action.detail,
    };
  if (action.code === "cpa_alto")
    return {
      code: "no_paso",
      label: action.label,
      tone: "risk",
      ...progress,
      detail: action.detail,
    };
  if (action.code === "pausada")
    return {
      code: "prueba_apagada",
      label: action.label,
      tone: "info",
      ...progress,
      detail: action.detail,
    };
  if (real == null)
    return {
      code: "sin_datos",
      label: "Sin pedidos reales",
      tone: "info",
      ...progress,
      detail: action.detail,
    };
  return {
    code: "en_prueba",
    label: action.label,
    tone: "wait",
    ...progress,
    detail: action.detail,
  };
}

const NO_PRODUCT = "Sin producto asignado";

/**
 * Launches of the last `testMaxAgeDays` days, grouped by product (Meta and
 * TikTok together), most recent group first. A manual "Lanzamiento" entry
 * adds a launch only when its campaign has no row yet (no spend), or gives the
 * date to a row whose platform did not send one.
 */
export function buildLaunches(input: {
  rows: CampaignActionRow[];
  manual: ManualCampaignChange[];
  today?: string;
  fx: UsdRate | null;
  /** Product key → display name, for manual entries without a row. */
  productName?: (key: string) => string | null;
  t?: MarketingTargets;
}): { groups: LaunchGroup[]; notes: string[] } {
  const t = input.t ?? MARKETING_TARGETS;
  const today = input.today ?? marketingDate();
  const cutoff = shiftDate(today, -t.testMaxAgeDays);
  const manual = input.manual
    .filter(
      (ch) => ch.kind === "lanzamiento" && Number.isFinite(Date.parse(ch.at)),
    )
    .map((ch) => ({ ...ch, date: marketingDate(new Date(ch.at)) }))
    .filter((ch) => ch.date >= cutoff && ch.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));
  const campaignOf = (c: {
    platform: string;
    accountId: string;
    campaignId: string;
  }) => `${c.platform}:${c.accountId}:${c.campaignId}`;
  const manualByCampaign = new Map<string, (typeof manual)[number]>();
  for (const ch of manual)
    if (!manualByCampaign.has(campaignOf(ch)))
      manualByCampaign.set(campaignOf(ch), ch);

  const launches: LaunchRow[] = [];
  const seen = new Set<string>();
  for (const row of input.rows) {
    const id = campaignOf(row);
    seen.add(id);
    const manualEntry = manualByCampaign.get(id);
    const auto = row.launch.date != null && row.launch.date >= cutoff;
    if (!auto && !(row.launch.date == null && manualEntry)) continue;
    const th = testThresholds(row.platform, t);
    launches.push({
      campaignKey: row.key,
      platform: row.platform,
      accountLabel: row.accountLabel,
      campaignName: row.name,
      productKey: row.product?.key ?? null,
      productName: row.product?.name ?? NO_PRODUCT,
      launchDate: auto ? row.launch.date : manualEntry!.date,
      ageDays: row.launch.ageDays,
      testSpend: row.launch.testSpend,
      currency: th.currency,
      spendUsd: asUsd(row.launch.lifetimeSpendNative, row.currency, input.fx),
      killSpend: th.kill,
      passSpend: th.pass,
      passOrders: th.orders,
      real: row.launch.lifetimeReal,
      pixel: row.launch.lifetimePixel,
      stage: launchStage(row, t),
      source: auto ? "auto" : "manual",
    });
  }
  for (const [id, ch] of Array.from(manualByCampaign)) {
    if (seen.has(id)) continue;
    const th = testThresholds(ch.platform, t);
    const name =
      (ch.productKey && input.productName?.(ch.productKey)) || NO_PRODUCT;
    launches.push({
      campaignKey: `${ch.platform}:${ch.accountId}:${ch.campaignId}`,
      platform: ch.platform,
      accountLabel:
        input.rows.find(
          (row) =>
            row.platform === ch.platform && row.accountId === ch.accountId,
        )?.accountLabel ?? (ch.platform === "tiktok" ? "TikTok" : "Meta"),
      campaignName: ch.campaignName || `Campaña ${ch.campaignId}`,
      productKey: ch.productKey,
      productName: name,
      launchDate: ch.date,
      ageDays: null,
      testSpend: null,
      currency: th.currency,
      spendUsd: null,
      killSpend: th.kill,
      passSpend: th.pass,
      passOrders: th.orders,
      real: null,
      pixel: null,
      stage: {
        code: "sin_datos",
        label: "Sin gasto todavía",
        tone: "info",
        spendProgress: 0,
        ordersProgress: 0,
        detail: `Registrado a mano${ch.by ? ` por ${ch.by}` : ""}, sin gasto todavía.`,
      },
      source: "manual",
    });
  }

  const groups = new Map<string, LaunchGroup>();
  for (const launch of launches) {
    const key = launch.productKey ?? "";
    const group = groups.get(key) ?? {
      productKey: launch.productKey,
      productName: launch.productName,
      firstDate: null,
      lastDate: null,
      launches: [],
    };
    group.launches.push(launch);
    if (launch.launchDate) {
      if (!group.firstDate || launch.launchDate < group.firstDate)
        group.firstDate = launch.launchDate;
      if (!group.lastDate || launch.launchDate > group.lastDate)
        group.lastDate = launch.launchDate;
    }
    groups.set(key, group);
  }
  const list = Array.from(groups.values());
  for (const group of list)
    group.launches.sort(
      (a, b) =>
        (b.launchDate ?? "").localeCompare(a.launchDate ?? "") ||
        a.platform.localeCompare(b.platform) ||
        a.campaignName.localeCompare(b.campaignName),
    );
  list.sort(
    (a, b) =>
      Number(a.productKey == null) - Number(b.productKey == null) ||
      (b.lastDate ?? "").localeCompare(a.lastDate ?? "") ||
      a.productName.localeCompare(b.productName),
  );

  const notes: string[] = [];
  const tiktokThrough = input.rows
    .filter((row) => row.platform === "tiktok" && row.dataThrough)
    .map((row) => row.dataThrough!)
    .sort()
    .pop();
  if (
    launches.some((l) => l.platform === "tiktok") &&
    tiktokThrough &&
    tiktokThrough < today
  )
    notes.push(
      `TikTok hasta el ${shortDateText(tiktokThrough)} (llega al día siguiente por Make).`,
    );
  const withoutReal = launches.filter(
    (l) => l.source === "auto" && l.real == null,
  ).length;
  if (withoutReal)
    notes.push(
      `${withoutReal === 1 ? "1 lanzamiento" : `${countText(withoutReal)} lanzamientos`} sin pedidos reales: solo hay pedidos reales de los últimos 14 días y de campañas con producto asignado. No se decide con el píxel.`,
    );
  return { groups: list, notes };
}

/** "USD 23 de 40" / "PEN 120 de 200". */
export function launchSpendText(
  row: Pick<LaunchRow, "testSpend" | "currency" | "passSpend">,
) {
  return row.testSpend == null
    ? `Sin datos de ${moneyText(row.passSpend, row.currency)}`
    : `${moneyText(row.testSpend, row.currency)} de ${moneyText(row.passSpend, row.currency)}`;
}
