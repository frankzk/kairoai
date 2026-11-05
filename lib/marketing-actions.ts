// "Qué hacer hoy con cada campaña" (documento de mejoras, módulo 2): una fila
// por campaña de Meta o TikTok con gasto, pedidos reales y CPA de hoy, ayer,
// 3 y 7 días, y la acción sugerida según las reglas del equipo (prueba,
// escalado, espera tras un cambio, stock). Puro.
import type { MarketingSummary } from "./marketing";
import type { MarketingControl } from "./marketing-real-orders";
import type {
  CampaignChange,
  MarketingCampaign,
  MarketingSources,
} from "./marketing-source-types";
import type {
  AccountLabel,
  MarketingSettings,
} from "./marketing-settings-types";
import type { UsdRate } from "./marketing-charlie-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import {
  dateTime,
  marketingDate,
  shiftDate,
  MARKETING_DAY,
} from "./marketing-dates";
import { asUsd } from "./marketing-usd-rate";
import {
  buildRealEstimate,
  sumWindow,
  type AssignedCampaign,
  type CampaignEstimates,
} from "./marketing-real-cpa";
import {
  restockDelta,
  stockIndex,
  targetCoverage,
  type Coverage,
} from "./marketing-coverage";
import {
  countText,
  dateTimeCrText,
  decimalText,
  moneyText,
  shortDateText,
} from "./marketing-copy";

export type ActionCode =
  | "pausar_stock"
  | "reactivar"
  | "apagar_prueba"
  | "paso_prueba"
  | "en_prueba"
  | "en_espera"
  | "escalar"
  | "cpa_alto"
  | "mantener"
  | "pausada"
  | "sin_datos"
  | "asignar_producto";
export interface SuggestedAction {
  code: ActionCode;
  label: string;
  tone: "risk" | "good" | "wait" | "info";
  detail: string;
  /** ISO time when the action is due. */
  due?: string;
}
export interface Window {
  spendNative: number | null;
  spendUsd: number | null;
  /** Pixel purchases (Meta) or conversions (TikTok). */
  pixel: number | null;
  /** Estimated real orders (UTM + share by product). */
  real: number | null;
  utm: number;
  partial: boolean;
  cpaReal: number | null;
  cpaPixel: number | null;
}
export interface CampaignActionRow {
  key: string;
  platform: "meta" | "tiktok";
  accountId: string;
  accountLabel: string;
  campaignId: string;
  name: string;
  type: "COST CAP" | "CBO" | "ABO" | "Sin dato";
  status: "activa" | "pausada" | "otra" | null;
  currency: string;
  dailyBudget: number | null;
  bid: number | null;
  bidMixed: boolean;
  product: {
    key: string;
    name: string;
    automatic: boolean;
    reason: string;
  } | null;
  coverage: Coverage | null;
  /** Units that came in since the previous inventory snapshot (null = no previous snapshot). */
  restocked: number | null;
  /** The product was out of stock or under the red threshold in the previous snapshot (null = unknown). */
  restockedFromLow: boolean | null;
  /** Date of the inventory file when it is older than yesterday (stock rules are not evaluated). */
  stockStale: string | null;
  /** Last day with spend data (TikTok arrives a day late). */
  dataThrough: string | null;
  today: Window;
  yesterday: Window;
  days3: Window;
  days7: Window;
  launch: {
    date: string | null;
    ageDays: number | null;
    lifetimeSpendNative: number | null;
    /** Lifetime spend in the test currency: USD (Meta) or PEN (TikTok); null if not convertible. */
    testSpend: number | null;
    lifetimeReal: number | null;
    lifetimePixel: number | null;
    /**
     * Launched within testMaxAgeDays with convertible spend. Below the pass
     * spend the test rules decide; from the pass spend on, "Pasó la prueba"
     * gives way to the hold, scale and CPA rules.
     */
    inTest: boolean;
  };
  /** Last budget, bid, creative, launch or unclassified edit (status changes do not start the 72 h hold). */
  lastChange: CampaignChange | null;
  /** Last status change (pause/activate), for "no entrega". */
  lastStatusChange: CampaignChange | null;
  changesStatus: "activity" | "updated_time" | "manual" | "unavailable";
  action: SuggestedAction;
  notes: SuggestedAction[];
}
type ManualChange = CampaignChange & { productKey?: string | null };

const CR_ACCOUNT = /\bCR\s*-?\s*([2-9])\b/i;

/** Short account name: manual label → "CR4" from the name → "TikTok" → account name. */
export function accountLabel(
  platform: "meta" | "tiktok",
  accountId: string,
  accountName: string,
  labels: AccountLabel[],
): string {
  const manual = labels.find(
    (l) => l.platform === platform && l.account_id === accountId,
  );
  if (manual?.label.trim()) return manual.label.trim();
  const match = CR_ACCOUNT.exec(accountName || "");
  if (match) return `CR${match[1]}`;
  if (platform === "tiktok") return "TikTok";
  return accountName || accountId;
}

export function campaignType(
  c: Pick<MarketingCampaign, "name" | "bidStrategy" | "budgetKind">,
  platform: "meta" | "tiktok",
): CampaignActionRow["type"] {
  if (c.bidStrategy === "COST_CAP" || /COST[ _-]*CAP/i.test(c.name))
    return "COST CAP";
  if (
    platform === "meta" &&
    (c.budgetKind === "campaign" || c.budgetKind === "lifetime")
  )
    return "CBO";
  if (platform === "meta" && c.budgetKind === "adsets") return "ABO";
  if (/\bCBO\b/i.test(c.name)) return "CBO";
  if (/\bABO\b/i.test(c.name)) return "ABO";
  return "Sin dato";
}

const statusOf = (value: string | undefined): CampaignActionRow["status"] =>
  !value
    ? null
    : value === "ACTIVE"
      ? "activa"
      : /PAUSED$/.test(value)
        ? "pausada"
        : "otra";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Real CPA used by the rules and alerts. Spend of at least the target CPA
 * with zero real orders is above any target, so it counts as Infinity.
 */
export function effectiveRealCpa(
  w: Pick<Window, "cpaReal" | "real" | "spendUsd">,
  t: Pick<MarketingTargets, "cpaUsd"> = MARKETING_TARGETS,
): number | null {
  if (w.cpaReal != null) return w.cpaReal;
  return w.real === 0 && w.spendUsd != null && w.spendUsd >= t.cpaUsd
    ? Infinity
    : null;
}
const hoursBetween = (from: string, to: Date) =>
  Math.max(0, (to.getTime() - Date.parse(from)) / 3_600_000);

/** Active for the rules: status ACTIVE, or unknown status with spend today, yesterday or in the last 3 days. */
export function campaignActive(
  row: Pick<CampaignActionRow, "status" | "today" | "yesterday" | "days3">,
): boolean {
  const spentRecently = [row.today, row.yesterday, row.days3].some(
    (w) => (w.spendNative ?? 0) > 0,
  );
  return row.status === "activa" || (row.status === null && spentRecently);
}

/**
 * Step 4 of the rules: the launch test (Meta in USD, TikTok in soles), with
 * real orders only. Null when the campaign is not in test or its spend is not
 * convertible. `passed` = "Pasó la prueba", which the rules put after the
 * hold, scale and CPA actions.
 */
export function testRuleAction(
  row: Pick<CampaignActionRow, "platform" | "launch">,
  active: boolean,
  t: MarketingTargets = MARKETING_TARGETS,
): { action: SuggestedAction; passed: boolean } | null {
  if (!row.launch.inTest || row.launch.testSpend == null) return null;
  const meta = row.platform === "meta";
  const kill = meta ? t.metaTestKillUsd : t.tiktokTestKillPen;
  const pass = meta ? t.metaTestPassUsd : t.tiktokTestPassPen;
  const need = meta ? t.metaTestPassOrders : t.tiktokTestPassOrders;
  const money = (v: number) => moneyText(v, meta ? "USD" : "PEN");
  const spend = row.launch.testSpend;
  const orders = row.launch.lifetimeReal;
  const pixel = row.launch.lifetimePixel;
  const result = (action: SuggestedAction, passed = false) => ({
    action,
    passed,
  });
  if (orders == null)
    return result({
      code: "en_prueba",
      label: "En prueba",
      tone: "wait",
      detail: `${money(spend)} gastados · pedidos reales no disponibles${pixel != null ? ` (píxel: ${countText(pixel)})` : ""}. No se decide con el píxel.`,
    });
  // An estimate above zero means some sale was assigned to the campaign.
  if (spend >= kill && orders === 0 && (pixel ?? 0) === 0)
    return result(
      active
        ? {
            code: "apagar_prueba",
            label: "Apagar",
            tone: "risk",
            detail: `Prueba: ${money(spend)} gastados sin venta (meta: venta antes de ${money(kill)}).`,
          }
        : {
            code: "pausada",
            label: "Prueba apagada",
            tone: "info",
            detail: `${money(spend)} sin venta; sin gasto en los últimos 3 días.`,
          },
    );
  if (spend >= pass && orders >= need)
    return result(
      {
        code: "paso_prueba",
        label: "Pasó la prueba",
        tone: "good",
        detail: `${money(spend)} con ${ordersText(orders)} pedidos reales.`,
      },
      true,
    );
  if (spend >= pass)
    return result({
      code: "cpa_alto",
      label: "No pasó la prueba",
      tone: "risk",
      detail: `${money(spend)} y ${ordersText(orders)} pedidos reales (se piden ${need}).`,
    });
  return result(
    active
      ? {
          code: "en_prueba",
          label: "En prueba",
          tone: "wait",
          detail: `${money(spend)} de ${money(pass)} · ${ordersText(orders)} pedidos reales.`,
        }
      : {
          code: "pausada",
          label: "Prueba sin gasto",
          tone: "info",
          detail: `Sin gasto en los últimos 3 días (${money(spend)} de ${money(pass)}).`,
        },
  );
}

/** Rules of the team table, in order. The first match is the action; later matches are notes. */
export function evaluateCampaignRules(
  row: Omit<CampaignActionRow, "action" | "notes">,
  ctx: { now: Date; t: MarketingTargets },
): { action: SuggestedAction; notes: SuggestedAction[] } {
  const { t, now } = ctx;
  const usd = (v: number | null) => moneyText(v, "USD");
  const out: SuggestedAction[] = [];
  const finish = () => ({ action: out[0], notes: out.slice(1) });

  // 1. Without product there are no real orders nor stock.
  if (!row.product) {
    out.push({
      code: "asignar_producto",
      label: "Asigna el producto",
      tone: "info",
      detail: "Sin producto no hay pedidos reales ni stock.",
    });
    return finish();
  }
  const active = campaignActive(row);

  // 2. Stock for less than 3 days (only with a current inventory file).
  if (active && !row.stockStale && row.coverage?.tone === "red")
    out.push({
      code: "pausar_stock",
      label: "Pausar por stock",
      tone: "risk",
      detail: `${row.product.name}: ${row.coverage.label === "Agotado" ? "agotado" : `${row.coverage.label} de stock`}.`,
    });

  // 3. Paused campaigns: reactivate only those stopped for stock (spent in
  // the last 7 days, without a 7-day real CPA above the target, product low
  // in the previous file) once stock came in.
  if (row.status === "pausada") {
    const restocked =
      row.restocked != null &&
      row.restocked > 0 &&
      row.coverage &&
      ["ok", "yellow", "no_demand"].includes(row.coverage.tone)
        ? row.restocked
        : null;
    const cpa7 = effectiveRealCpa(row.days7, t);
    const why = row.stockStale
      ? `el inventario es del ${shortDateText(row.stockStale)}`
      : !((row.days7.spendNative ?? 0) > 0)
        ? "lleva más de 7 días sin gasto"
        : cpa7 != null && cpa7 > t.cpaUsd
          ? Number.isFinite(cpa7)
            ? `su CPA real de 7 días fue ${usd(cpa7)}`
            : "no tuvo pedidos reales en 7 días"
          : row.restockedFromLow === false
            ? "el producto tenía stock antes"
            : null;
    if (restocked != null && !why)
      out.push({
        code: "reactivar",
        label: "Reactivar",
        tone: "good",
        detail: `Entró stock: +${countText(restocked)} u. · ${row.coverage!.label} de cobertura.`,
      });
    else
      out.push({
        code: "pausada",
        label: "Pausada",
        tone: "info",
        detail:
          restocked != null
            ? `Entró stock (+${countText(restocked)} u.), pero ${why}. Revisa antes de reactivar.`
            : "Campaña pausada.",
      });
    if (row.restocked == null && row.coverage)
      out.push({
        code: "pausada",
        label: "Sin registro de reposición",
        tone: "info",
        detail:
          "Sin registro de reposición (falta el archivo de un día anterior).",
      });
    return finish();
  }

  // 4. Test rules (Meta in USD, TikTok in soles), with real orders only:
  // deciding on the pixel is what the team asked to stop (A4).
  let passed: SuggestedAction | null = null;
  const test = testRuleAction(row, active, t);
  if (test?.passed) passed = test.action;
  else if (test) out.push(test.action);

  // 5. Hold after a change (48–72 h).
  const scale = `+${Math.round(t.scaleStep * 100)}%`;
  const cpa3 = effectiveRealCpa(row.days3, t);
  let holding = false;
  if (row.lastChange) {
    const hours = hoursBetween(row.lastChange.at, now);
    if (hours < t.holdHours) {
      holding = true;
      const due = new Date(
        Date.parse(row.lastChange.at) + t.holdHours * 3_600_000,
      ).toISOString();
      out.push({
        code: "en_espera",
        label: "En espera, no tocar",
        tone: "wait",
        detail: `Último cambio hace ${Math.floor(hours)} h (${row.lastChange.kind}). Se puede tocar desde el ${dateTimeCrText(due)}${hours >= t.holdMinHours ? ` (ya pasó el mínimo de ${t.holdMinHours} h)` : ""}.`,
        due,
      });
      if (cpa3 != null && cpa3 <= t.cpaUsd)
        out.push({
          code: "escalar",
          label: `Escalar ${scale}`,
          tone: "good",
          detail: `Si sigue así, escalar ${scale} el ${dateTimeCrText(due)}.`,
          due,
        });
    }
  }

  // 6. Scale with a 3-day real CPA within the target.
  if (!holding && cpa3 != null && cpa3 <= t.cpaUsd && !row.days3.partial) {
    const budget =
      row.dailyBudget != null && row.dailyBudget > 0
        ? `Presupuesto ${moneyText(row.dailyBudget, row.currency)} → ${moneyText(round2(row.dailyBudget * (1 + t.scaleStep)), row.currency)}.`
        : `Subir ${Math.round(t.scaleStep * 100)}% el presupuesto.`;
    const unknown =
      !row.lastChange &&
      (row.changesStatus === "unavailable" || row.changesStatus === "manual")
        ? ` Sin registro de cambios: confirma que no se tocó en ${t.holdHours} h.`
        : row.changesStatus === "unavailable"
          ? ` Registro de cambios incompleto: confirma que no se tocó en ${t.holdHours} h.`
          : "";
    out.push({
      code: "escalar",
      label: `Escalar ${scale}`,
      tone: "good",
      detail: `CPA real 3 días ${usd(cpa3)}. ${budget} Toca: hoy.${unknown}`,
      due: now.toISOString(),
    });
  }

  // 7. 3-day real CPA above the target (spend without real orders included).
  if (cpa3 != null && cpa3 > t.cpaUsd)
    out.push({
      code: "cpa_alto",
      label: "CPA alto",
      tone: "risk",
      detail: Number.isFinite(cpa3)
        ? `CPA real 3 días ${usd(cpa3)} (meta ${usd(t.cpaUsd)}).`
        : `Sin pedidos reales en 3 días con ${usd(row.days3.spendUsd)} de gasto (meta ${usd(t.cpaUsd)} por pedido).`,
    });

  // A passed test hands over to the hold, scale and CPA rules.
  if (passed) out.push(passed);

  // 8. Waiting for data (TikTok arrives the next day).
  if (row.days3.partial || row.days3.spendUsd == null) {
    const missing =
      row.dataThrough != null ? shiftDate(row.dataThrough, 1) : null;
    out.push({
      code: "sin_datos",
      label: "Esperando datos",
      tone: "info",
      detail:
        row.platform === "tiktok"
          ? `TikTok envía el día siguiente; faltan datos${missing ? ` del ${shortDateText(missing)}` : ""}.`
          : "Faltan datos de gasto o de pedidos de los últimos 3 días.",
    });
  }

  // 9. Nothing to do.
  if (!out.length)
    out.push({
      code: "mantener",
      label: "Mantener",
      tone: "info",
      detail:
        cpa3 != null
          ? `CPA real 3 días ${usd(cpa3)}.`
          : (row.days3.spendNative ?? 0) > 0
            ? `Sin pedidos reales en 3 días (${usd(row.days3.spendUsd)} de gasto).`
            : "Sin gasto en los últimos 3 días.",
    });
  return finish();
}

function windowOf(
  c: AssignedCampaign,
  estimates: CampaignEstimates,
  from: string,
  to: string,
  fx: UsdRate | null,
): Window {
  const lagging =
    c.platform === "tiktok" &&
    (c.observedThrough == null || c.observedThrough < to);
  // TikTok days after the last one Make sent are unknown, not zero: a window
  // with no reported day has no spend or pixel; a partly reported one sums
  // the reported days and is partial.
  const unreported =
    c.platform === "tiktok" &&
    (c.observedThrough == null || c.observedThrough < from);
  const daily = unreported ? undefined : c.campaign.daily;
  const rows = daily?.filter((d) => d.date >= from && d.date <= to) ?? [];
  const spendNative = daily ? rows.reduce((n, d) => n + d.spend, 0) : null;
  const spendUsd = asUsd(spendNative, c.account.currency, fx);
  const pixel = !daily
    ? null
    : rows.some((d) => d.purchases == null)
      ? null
      : rows.reduce((n, d) => n + (d.purchases ?? 0), 0);
  const real = sumWindow(estimates.get(c.key), from, to);
  return {
    spendNative,
    spendUsd,
    pixel,
    real: real.orders,
    utm: real.utm,
    partial: real.partial || lagging || !c.mapping,
    cpaReal:
      spendUsd != null && real.orders != null && real.orders > 0
        ? spendUsd / real.orders
        : null,
    cpaPixel:
      spendUsd != null && pixel != null && pixel > 0 ? spendUsd / pixel : null,
  };
}

const TONE_ORDER = { risk: 0, good: 1, wait: 2, info: 3 } as const;

export function buildCampaignActionRows(input: {
  summary: MarketingSummary;
  sources: MarketingSources | null;
  control: MarketingControl | null;
  settings: MarketingSettings | null;
  manualChanges: ManualChange[];
  fx: UsdRate | null;
  now?: Date;
  targets?: MarketingTargets;
}): {
  meta: CampaignActionRow[];
  tiktok: CampaignActionRow[];
  tiktokLaunchesToday: number;
  launchLimitReached: boolean;
  /** TikTok launches today (also in `notes`). */
  launchNote: string;
  notes: string[];
  /** Why a platform's table is empty because its source failed (null = read fine). */
  unavailable: { meta: string | null; tiktok: string | null };
} {
  const now = input.now ?? new Date();
  const t = input.targets ?? MARKETING_TARGETS;
  const today = marketingDate(now),
    yesterday = shiftDate(today, -1);
  const { campaigns, estimates } = buildRealEstimate({
    summary: input.summary,
    sources: input.sources,
    settings: input.settings,
    control: input.control,
    fx: input.fx,
  });
  const inventory =
    input.sources?.shiphero.status === "ready"
      ? input.sources.shiphero.data
      : null;
  const index = inventory ? stockIndex(inventory.stock) : null;
  // A product_table file older than yesterday no longer says what is in
  // stock now (InventoryUpload asks for today's file from then on).
  const stockStale =
    inventory?.snapshotDate && inventory.snapshotDate < yesterday
      ? inventory.snapshotDate
      : null;
  const restock =
    inventory?.previous != null
      ? restockDelta(inventory.stock, inventory.previous.stock)
      : null;
  const previousIndex =
    inventory?.previous != null ? stockIndex(inventory.previous.stock) : null;
  const products = input.summary.products.map((p) => ({
    key: p.key,
    sku: p.sku,
    recentUnits: p.recentUnits,
  }));
  const families = input.summary.productFamilies ?? [];
  const labels = input.settings?.accountLabels ?? [];
  const controlFrom = input.control?.from ?? null;

  const rows = campaigns
    .filter(
      (c) =>
        c.campaign.spend > 0 ||
        c.campaign.effectiveStatus === "ACTIVE" ||
        (c.campaign.lifetime?.spend ?? 0) > 0,
    )
    .map((c): CampaignActionRow => {
      const platform = c.platform;
      const lifetime = c.campaign.lifetime ?? null;
      const launchDate = lifetime?.firstDate ?? null;
      const ageDays =
        launchDate != null
          ? Math.round((dateTime(today) - dateTime(launchDate)) / MARKETING_DAY)
          : null;
      const lifetimeSpend = lifetime?.spend ?? null;
      const testSpend =
        lifetimeSpend == null
          ? null
          : platform === "meta"
            ? asUsd(lifetimeSpend, c.account.currency, input.fx)
            : c.account.currency === "PEN"
              ? lifetimeSpend
              : (() => {
                  const inUsd = asUsd(
                    lifetimeSpend,
                    c.account.currency,
                    input.fx,
                  );
                  const pen = input.fx?.pen?.rate;
                  return inUsd != null && pen ? inUsd * pen : null;
                })();
      const lifetimeReal =
        launchDate != null && controlFrom != null && launchDate >= controlFrom
          ? sumWindow(estimates.get(c.key), launchDate, today).orders
          : null;
      const family = families.find(
        (f) => f.key === (c.mapping?.family_key || c.mapping?.product_key),
      );
      const coverage =
        index && c.mapping && c.members.length
          ? targetCoverage(c.members, products, index, t)
          : null;
      const memberSkus = c.members.map((key) => {
        const product = products.find((p) => p.key === key);
        return (
          product?.sku ||
          family?.members.find((m) => m.key === key)?.sku ||
          (key.startsWith("sku:") ? key.slice(4) : "")
        )
          .trim()
          .toLowerCase();
      });
      const restocked =
        restock && c.mapping
          ? memberSkus.reduce((n, sku) => n + (restock.get(sku) ?? 0), 0)
          : null;
      // Previous file: a SKU missing from it counts as 0 (same rule as the delta).
      let restockedFromLow: boolean | null = null;
      if (previousIndex && c.mapping && c.members.length) {
        const before = new Map(previousIndex);
        for (const sku of memberSkus)
          if (sku && !before.has(sku)) before.set(sku, 0);
        const was = targetCoverage(c.members, products, before, t);
        restockedFromLow =
          was.available == null
            ? null
            : was.available <= 0 || was.tone === "red";
      }
      const changes = [
        ...(c.account.changes ?? []),
        ...input.manualChanges.filter((m) => m.platform === platform),
      ]
        .filter(
          (ch) =>
            ch.accountId === c.account.accountId &&
            ch.campaignId === c.campaign.id &&
            Number.isFinite(Date.parse(ch.at)),
        )
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const base: Omit<CampaignActionRow, "action" | "notes"> = {
        key: c.key,
        platform,
        accountId: c.account.accountId,
        accountLabel: accountLabel(
          platform,
          c.account.accountId,
          c.account.accountName || "",
          labels,
        ),
        campaignId: c.campaign.id,
        name: c.campaign.name,
        type: campaignType(c.campaign, platform),
        status: statusOf(c.campaign.effectiveStatus),
        currency: c.account.currency,
        dailyBudget: c.campaign.dailyBudget ?? null,
        bid: c.campaign.bidAmount ?? null,
        bidMixed: Boolean(c.campaign.bidAmountMixed),
        product: c.mapping
          ? {
              key: c.mapping.product_key,
              name: c.mapping.product_name,
              automatic: Boolean(c.mapping.automatic),
              reason:
                c.mapping.match_reason ||
                (c.mapping.automatic ? "Automático" : "Asignado a mano"),
            }
          : null,
        coverage,
        restocked,
        restockedFromLow,
        stockStale,
        dataThrough: c.observedThrough,
        today: windowOf(c, estimates, today, today, input.fx),
        yesterday: windowOf(c, estimates, yesterday, yesterday, input.fx),
        days3: windowOf(
          c,
          estimates,
          shiftDate(today, -3),
          yesterday,
          input.fx,
        ),
        days7: windowOf(
          c,
          estimates,
          shiftDate(today, -7),
          yesterday,
          input.fx,
        ),
        launch: {
          date: launchDate,
          ageDays,
          lifetimeSpendNative: lifetimeSpend,
          testSpend,
          lifetimeReal,
          lifetimePixel: lifetime?.purchases ?? null,
          inTest:
            ageDays != null &&
            ageDays >= 0 &&
            ageDays <= t.testMaxAgeDays &&
            testSpend != null,
        },
        lastChange: changes.find((ch) => ch.kind !== "estado") ?? null,
        lastStatusChange: changes.find((ch) => ch.kind === "estado") ?? null,
        changesStatus:
          platform === "tiktok"
            ? "manual"
            : (c.account.changesStatus ?? "unavailable"),
      };
      return { ...base, ...evaluateCampaignRules(base, { now, t }) };
    })
    .sort(
      (a, b) =>
        TONE_ORDER[a.action.tone] - TONE_ORDER[b.action.tone] ||
        (b.days7.spendUsd ?? -1) - (a.days7.spendUsd ?? -1) ||
        a.name.localeCompare(b.name),
    );

  const launched = new Set(
    input.manualChanges
      .filter(
        (ch) =>
          ch.platform === "tiktok" &&
          ch.kind === "lanzamiento" &&
          Number.isFinite(Date.parse(ch.at)) &&
          marketingDate(new Date(ch.at)) === today,
      )
      .map((ch) => ch.productKey || `campaign:${ch.campaignId}`),
  );
  const tiktokLaunchesToday = launched.size;
  const launchLimitReached = tiktokLaunchesToday >= t.tiktokLaunchesPerDay;
  const notes: string[] = [];
  const failed = (platform: "meta" | "tiktok") => {
    const source = input.sources?.[platform];
    if (!source || source.status === "ready") return null;
    const name = platform === "meta" ? "Meta" : "TikTok";
    return source.status === "pending"
      ? `${name} no está conectado. Sus campañas no aparecen.`
      : `No se pudo consultar ${name}. Sus campañas no aparecen y las reglas quedan sin evaluar.`;
  };
  const unavailable = { meta: failed("meta"), tiktok: failed("tiktok") };
  if (unavailable.meta) notes.push(unavailable.meta);
  const launchNote = launchLimitReached
    ? `Ya se lanzaron ${countText(tiktokLaunchesToday)} productos hoy en TikTok: límite de lanzamientos alcanzado.`
    : `Lanzamientos de hoy en TikTok: ${countText(tiktokLaunchesToday)} de ${countText(t.tiktokLaunchesPerDay)} (registrados a mano).`;
  notes.push(launchNote);
  if (!input.control)
    notes.push(
      "Pedidos reales no disponibles: las reglas de prueba, CPA y escalado quedan sin evaluar.",
    );
  if (stockStale)
    notes.push(
      `El inventario es del ${shortDateText(stockStale)}: las reglas de stock quedan sin evaluar. Sube el archivo de hoy.`,
    );
  return {
    meta: rows.filter((r) => r.platform === "meta"),
    tiktok: rows.filter((r) => r.platform === "tiktok"),
    tiktokLaunchesToday,
    launchLimitReached,
    launchNote,
    notes,
    unavailable,
  };
}

/** "Lanzada el 3 nov" for a row, or null. */
export const launchText = (row: Pick<CampaignActionRow, "launch">) =>
  row.launch.date ? `Lanzada el ${shortDateText(row.launch.date)}` : null;

/** "1,5" orders, rounded to one decimal when estimated. */
export const ordersText = (value: number | null) =>
  value == null
    ? "Sin datos"
    : Number.isInteger(value)
      ? countText(value)
      : decimalText(value);
