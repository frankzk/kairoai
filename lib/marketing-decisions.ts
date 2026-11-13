// Decisiones pendientes del Resumen (rediseño del reporte, parte 1) y base de
// la vista Acciones (parte 2): qué campañas escalar, bajar o apagar y qué
// anuncios pasar a COST CAP, con las reglas acordadas con el equipo.
//
// - Ventana: los últimos 3 días completos (hoy − 3 … ayer), con el CPA real de
//   Kairo (gasto ÷ pedidos reales de iComfly, sin anulados) estimado igual que
//   la tabla de acciones (`row.days3` de buildCampaignActionRows: UTM + reparto
//   por producto asignado). El píxel nunca decide.
// - "Hoy" solo levanta una alerta; nunca cambia la acción.
// - Nunca se escala ni se pasa a COST CAP un producto agotado o con stock
//   para menos de 3 días (con inventario vigente).
// - No se escala lo que se tocó (presupuesto, puja, lanzamiento o una edición
//   sin detalle) en las últimas 72 h: "En aprendizaje".
// - Se evalúa por campaña: las fuentes no traen métricas por conjunto de
//   anuncios, así que una ABO también se evalúa entera (se anota).
// - Nunca se decide con promedios de desgloses (ubicaciones, edad, género):
//   solo con el total de la campaña o del anuncio.
// Puro.
import type { CampaignActionRow } from "./marketing-actions";
import { campaignActive } from "./marketing-actions";
import type { CampaignChange } from "./marketing-source-types";
import type { CharlieReport, UsdRate } from "./marketing-charlie-types";
import type { RealOrderDay } from "./marketing-real-orders";
import {
  estimateAdRealOrders,
  type CampaignEstimates,
} from "./marketing-real-cpa";
import { campaignKey } from "./marketing-settings-types";
import { charlieAdSpendRows } from "./marketing-subtraction-real";
import { MARKETING_TARGETS } from "./marketing-targets";
import { marketingDate, shiftDate } from "./marketing-dates";
import { countText, decimalText, moneyText } from "./marketing-copy";

/** Umbrales acordados. Un solo lugar: la interfaz y las pruebas los leen de aquí. */
export const DECISION_RULES = {
  /** Días completos de la ventana (hoy − 3 … ayer). */
  windowDays: 3,
  /** CPA real objetivo: hasta aquí se escala. */
  targetCpaUsd: MARKETING_TARGETS.cpaUsd,
  /** Pedidos reales mínimos en la ventana para escalar. */
  scaleMinRealOrders: 5,
  scaleStep: MARKETING_TARGETS.scaleStep,
  /** Sobre la meta y hasta aquí: bajar. Por encima: apagar. */
  lowerMaxCpaUsd: 11,
  /** Gasto sin ningún pedido real que apaga (2 × CPA objetivo). */
  killNoOrdersSpendUsd: 2 * MARKETING_TARGETS.cpaUsd,
  /** COST CAP: más de estos pedidos reales del anuncio en la ventana… */
  costCapMoreThanOrders: 5,
  /** …y CPA real por debajo de esto. */
  costCapMaxCpaUsd: 6,
  /** Horas tras un cambio en las que no se escala. */
  learningHours: 72,
  /** Cambios que reinician el aprendizaje ("otro" = edición de Meta sin detalle, puede ser presupuesto). */
  learningKinds: ["presupuesto", "puja", "lanzamiento", "otro"] as ReadonlyArray<
    CampaignChange["kind"]
  >,
} as const;
export type DecisionRules = typeof DECISION_RULES;

export type DecisionAction =
  | "escalar"
  | "bajar"
  | "apagar"
  | "aprendizaje"
  | "mantener"
  | "sin_datos";

export const DECISION_LABEL: Record<DecisionAction, string> = {
  escalar: `Escalar +${Math.round(DECISION_RULES.scaleStep * 100)} %`,
  bajar: "Bajar presupuesto",
  apagar: "Apagar",
  aprendizaje: "En aprendizaje",
  mantener: "Mantener",
  sin_datos: "Sin datos suficientes",
};

export interface DecisionWindow {
  spendUsd: number | null;
  /** Pedidos reales estimados (UTM + reparto por producto). */
  real: number | null;
  /** Pedidos reales con UTM de la campaña (el resto es reparto). */
  utm: number;
  /** null sin pedidos reales; ver `noOrders`. */
  cpaReal: number | null;
  /** El píxel, solo como referencia. */
  cpaPixel: number | null;
  partial: boolean;
}

export interface CampaignDecision {
  key: string;
  platform: "meta" | "tiktok";
  accountLabel: string;
  name: string;
  type: CampaignActionRow["type"];
  product: string | null;
  action: DecisionAction;
  label: string;
  detail: string;
  window: DecisionWindow;
  /** Pedidos reales repartidos por producto (no todos con UTM): la cifra es ≈. */
  approximate: boolean;
  /** Las fuentes solo traen la campaña: siempre "campaign" por ahora. */
  level: "campaign";
  levelNote: string | null;
  /** Hoy va mal: aviso, no cambia la acción. */
  todayAlert: string | null;
  /** Cambio que puso la campaña en aprendizaje (solo con acción "aprendizaje"). */
  learning: { at: string; kind: CampaignChange["kind"] | "nueva" } | null;
}

const usd = (value: number | null) => moneyText(value, "USD");
const ordersText = (value: number) =>
  Number.isInteger(value) ? countText(value) : decimalText(value);
const hoursSince = (iso: string, now: Date) =>
  (now.getTime() - Date.parse(iso)) / 3_600_000;

function window3(row: CampaignActionRow): DecisionWindow {
  const w = row.days3;
  return {
    spendUsd: w.spendUsd,
    real: w.real,
    utm: w.utm,
    cpaReal:
      w.spendUsd != null && w.real != null && w.real > 0
        ? w.spendUsd / w.real
        : null,
    cpaPixel: w.cpaPixel,
    partial: w.partial,
  };
}

/** Today's window raises a flag when it already looks like "apagar". */
export function todayAlert(
  row: Pick<CampaignActionRow, "today">,
  rules: DecisionRules = DECISION_RULES,
): string | null {
  const { spendUsd, real } = row.today;
  if (spendUsd == null || real == null || spendUsd <= 0) return null;
  if (real === 0)
    return spendUsd >= rules.killNoOrdersSpendUsd
      ? `Hoy: ${usd(spendUsd)} sin pedidos reales.`
      : null;
  const cpa = spendUsd / real;
  return cpa > rules.lowerMaxCpaUsd ? `Hoy: CPA real ${usd(cpa)}.` : null;
}

/** Latest change of the campaign that resets learning, inside `learningHours`. */
export function learningChange(
  row: Pick<CampaignActionRow, "platform" | "accountId" | "campaignId" | "launch">,
  changes: CampaignChange[],
  now: Date,
  rules: DecisionRules = DECISION_RULES,
): CampaignDecision["learning"] {
  const recent = changes
    .filter(
      (c) =>
        c.platform === row.platform &&
        c.accountId === row.accountId &&
        c.campaignId === row.campaignId &&
        rules.learningKinds.includes(c.kind) &&
        Number.isFinite(Date.parse(c.at)) &&
        hoursSince(c.at, now) >= 0 &&
        hoursSince(c.at, now) < rules.learningHours,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (recent) return { at: recent.at, kind: recent.kind };
  // A campaign younger than the window has not completed its 3 days yet.
  if (
    row.launch.date &&
    row.launch.ageDays != null &&
    row.launch.ageDays >= 0 &&
    row.launch.ageDays < rules.windowDays
  )
    return { at: `${row.launch.date}T12:00:00.000Z`, kind: "nueva" };
  return null;
}

const LEARNING_TEXT: Record<NonNullable<CampaignDecision["learning"]>["kind"], string> = {
  presupuesto: "se cambió el presupuesto",
  puja: "se cambió la puja",
  lanzamiento: "se lanzó",
  otro: "se editó en Meta (sin detalle, puede ser el presupuesto)",
  creativo: "se cambió un creativo",
  estado: "se pausó o activó",
  nueva: "es nueva: todavía no completa 3 días",
};

/** Stock under the red threshold in a current inventory file. */
const lowStock = (row: Pick<CampaignActionRow, "coverage" | "stockStale">) =>
  !row.stockStale && row.coverage?.tone === "red";

function levelNote(row: Pick<CampaignActionRow, "platform" | "type">) {
  if (row.platform !== "meta") return null;
  if (row.type === "ABO")
    return "ABO: se evalúa la campaña completa; no hay datos por conjunto de anuncios.";
  if (row.type === "Sin dato")
    return "Tipo de presupuesto desconocido: se evalúa la campaña completa.";
  return null;
}

/**
 * One campaign against the agreed rules (null when it is paused or not
 * spending: nothing to decide). The order is: data → apagar → bajar →
 * escalar (with the learning guard) → mantener.
 */
export function decideCampaign(
  row: CampaignActionRow,
  ctx: { now: Date; changes: CampaignChange[]; rules?: DecisionRules },
): CampaignDecision | null {
  const rules = ctx.rules ?? DECISION_RULES;
  if (row.status === "pausada" || !campaignActive(row)) return null;
  const w = window3(row);
  const base = {
    key: row.key,
    platform: row.platform,
    accountLabel: row.accountLabel,
    name: row.name,
    type: row.type,
    product: row.product?.name ?? null,
    window: w,
    approximate: w.real != null && w.real > w.utm,
    level: "campaign" as const,
    levelNote: levelNote(row),
    todayAlert: todayAlert(row, rules),
    learning: null,
  };
  const out = (
    action: DecisionAction,
    detail: string,
    patch: Partial<CampaignDecision> = {},
  ): CampaignDecision => ({
    ...base,
    action,
    label: DECISION_LABEL[action],
    detail,
    ...patch,
  });
  if (!row.product)
    return out(
      "sin_datos",
      "Sin producto asignado: no hay pedidos reales para decidir.",
    );
  if (w.spendUsd == null || w.real == null)
    return out(
      "sin_datos",
      row.platform === "tiktok"
        ? "TikTok todavía no envía los últimos 3 días."
        : "Faltan datos de gasto o de pedidos de los últimos 3 días.",
    );
  const spend = w.spendUsd,
    real = w.real,
    cpa = w.cpaReal;
  const target = rules.targetCpaUsd;
  if (spend <= 0) return out("mantener", "Sin gasto en los últimos 3 días.");
  if (real === 0 && spend >= rules.killNoOrdersSpendUsd)
    return out(
      "apagar",
      `${usd(spend)} en 3 días sin pedidos reales (se apaga desde ${usd(rules.killNoOrdersSpendUsd)}).`,
    );
  if (cpa != null && cpa > rules.lowerMaxCpaUsd)
    return out(
      "apagar",
      `CPA real 3 días ${usd(cpa)}: más de ${usd(rules.lowerMaxCpaUsd)}.`,
    );
  if (cpa != null && cpa > target)
    return out(
      "bajar",
      `CPA real 3 días ${usd(cpa)}: sobre la meta de ${usd(target)} y hasta ${usd(rules.lowerMaxCpaUsd)}.`,
    );
  if (cpa != null && cpa <= target) {
    if (real < rules.scaleMinRealOrders)
      return out(
        "mantener",
        `CPA real 3 días ${usd(cpa)} con ${ordersText(real)} pedidos reales; para escalar se piden ${countText(rules.scaleMinRealOrders)}.`,
      );
    if (w.partial)
      return out(
        "mantener",
        `CPA real 3 días ${usd(cpa)}, pero faltan datos de algún día: no se escala todavía.`,
      );
    // Never scale into a stock-out (current inventory only): "Qué está roto"
    // and the actions table already ask to pause it.
    if (lowStock(row))
      return out(
        "mantener",
        `CPA real 3 días ${usd(cpa)}, pero ${row.coverage!.label === "Agotado" ? "el producto está agotado" : `queda stock para ${row.coverage!.label}`}: no se escala.`,
      );
    const learning = learningChange(row, ctx.changes, ctx.now, rules);
    if (learning)
      return out(
        "aprendizaje",
        `CPA real 3 días ${usd(cpa)} con ${ordersText(real)} pedidos reales, pero ${LEARNING_TEXT[learning.kind]}${learning.kind === "nueva" ? "" : ` hace ${Math.floor(hoursSince(learning.at, ctx.now))} h`}. No se escala hasta pasar ${countText(rules.learningHours)} h.`,
        { learning },
      );
    const budget =
      row.dailyBudget != null && row.dailyBudget > 0
        ? ` Presupuesto ${moneyText(row.dailyBudget, row.currency)} → ${moneyText(Math.round(row.dailyBudget * (1 + rules.scaleStep) * 100) / 100, row.currency)}.`
        : "";
    return out(
      "escalar",
      `CPA real 3 días ${usd(cpa)} con ${ordersText(real)} pedidos reales.${budget}`,
    );
  }
  return out(
    "mantener",
    `${usd(spend)} en 3 días sin pedidos reales; se apaga desde ${usd(rules.killNoOrdersSpendUsd)}.`,
  );
}

/** Meta activity changes of the action sources plus the manual log, for the learning guard. */
export function decisionChanges(
  accounts: Array<{ changes?: CampaignChange[] }>,
  manual: CampaignChange[],
): CampaignChange[] {
  return [...accounts.flatMap((a) => a.changes ?? []), ...manual];
}

const ACTION_ORDER: Record<DecisionAction, number> = {
  apagar: 0,
  bajar: 1,
  escalar: 2,
  aprendizaje: 3,
  mantener: 4,
  sin_datos: 5,
};

export function buildCampaignDecisions(input: {
  rows: CampaignActionRow[];
  changes: CampaignChange[];
  now?: Date;
  rules?: DecisionRules;
}): CampaignDecision[] {
  const now = input.now ?? new Date();
  return input.rows
    .map((row) =>
      decideCampaign(row, { now, changes: input.changes, rules: input.rules }),
    )
    .filter((d): d is CampaignDecision => d != null)
    .sort(
      (a, b) =>
        ACTION_ORDER[a.action] - ACTION_ORDER[b.action] ||
        (b.window.spendUsd ?? -1) - (a.window.spendUsd ?? -1) ||
        a.name.localeCompare(b.name),
    );
}

export interface CreativeDecision {
  key: string;
  platform: "meta" | "tiktok";
  accountLabel: string;
  campaignName: string;
  adId: string;
  adName: string;
  product: string | null;
  spendUsd: number;
  /** Pedidos reales del anuncio: UTM del anuncio + su parte del reparto (≈). */
  real: number;
  cpaReal: number;
  basis: "utm" | "estimado";
}

/**
 * Ads ready for a COST CAP: more than 5 real orders and a real CPA under
 * USD 6 in the last 3 complete days, in a campaign that is not a COST CAP yet,
 * not paused and whose product has stock. Per-ad real orders are the existing estimate
 * (estimateAdRealOrders: the ad's UTM orders plus its spend share of the
 * campaign's remaining real orders), so the figure is ≈ unless every order
 * came with the ad's UTM.
 */
export function buildCreativeDecisions(input: {
  report: CharlieReport | null;
  rows: CampaignActionRow[];
  estimates: CampaignEstimates;
  days: RealOrderDay[];
  fx: UsdRate | null;
  now?: Date;
  rules?: DecisionRules;
}): CreativeDecision[] {
  const rules = input.rules ?? DECISION_RULES;
  if (input.report?.status !== "ready" || !input.report.data) return [];
  const today = marketingDate(input.now ?? new Date());
  const from = shiftDate(today, -rules.windowDays),
    to = shiftDate(today, -1);
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);
  const spendRows = charlieAdSpendRows(input.report, input.fx);
  const adReal = estimateAdRealOrders({
    days: input.days,
    campaigns: input.estimates,
    ads: spendRows,
  });
  const rows = new Map(input.rows.map((row) => [row.key, row]));
  const spendOf = new Map<string, number | null>();
  for (const s of spendRows) {
    if (s.date < from || s.date > to) continue;
    const key = `${s.platform}:${s.accountId}:${s.adId}`;
    const before = spendOf.get(key);
    spendOf.set(
      key,
      before === null || s.spendUsd == null ? null : (before ?? 0) + s.spendUsd,
    );
  }
  const out: CreativeDecision[] = [];
  for (const account of input.report.data.accounts) {
    const platform = account.platform ?? "meta";
    for (const ad of account.ads) {
      const row = rows.get(campaignKey(platform, account.id, ad.campaignId));
      // Unknown campaign: it cannot be verified that it is not a COST CAP.
      if (
        !row ||
        row.type === "COST CAP" ||
        row.status === "pausada" ||
        lowStock(row)
      )
        continue;
      if (/COST[ _-]*CAP/i.test(ad.campaignName ?? "")) continue;
      if (ad.effectiveStatus && ad.effectiveStatus !== "ACTIVE") continue;
      const spend = spendOf.get(`${platform}:${account.id}:${ad.id}`);
      if (spend == null || spend <= 0) continue;
      let real = 0,
        estimated = false,
        known = true;
      for (const date of dates) {
        const day = adReal(platform, account.id, ad.campaignId, ad.id, date);
        if (!day) {
          known = false;
          break;
        }
        real += day.orders;
        if (day.basis === "estimado") estimated = true;
      }
      if (!known || real <= rules.costCapMoreThanOrders) continue;
      const cpa = spend / real;
      if (cpa >= rules.costCapMaxCpaUsd) continue;
      out.push({
        key: `${platform}:${account.id}:${ad.id}`,
        platform,
        accountLabel: row.accountLabel,
        campaignName: row.name,
        adId: ad.id,
        adName: ad.name,
        product: row.product?.name ?? null,
        spendUsd: Math.round(spend * 100) / 100,
        real: Math.round(real * 10) / 10,
        cpaReal: cpa,
        basis: estimated ? "estimado" : "utm",
      });
    }
  }
  return out.sort((a, b) => a.cpaReal - b.cpaReal || b.real - a.real);
}

export interface DecisionCounts {
  escalar: number;
  bajar: number;
  apagar: number;
  aprendizaje: number;
  costCap: number;
  /** Campañas con alerta de hoy. */
  todayAlerts: number;
}

export function decisionCounts(
  campaigns: CampaignDecision[],
  creatives: CreativeDecision[] | null,
): DecisionCounts {
  const n = (action: DecisionAction) =>
    campaigns.filter((c) => c.action === action).length;
  return {
    escalar: n("escalar"),
    bajar: n("bajar"),
    apagar: n("apagar"),
    aprendizaje: n("aprendizaje"),
    costCap: creatives?.length ?? 0,
    todayAlerts: campaigns.filter((c) => c.todayAlert).length,
  };
}
