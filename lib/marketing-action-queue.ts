// Cola de acciones de la vista Acciones (rediseño, parte 2): las decisiones
// de lib/marketing-decisions.ts en una sola lista para el media buyer,
// ordenada por impacto, con filtros y el "Hecho" que se guarda en el
// registro manual de cambios. Puro.
//
// Impacto (para ordenar), en USD de los últimos 3 días completos:
// - Apagar y bajar: gasto sobre la meta = gasto − pedidos reales × CPA meta
//   (sin pedidos, todo el gasto). Es la plata que esos días costaron de más.
// - Escalar: pedidos extra esperados con el +20 % si el CPA real se mantiene
//   (pedidos reales × 20 %), valorados al CPA meta.
// - Pasar a COST CAP: igual que escalar con los pedidos reales del anuncio
//   (≈): el COST CAP es otra forma de darle más entrega a lo que ya vende.
// Así todo queda en la misma unidad (pedidos valorados al CPA meta) y la
// lista mezcla acciones de distinto tipo. Empates: apagar → bajar → escalar
// → COST CAP, luego más gasto. Debajo, lo que no se toca hoy (en
// aprendizaje, alertas de hoy sin acción) y al final lo ya hecho.
import type { CampaignChange } from "./marketing-source-types";
import {
  budgetText,
  DECISION_LABEL,
  DECISION_RULES,
  doneDetail,
  LEARNING_TEXT,
  type CampaignDecision,
  type CreativeDecision,
  type DecisionRules,
  type DoneAction,
  type DoneMark,
} from "./marketing-decisions";
import {
  countText,
  dateTimeCrText,
  decimalText,
  moneyText,
} from "./marketing-copy";

export type QueueKind =
  | "apagar"
  | "bajar"
  | "escalar"
  | "costcap"
  | "aprendizaje"
  /** Sin acción hoy, pero con alerta de hoy. */
  | "vigilar";

export const QUEUE_LABEL: Record<QueueKind, string> = {
  apagar: DECISION_LABEL.apagar,
  bajar: DECISION_LABEL.bajar,
  escalar: DECISION_LABEL.escalar,
  costcap: "Pasar a COST CAP",
  aprendizaje: DECISION_LABEL.aprendizaje,
  vigilar: "Mantener",
};

export interface QueueItem {
  key: string;
  kind: QueueKind;
  label: string;
  /** Se puede marcar "Hecho" (escalar, bajar, apagar, COST CAP). */
  actionable: boolean;
  platform: "meta" | "tiktok";
  accountId: string;
  accountLabel: string;
  campaignId: string;
  /** Campaña; para COST CAP, el anuncio. */
  name: string;
  /** Campaña del anuncio (solo COST CAP). */
  campaignName: string | null;
  adId: string | null;
  /** Post ID del anuncio (solo COST CAP): con él se duplica en la COST CAP. */
  postId: string | null;
  type: CampaignDecision["type"] | null;
  product: string | null;
  productKey: string | null;
  spendUsd: number | null;
  real: number | null;
  cpaReal: number | null;
  /** Pedidos reales repartidos (≈). */
  approximate: boolean;
  currency: string;
  budget: number | null;
  suggestedBudget: number | null;
  /** Porqué en una línea: qué regla y con qué números. */
  why: string;
  impactUsd: number;
  /** Impacto en palabras ("≈ USD 35 sobre la meta"); null sin acción. */
  impactText: string | null;
  todayAlert: string | null;
  levelNote: string | null;
  /** Hasta cuándo no se escala (aprendizaje). */
  learningUntil: string | null;
  done: DoneMark | null;
}

export type QueueFilter =
  | "todas"
  | "escalar"
  | "bajar"
  | "apagar"
  | "costcap"
  | "aprendizaje"
  | "alertas";

export const QUEUE_FILTERS: ReadonlyArray<[QueueFilter, string]> = [
  ["todas", "Todas"],
  ["escalar", "Escalar"],
  ["bajar", "Bajar"],
  ["apagar", "Apagar"],
  ["costcap", "Pasar a COST CAP"],
  ["aprendizaje", "En aprendizaje"],
  ["alertas", "Alertas de hoy"],
];

/** Anclas del Resumen → filtro que se abre al llegar. */
export const QUEUE_ANCHORS: Record<string, QueueFilter[]> = {
  "decisiones-escalar": ["escalar"],
  "decisiones-bajar": ["bajar", "apagar"],
  "decisiones-costcap": ["costcap"],
};

export function filterFromAnchor(id: string | null | undefined): QueueFilter[] | null {
  return id ? (QUEUE_ANCHORS[id] ?? null) : null;
}

const usd = (value: number | null) => moneyText(value, "USD");
const usdWhole = (value: number) => budgetText(Math.round(value), "USD");
const orders = (value: number) =>
  Number.isInteger(value) ? countText(value) : decimalText(value);
const round1 = (value: number) => Math.round(value * 10) / 10;

const TIE: Record<QueueKind, number> = {
  apagar: 0,
  bajar: 1,
  escalar: 2,
  costcap: 3,
  aprendizaje: 4,
  vigilar: 5,
};

/** Impacto en USD de la ventana (ver la cabecera del archivo). */
export function queueImpact(
  kind: QueueKind,
  w: { spendUsd: number | null; real: number | null },
  rules: DecisionRules = DECISION_RULES,
): number {
  const spend = w.spendUsd ?? 0,
    real = w.real ?? 0;
  if (kind === "apagar" || kind === "bajar")
    return Math.max(0, spend - real * rules.targetCpaUsd);
  if (kind === "escalar" || kind === "costcap")
    return real * rules.scaleStep * rules.targetCpaUsd;
  return 0;
}

function impactText(
  kind: QueueKind,
  w: { spendUsd: number | null; real: number | null },
  rules: DecisionRules,
): string | null {
  const real = w.real ?? 0;
  if (kind === "apagar" || kind === "bajar") {
    const over = queueImpact(kind, w, rules);
    return over > 0 ? `≈ ${usdWhole(over)} sobre la meta` : null;
  }
  if (kind === "escalar" || kind === "costcap") {
    const extra = round1(real * rules.scaleStep);
    return extra > 0 ? `≈ +${orders(extra)} pedidos` : null;
  }
  return null;
}

function campaignWhy(d: CampaignDecision, rules: DecisionRules): string {
  const { spendUsd, real, cpaReal } = d.window;
  const approx = d.approximate ? "≈ " : "";
  switch (d.action) {
    case "escalar":
      return `CPA real ${approx}${usd(cpaReal)} ≤ ${usd(rules.targetCpaUsd)} con ${approx}${orders(real ?? 0)} pedidos reales (mín. ${countText(rules.scaleMinRealOrders)}).`;
    case "bajar":
      return `CPA real ${approx}${usd(cpaReal)}: sobre ${usd(rules.targetCpaUsd)} y hasta ${usd(rules.lowerMaxCpaUsd)}.`;
    case "apagar":
      return real === 0 || cpaReal == null
        ? `${usd(spendUsd)} sin pedidos reales (se apaga desde ${usd(rules.killNoOrdersSpendUsd)}).`
        : `CPA real ${approx}${usd(cpaReal)}: más de ${usd(rules.lowerMaxCpaUsd)}.`;
    case "aprendizaje":
      if (!d.learning) return d.detail;
      return d.learning.kind === "nueva"
        ? `CPA real ${approx}${usd(cpaReal)} en meta, pero ${LEARNING_TEXT.nueva}.`
        : `CPA real ${approx}${usd(cpaReal)} en meta, pero ${LEARNING_TEXT[d.learning.kind]}.`;
    default:
      return d.detail;
  }
}

const until = (at: string, rules: DecisionRules) =>
  new Date(Date.parse(at) + rules.learningHours * 3_600_000).toISOString();

export function campaignQueueItem(
  d: CampaignDecision,
  rules: DecisionRules = DECISION_RULES,
): QueueItem | null {
  // A scale marked "Hecho" moves to learning: it stays the scale it was.
  const kind: QueueKind | null =
    d.action === "aprendizaje" && d.done?.action === "escalar"
      ? "escalar"
      : d.action === "escalar" ||
          d.action === "bajar" ||
          d.action === "apagar" ||
          d.action === "aprendizaje"
        ? d.action
        : d.todayAlert
          ? "vigilar"
          : null;
  if (!kind) return null;
  const w = { spendUsd: d.window.spendUsd, real: d.window.real };
  const learningAt =
    d.learning?.at ?? (kind === "escalar" && d.done ? d.done.at : null);
  return {
    key: d.key,
    kind,
    label: QUEUE_LABEL[kind],
    actionable: kind !== "aprendizaje" && kind !== "vigilar",
    platform: d.platform,
    accountId: d.accountId,
    accountLabel: d.accountLabel,
    campaignId: d.campaignId,
    name: d.name,
    campaignName: null,
    adId: null,
    postId: null,
    type: d.type,
    product: d.product,
    productKey: d.productKey,
    spendUsd: d.window.spendUsd,
    real: d.window.real,
    cpaReal: d.window.cpaReal,
    approximate: d.approximate,
    currency: d.currency,
    budget: d.dailyBudget,
    suggestedBudget: d.suggestedBudget,
    why:
      kind === "escalar" && d.action === "aprendizaje"
        ? `CPA real ${d.approximate ? "≈ " : ""}${usd(d.window.cpaReal)} ≤ ${usd(rules.targetCpaUsd)} con ${d.approximate ? "≈ " : ""}${orders(d.window.real ?? 0)} pedidos reales.`
        : campaignWhy(d, rules),
    impactUsd: queueImpact(kind, w, rules),
    impactText: impactText(kind, w, rules),
    todayAlert: d.todayAlert,
    levelNote: d.levelNote,
    learningUntil:
      learningAt && (kind === "aprendizaje" || d.done)
        ? until(learningAt, rules)
        : null,
    done: d.done,
  };
}

export function creativeQueueItem(
  c: CreativeDecision,
  rules: DecisionRules = DECISION_RULES,
): QueueItem {
  const approx = c.basis === "estimado" ? "≈ " : "";
  const w = { spendUsd: c.spendUsd, real: c.real };
  return {
    key: `costcap:${c.key}`,
    kind: "costcap",
    label: QUEUE_LABEL.costcap,
    actionable: true,
    platform: c.platform,
    accountId: c.accountId,
    accountLabel: c.accountLabel,
    campaignId: c.campaignId,
    name: c.adName,
    campaignName: c.campaignName,
    adId: c.adId,
    postId: c.postId,
    type: null,
    product: c.product,
    productKey: c.productKey,
    spendUsd: c.spendUsd,
    real: c.real,
    cpaReal: c.cpaReal,
    approximate: c.basis === "estimado",
    currency: "USD",
    budget: null,
    suggestedBudget: null,
    why: `${approx}${orders(c.real)} pedidos reales (más de ${countText(rules.costCapMoreThanOrders)}) y CPA real ${approx}${usd(c.cpaReal)} < ${usd(rules.costCapMaxCpaUsd)}.`,
    impactUsd: queueImpact("costcap", w, rules),
    impactText: impactText("costcap", w, rules),
    todayAlert: null,
    levelNote: null,
    learningUntil: null,
    done: c.done,
  };
}

/** Grupo de la fila: pendiente (se toca hoy), sin acción hoy o ya hecha. */
export function queueGroup(item: QueueItem): "pendiente" | "espera" | "hecha" {
  if (item.done) return "hecha";
  return item.actionable ? "pendiente" : "espera";
}

const GROUP_ORDER = { pendiente: 0, espera: 1, hecha: 2 } as const;

/** Cola completa ordenada (pendientes por impacto, luego en espera, luego hechas). */
export function buildActionQueue(input: {
  campaigns: CampaignDecision[];
  creatives: CreativeDecision[] | null;
  rules?: DecisionRules;
  /** Marcadas "Hecho" en esta sesión: no saltan al final mientras se mira la lista. */
  keepInPlace?: ReadonlySet<string>;
}): QueueItem[] {
  const rules = input.rules ?? DECISION_RULES;
  const keep = input.keepInPlace;
  const group = (item: QueueItem) =>
    keep?.has(item.key) && item.done
      ? queueGroup({ ...item, done: null })
      : queueGroup(item);
  const items = [
    ...input.campaigns
      .map((d) => campaignQueueItem(d, rules))
      .filter((i): i is QueueItem => i != null),
    ...(input.creatives ?? []).map((c) => creativeQueueItem(c, rules)),
  ];
  return items.sort((a, b) => {
    const ga = group(a),
      gb = group(b);
    if (ga !== gb) return GROUP_ORDER[ga] - GROUP_ORDER[gb];
    if (ga === "hecha")
      return Date.parse(b.done!.at) - Date.parse(a.done!.at);
    return (
      b.impactUsd - a.impactUsd ||
      TIE[a.kind] - TIE[b.kind] ||
      (b.spendUsd ?? -1) - (a.spendUsd ?? -1) ||
      a.name.localeCompare(b.name, "es")
    );
  });
}

export function matchesFilter(item: QueueItem, filter: QueueFilter): boolean {
  if (filter === "todas") return true;
  if (filter === "alertas") return item.todayAlert != null;
  return item.kind === filter;
}

/** Filas de los filtros elegidos (varios = unión: "bajar o apagar" desde el Resumen). */
export function filterQueue(items: QueueItem[], filters: QueueFilter[]): QueueItem[] {
  if (!filters.length || filters.includes("todas")) return items;
  return items.filter((item) => filters.some((f) => matchesFilter(item, f)));
}

/**
 * Conteo de cada filtro. Las acciones cuentan solo lo pendiente (como los
 * contadores del Resumen); "Todas" cuenta todo lo pendiente; "En
 * aprendizaje" y "Alertas de hoy" cuentan lo que hay (no se marcan).
 */
export function queueCounts(items: QueueItem[]): Record<QueueFilter, number> {
  const pending = items.filter((i) => !i.done);
  const n = (f: QueueFilter, list = pending) =>
    list.filter((i) => matchesFilter(i, f)).length;
  return {
    todas: pending.filter((i) => i.actionable).length,
    escalar: n("escalar"),
    bajar: n("bajar"),
    apagar: n("apagar"),
    costcap: n("costcap"),
    aprendizaje: n("aprendizaje"),
    alertas: n("alertas", items),
  };
}

/** Quien puede marcar "Hecho": editores, con el registro de cambios disponible, en una acción pendiente. */
export function canMarkDone(
  item: Pick<QueueItem, "actionable" | "done">,
  access: { canEdit: boolean; changesReady: boolean },
): boolean {
  return access.canEdit && access.changesReady && item.actionable && !item.done;
}

const DONE_KIND: Record<DoneAction, CampaignChange["kind"]> = {
  // Presupuesto: reinicia el aprendizaje (no se escala en 72 h).
  escalar: "presupuesto",
  bajar: "presupuesto",
  // Pausar: la campaña sale de la cola cuando Meta la reporta pausada.
  apagar: "estado",
  // Duplicar el anuncio en una COST CAP no toca la campaña de origen:
  // "creativo" no reinicia su aprendizaje.
  costcap: "creativo",
};

/** Texto del cambio que se registra. */
export function doneText(item: QueueItem): string {
  if (item.kind === "costcap")
    return `${item.label} · post ${item.postId ?? "sin dato"} · anuncio ${item.name}`;
  const budget =
    item.budget != null && item.suggestedBudget != null
      ? ` · ${budgetText(item.budget, item.currency)} → ${budgetText(item.suggestedBudget, item.currency)}`
      : "";
  return `${item.label}${budget}`;
}

/**
 * Cuerpo de POST /api/marketing/changes para "Hecho" (el mismo registro que
 * "Registrar cambio"). Lo valida la ruta: cuenta autorizada, campaña
 * numérica, tipo, detalle ≤ 200 y fecha no futura.
 */
export function markDonePayload(
  item: QueueItem,
  now: Date = new Date(),
): Record<string, unknown> {
  if (!item.actionable)
    throw new Error("Solo se marca Hecho una acción pendiente.");
  const action = item.kind as DoneAction;
  const productKey =
    item.productKey && item.productKey.length >= 5 && item.productKey.length <= 300
      ? item.productKey
      : null;
  return {
    platform: item.platform,
    account_id: item.accountId,
    campaign_id: item.campaignId,
    campaign_name: (item.campaignName ?? item.name).slice(0, 300),
    product_key: productKey,
    kind: DONE_KIND[action],
    detail: doneDetail(action, doneText(item), item.adId),
    changed_at: now.toISOString(),
  };
}

/** "recién", "hace 5 min", "hace 3 h", "hace 2 d". */
export function agoText(at: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${countText(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${countText(hours)} h`;
  return `hace ${countText(Math.floor(hours / 24))} d`;
}

/** "Se puede escalar desde el 16 nov, 14:35". */
export function learningUntilText(iso: string): string {
  return `No se escala hasta el ${dateTimeCrText(iso)}`;
}
