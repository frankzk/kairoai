// "Pasar a COST CAP" con un botón (25/11/2026): la parte PURA.
//
// Hasta ahora una persona copiaba el Post ID de Acciones y creaba el anuncio
// a mano en Meta. Ahora Kairo lo crea, con un paso de confirmación. Es el
// primer código de Kairo que ESCRIBE en Meta y mueve plata de verdad, así
// que todo lo que decide vive aquí, sin red ni base, y con pruebas
// (tests/marketing-cost-cap-move.test.ts):
//
// - Destino: la campaña COST CAP ACTIVA del MISMO PRODUCTO en cualquier cuenta
//   publicitaria ACTIVA de la tienda (no solo la del anuncio: de las cinco
//   cuentas de Costa Rica solo dos están activas). El producto de cada campaña
//   es la asignación de Marketing (effectiveAssignment); una COST CAP se
//   reconoce igual que en el control de las COST CAP (campaignType: estrategia
//   COST_CAP o "COST CAP" en el nombre). Sin destino, Kairo solo lo dice:
//   nunca crea campañas ni conjuntos.
// - Conjunto: uno ya existente y activo de esa campaña (misma puja y público).
//   Con varios, se sugiere el de más gasto en la ventana y la persona elige.
// - Duplicados: si la publicación ya es un anuncio de esa campaña, "Ya está en
//   la COST CAP" y no hay botón.
// - Nombre del anuncio nuevo: el mismo del original (así se reconoce en Meta
//   y en Publicidad junto a su campaña).
// - Auditoría: una línea del registro manual de cambios que Acciones lee como
//   "Hecho" (doneDetail), con el post, el destino y el anuncio nuevo.
//
// La lectura de Meta y la escritura están en
// lib/marketing-cost-cap-move-server.ts; la ruta, en
// app/api/marketing/cost-cap-move/route.ts.
import type { CampaignActionRow } from "./marketing-actions";
import { campaignType } from "./marketing-actions";
import {
  costCapRuleMet,
  DECISION_RULES,
  doneDetail,
  type DecisionRules,
} from "./marketing-decisions";
import type { MarketingFamily } from "./marketing-product-families";
import { mappingMemberKeys } from "./marketing-real-cpa";
import type { CampaignProduct } from "./marketing-settings-types";

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
const str = (value: unknown) => (typeof value === "string" ? value : "");
const digits = (value: unknown) => {
  const text = str(value);
  return /^\d{1,40}$/.test(text) ? text : "";
};

/* ------------------------------------------------------------ Mensajes */

export const MOVE_TEXT = {
  noDestination:
    "Este producto no tiene campaña COST CAP activa en ninguna cuenta activa.",
  duplicate: "Ya está en la COST CAP.",
  noPost:
    "Este anuncio no tiene una publicación (Post ID) que se pueda reutilizar.",
  noAd: "No se encontró el anuncio en esa cuenta de Meta.",
  alreadyCostCap: "El anuncio ya está en una campaña COST CAP.",
  noProduct:
    "La campaña del anuncio no tiene producto asignado en Marketing: asígnalo para saber cuál es su COST CAP.",
  noAdsets: "La campaña COST CAP no tiene un conjunto de anuncios activo.",
  adsetsUnread:
    "No se pudieron leer los conjuntos de anuncios de esta campaña.",
  duplicatesUnread:
    "No se pudo comprobar si la publicación ya está en esta campaña.",
  badTarget:
    "El conjunto elegido no pertenece a una campaña COST CAP activa de este producto.",
  inProgress:
    "Ya hay una creación en curso para esta publicación. Espera un momento y actualiza.",
} as const;

/* ------------------------------------------------------------ Producto */

/** El producto de una campaña, para saber si dos campañas venden lo mismo. */
export interface MoveProduct {
  key: string;
  name: string;
  familyKey: string | null;
  /** Claves del catálogo que vende (variantes); vacío si no se conocen. */
  members: string[];
}

export function moveProduct(
  mapping: CampaignProduct | null | undefined,
  families: MarketingFamily[],
): MoveProduct | null {
  if (!mapping || mapping.variant_scope === "none" || !mapping.product_key)
    return null;
  return {
    key: mapping.product_key,
    name: mapping.product_name,
    familyKey: mapping.family_key || null,
    members: mappingMemberKeys(mapping, families),
  };
}

/**
 * Mismo producto: comparten alguna variante del catálogo. Si de alguna no se
 * conocen las variantes, la misma clave de producto o de familia.
 */
export function sameProduct(
  a: Pick<MoveProduct, "key" | "familyKey" | "members"> | null,
  b: Pick<MoveProduct, "key" | "familyKey" | "members"> | null,
): boolean {
  if (!a || !b) return false;
  if (a.members.length && b.members.length)
    return a.members.some((key) => b.members.includes(key));
  return (
    a.key === b.key || (a.familyKey != null && a.familyKey === b.familyKey)
  );
}

/** COST CAP como en lib/marketing-cost-cap.ts (tipo de la campaña). */
export const isCostCapCampaign = (campaign: {
  name: string;
  bidStrategy?: string | null;
}) =>
  campaignType({ ...campaign, budgetKind: undefined }, "meta") === "COST CAP";

/* --------------------------------------------- Aviso en Acciones (cliente) */

export interface MoveHintDestination {
  accountId: string;
  accountLabel: string;
  campaignId: string;
  name: string;
}

/**
 * Lo que Acciones puede saber sin preguntarle a Meta: las COST CAP activas
 * del mismo producto entre las campañas ya cargadas. Una cuenta desactivada
 * no gasta, así que solo cuentan las cuentas con gasto reciente en alguna
 * campaña. Es un aviso: la vista previa del servidor es la que manda.
 */
export function costCapHint(
  item: {
    platform: "meta" | "tiktok";
    accountId: string;
    campaignId: string;
  },
  rows: CampaignActionRow[],
  members: ReadonlyMap<string, string[]> | null,
): MoveHintDestination[] {
  if (item.platform !== "meta") return [];
  const product = (row: CampaignActionRow) =>
    row.product
      ? {
          key: row.product.key,
          familyKey: null,
          members: members?.get(row.key) ?? [],
        }
      : null;
  const source = rows.find(
    (row) =>
      row.platform === "meta" &&
      row.accountId === item.accountId &&
      row.campaignId === item.campaignId,
  );
  if (!source) return [];
  const delivering = new Set(
    rows
      .filter(
        (row) =>
          row.platform === "meta" &&
          [row.today, row.yesterday, row.days3].some(
            (w) => (w.spendNative ?? 0) > 0,
          ),
      )
      .map((row) => row.accountId),
  );
  return rows
    .filter(
      (row) =>
        row.platform === "meta" &&
        row.type === "COST CAP" &&
        row.status === "activa" &&
        row.key !== source.key &&
        delivering.has(row.accountId) &&
        sameProduct(product(source), product(row)),
    )
    .map((row) => ({
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      campaignId: row.campaignId,
      name: row.name,
    }));
}

/* ------------------------------------------- Marcador en Publicidad (cliente) */

/**
 * Anuncios "Lista para COST CAP" entre las filas de Publicidad de los últimos
 * 3 días completos: la misma regla de Acciones (compras de Meta y costo por
 * compra en USD), solo anuncios activos que no están ya en una COST CAP (aquí
 * por el nombre de la campaña, que es lo que trae la tabla). Devuelve las
 * claves `cuenta:anuncio`.
 */
export function costCapReadyAds(
  rows: Array<{
    id: string;
    accountId: string;
    status: string;
    campaignName?: string;
    purchases: number | null;
    /** En USD (null = sin tipo de cambio). */
    spend: number | null;
  }>,
  rules: DecisionRules = DECISION_RULES,
): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.status === "active" &&
          !isCostCapCampaign({ name: row.campaignName ?? "" }) &&
          costCapRuleMet(
            { purchases: row.purchases, spendUsd: row.spend },
            rules,
          ),
      )
      .map((row) => `${row.accountId}:${row.id}`),
  );
}

/* ------------------------------------------------- Lo que se lee de Meta */

export interface MoveAccount {
  id: string;
  name: string;
  currency: string;
  /** `account_status` = 1. */
  active: boolean;
}
export interface MoveCampaign {
  accountId: string;
  id: string;
  name: string;
  effectiveStatus: string;
  bidStrategy: string | null;
}
export interface MoveAdset {
  id: string;
  name: string;
  campaignId: string;
  effectiveStatus: string;
  /** Puja en la moneda de la cuenta (null = sin puja propia o moneda sin regla de centavos). */
  bidAmount: number | null;
  bidStrategy: string | null;
  /** Presupuesto diario del conjunto (null en CBO: el presupuesto es de la campaña). */
  dailyBudget: number | null;
  optimizationGoal: string | null;
}
export interface MoveAd {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  adsetId: string;
  campaignId: string;
  creativeId: string | null;
  /** `effective_object_story_id` (página_post). */
  postId: string | null;
  /** Parámetros de URL del creativo (UTM): se copian si hay que crear otro creativo. */
  urlTags: string | null;
}

export function metaMoveCampaign(
  raw: unknown,
  accountId: string,
): MoveCampaign | null {
  const row = obj(raw);
  const id = digits(row.id);
  if (!id) return null;
  return {
    accountId,
    id,
    name: str(row.name) || id,
    effectiveStatus: str(row.effective_status),
    bidStrategy: str(row.bid_strategy) || null,
  };
}

/** Meta manda montos en centavos; solo USD y CRC tienen la regla confirmada. */
const minor = (value: unknown, currency: string): number | null =>
  ["USD", "CRC"].includes(currency) && /^\d+$/.test(String(value ?? ""))
    ? Number(value) / 100
    : null;

export function metaMoveAdset(
  raw: unknown,
  currency: string,
): MoveAdset | null {
  const row = obj(raw);
  const id = digits(row.id),
    campaignId = digits(row.campaign_id);
  if (!id || !campaignId) return null;
  const bid = minor(row.bid_amount, currency),
    daily = minor(row.daily_budget, currency);
  return {
    id,
    name: str(row.name) || id,
    campaignId,
    effectiveStatus: str(row.effective_status),
    bidAmount: bid != null && bid > 0 ? bid : null,
    bidStrategy: str(row.bid_strategy) || null,
    dailyBudget: daily != null && daily > 0 ? daily : null,
    optimizationGoal: str(row.optimization_goal) || null,
  };
}

export function metaMoveAd(raw: unknown): MoveAd | null {
  const row = obj(raw);
  const id = digits(row.id);
  if (!id) return null;
  const creative = obj(row.creative);
  const post =
    str(creative.effective_object_story_id) || str(creative.object_story_id);
  return {
    id,
    name: str(row.name) || id,
    status: str(row.status),
    effectiveStatus: str(row.effective_status),
    adsetId: digits(row.adset_id),
    campaignId: digits(row.campaign_id),
    creativeId: digits(creative.id) || null,
    postId: /^\d{1,40}_\d{1,40}$/.test(post) ? post : null,
    urlTags: str(creative.url_tags).slice(0, 2000) || null,
  };
}

/* ------------------------------------------------------- Vista previa */

export interface MoveAdsetOption extends MoveAdset {
  /** Gasto del conjunto en la ventana, moneda de la cuenta (null = sin dato). */
  spend: number | null;
}
export interface MoveDestination {
  accountId: string;
  accountName: string;
  currency: string;
  /** La misma cuenta del anuncio: se reutiliza su creativo tal cual. */
  sameAccount: boolean;
  campaignId: string;
  campaignName: string;
  /** Gasto de la campaña en la ventana (suma de sus conjuntos; null = sin dato). */
  spend: number | null;
  /** Solo conjuntos ACTIVOS, del de más gasto al de menos. */
  adsets: MoveAdsetOption[];
  suggestedAdsetId: string | null;
  /** La publicación ya es un anuncio de esta campaña. */
  duplicate: { adId: string; name: string } | null;
  /** Por qué no se puede usar este destino (null = se puede). */
  blocked: string | null;
}
export interface MovePreview {
  /** Los últimos 3 días completos (para el gasto de los destinos). */
  window: { from: string; to: string };
  source: {
    accountId: string;
    accountName: string;
    adId: string;
    name: string;
    status: string;
    effectiveStatus: string;
    campaignId: string;
    campaignName: string;
    creativeId: string | null;
    postId: string | null;
    product: string | null;
  } | null;
  destinations: MoveDestination[];
  suggested: { accountId: string; campaignId: string; adsetId: string } | null;
  /** Nombre que llevará el anuncio nuevo. */
  newAdName: string;
  /** Por qué no se puede hacer nada (null = hay al menos un destino usable). */
  blocked: string | null;
  /** Cuentas configuradas que no se ofrecen (desactivadas o sin lectura). */
  skippedAccounts: Array<{
    accountId: string;
    name: string | null;
    reason: string;
  }>;
}

/** Nombre del anuncio nuevo: el del original (máx. 250 caracteres, sin saltos). */
export function newAdName(source: { id: string; name: string }): string {
  const name = source.name
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250)
    .trim();
  return name || `Anuncio ${source.id}`;
}

/**
 * Primer paso: con el anuncio, su campaña y las campañas ACTIVAS de las
 * cuentas ACTIVAS, qué campañas son destino (COST CAP del mismo producto) o
 * por qué no hay ninguno.
 */
export function moveCandidates(input: {
  source: MoveAd | null;
  sourceCampaign: MoveCampaign | null;
  accounts: MoveAccount[];
  /** Campañas de las cuentas leídas (se filtran aquí por activas). */
  campaigns: MoveCampaign[];
  productOf: (campaign: MoveCampaign) => MoveProduct | null;
}): {
  blocked: string | null;
  product: MoveProduct | null;
  candidates: MoveCampaign[];
} {
  const none = (blocked: string, product: MoveProduct | null = null) => ({
    blocked,
    product,
    candidates: [],
  });
  const { source, sourceCampaign } = input;
  if (!source || !sourceCampaign || source.campaignId !== sourceCampaign.id)
    return none(MOVE_TEXT.noAd);
  if (isCostCapCampaign(sourceCampaign)) return none(MOVE_TEXT.alreadyCostCap);
  if (!source.postId) return none(MOVE_TEXT.noPost);
  const product = input.productOf(sourceCampaign);
  if (!product) return none(MOVE_TEXT.noProduct);
  const active = new Set(
    input.accounts.filter((account) => account.active).map((a) => a.id),
  );
  const candidates = input.campaigns.filter(
    (campaign) =>
      active.has(campaign.accountId) &&
      campaign.effectiveStatus === "ACTIVE" &&
      !(
        campaign.accountId === sourceCampaign.accountId &&
        campaign.id === sourceCampaign.id
      ) &&
      isCostCapCampaign(campaign) &&
      sameProduct(product, input.productOf(campaign)),
  );
  return candidates.length
    ? { blocked: null, product, candidates }
    : none(MOVE_TEXT.noDestination, product);
}

const bySpend = <T extends { spend: number | null; name?: string }>(
  a: T,
  b: T,
) => (b.spend ?? -1) - (a.spend ?? -1);

/**
 * Segundo paso: la vista previa completa. `adsets` y `ads` vienen por cuenta
 * (null = esa lectura falló: el destino queda bloqueado, nunca se escribe sin
 * haber comprobado los duplicados). `spend` es el gasto de la ventana por
 * conjunto; si falta, no hay sugerencia por gasto y se usa el primero.
 */
export function buildMovePreview(input: {
  window: { from: string; to: string };
  source: MoveAd | null;
  sourceCampaign: MoveCampaign | null;
  accounts: MoveAccount[];
  skippedAccounts?: MovePreview["skippedAccounts"];
  blocked: string | null;
  product: MoveProduct | null;
  candidates: MoveCampaign[];
  adsets: ReadonlyMap<string, MoveAdset[] | null>;
  ads: ReadonlyMap<string, MoveAd[] | null>;
  spend: ReadonlyMap<string, number> | null;
}): MovePreview {
  const { source, sourceCampaign } = input;
  const account = (id: string) => input.accounts.find((a) => a.id === id);
  const destinations = input.candidates.map((campaign): MoveDestination => {
    const info = account(campaign.accountId);
    const sets = input.adsets.get(campaign.accountId);
    const ads = input.ads.get(campaign.accountId);
    const options = (sets ?? [])
      .filter(
        (set) =>
          set.campaignId === campaign.id && set.effectiveStatus === "ACTIVE",
      )
      .map((set) => ({ ...set, spend: input.spend?.get(set.id) ?? null }))
      .sort((a, b) => bySpend(a, b) || a.name.localeCompare(b.name, "es"));
    const duplicate =
      source?.postId && ads
        ? (ads.find(
            (ad) =>
              ad.campaignId === campaign.id && ad.postId === source.postId,
          ) ?? null)
        : null;
    const spends = options.flatMap((o) => (o.spend == null ? [] : [o.spend]));
    return {
      accountId: campaign.accountId,
      accountName: info?.name ?? campaign.accountId,
      currency: info?.currency ?? "",
      sameAccount: campaign.accountId === sourceCampaign?.accountId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      spend: spends.length
        ? Math.round(spends.reduce((sum, v) => sum + v, 0) * 100) / 100
        : null,
      adsets: options,
      suggestedAdsetId: options[0]?.id ?? null,
      duplicate: duplicate
        ? { adId: duplicate.id, name: duplicate.name }
        : null,
      blocked: duplicate
        ? MOVE_TEXT.duplicate
        : !ads
          ? MOVE_TEXT.duplicatesUnread
          : !sets
            ? MOVE_TEXT.adsetsUnread
            : !options.length
              ? MOVE_TEXT.noAdsets
              : null,
    };
  });
  // Primero la cuenta del anuncio; después, la de más gasto en la ventana.
  destinations.sort(
    (a, b) =>
      Number(b.sameAccount) - Number(a.sameAccount) ||
      // El gasto solo se compara entre cuentas de la misma moneda.
      (a.currency === b.currency ? bySpend(a, b) : 0) ||
      a.campaignName.localeCompare(b.campaignName, "es"),
  );
  const usable = destinations.filter((d) => !d.blocked);
  const pick = usable[0];
  let blocked = input.blocked;
  if (!blocked && !usable.length)
    blocked = !destinations.length
      ? MOVE_TEXT.noDestination
      : destinations.every((d) => d.duplicate)
        ? MOVE_TEXT.duplicate
        : destinations.length === 1
          ? destinations[0].blocked
          : (destinations.find((d) => !d.duplicate)?.blocked ??
            MOVE_TEXT.noDestination);
  return {
    window: input.window,
    source:
      source && sourceCampaign
        ? {
            accountId: sourceCampaign.accountId,
            accountName:
              account(sourceCampaign.accountId)?.name ??
              sourceCampaign.accountId,
            adId: source.id,
            name: source.name,
            status: source.status,
            effectiveStatus: source.effectiveStatus,
            campaignId: sourceCampaign.id,
            campaignName: sourceCampaign.name,
            creativeId: source.creativeId,
            postId: source.postId,
            product: input.product?.name ?? null,
          }
        : null,
    destinations,
    suggested:
      pick && pick.suggestedAdsetId
        ? {
            accountId: pick.accountId,
            campaignId: pick.campaignId,
            adsetId: pick.suggestedAdsetId,
          }
        : null,
    newAdName: source ? newAdName(source) : "",
    blocked: blocked ?? null,
    skippedAccounts: input.skippedAccounts ?? [],
  };
}

/** La elección que llega en el POST contra la vista previa recién leída. */
export function validateMoveTarget(
  preview: MovePreview,
  target: { targetAccount: string; adset: string },
):
  | { ok: true; destination: MoveDestination; adset: MoveAdsetOption }
  | { ok: false; reason: string; duplicate: boolean } {
  const fail = (reason: string, duplicate = false) => ({
    ok: false as const,
    reason,
    duplicate,
  });
  if (!preview.source) return fail(preview.blocked ?? MOVE_TEXT.noAd);
  if (!preview.source.postId) return fail(MOVE_TEXT.noPost);
  const destination = preview.destinations.find(
    (d) =>
      d.accountId === target.targetAccount &&
      d.adsets.some((set) => set.id === target.adset),
  );
  if (!destination)
    return fail(
      preview.destinations.length
        ? MOVE_TEXT.badTarget
        : (preview.blocked ?? MOVE_TEXT.noDestination),
    );
  if (destination.blocked)
    return fail(destination.blocked, Boolean(destination.duplicate));
  return {
    ok: true,
    destination,
    adset: destination.adsets.find((set) => set.id === target.adset)!,
  };
}

/* ---------------------------------------------------------- Auditoría */

/**
 * Lo que identifica "esta publicación en esta campaña" dentro del detalle del
 * registro: lo llevan la reserva y el "Hecho", y con eso una segunda solicitud
 * (otro clic, otra pestaña, otro servidor) ve que ya hay una en curso o hecha.
 */
export const moveMarker = (postId: string, campaignId: string) =>
  `post ${postId} · camp ${campaignId}`;

const CLAIM_PREFIX = "Intento de pasar a COST CAP";

/**
 * Reserva que se anota ANTES de escribir en Meta (no cuenta como "Hecho").
 * Si el anuncio se crea, pasa a ser el "Hecho"; si Meta lo rechaza, se borra;
 * si no se supo qué pasó, queda como rastro del intento.
 */
export function moveClaimDetail(move: {
  adId: string;
  postId: string;
  campaignId: string;
  adsetId: string;
}): string {
  return `${CLAIM_PREFIX}: ${moveMarker(move.postId, move.campaignId)} · conj ${move.adsetId} · anuncio ${move.adId}`
    .slice(0, 200)
    .trim();
}
export const isMoveClaim = (detail: string) => detail.startsWith(CLAIM_PREFIX);

/**
 * El "Hecho" definitivo (≤ 200 caracteres, el límite de la tabla): anuncio de
 * origen (en la marca), publicación, campaña y conjunto destino, anuncio nuevo
 * y, si cabe, la cuenta destino cuando es otra. Quién y cuándo van en sus
 * columnas (created_by, changed_at).
 */
export function moveDoneDetail(move: {
  adId: string;
  postId: string;
  campaignId: string;
  adsetId: string;
  newAdId: string;
  /** Solo cuando la COST CAP está en otra cuenta. */
  targetAccount?: string | null;
}): string {
  const core = `${moveMarker(move.postId, move.campaignId)} · conj ${move.adsetId} · nuevo ${move.newAdId}`;
  const full = move.targetAccount
    ? `${core} · cuenta ${move.targetAccount}`
    : core;
  const detail = doneDetail("costcap", full, move.adId);
  // Si no cabe entera, se sacrifica la cuenta: el conjunto ya dice dónde quedó.
  return detail.endsWith(full)
    ? detail
    : doneDetail("costcap", core, move.adId);
}

/* ------------------------------------------------- Errores al escribir */

export type MoveFailureKind =
  | "token"
  | "permission"
  | "limit"
  | "temporary"
  | "rejected";

export interface MoveFailure {
  kind: MoveFailureKind;
  /** Motivo corto en español; nunca el texto del proveedor. */
  reason: string;
}

const FAILURE_TEXT: Record<MoveFailureKind, string> = {
  token: "El token de Meta venció o no es válido.",
  permission:
    "Meta no dio permiso de escritura (falta ads_management o acceso a la cuenta).",
  limit:
    "Meta alcanzó un límite de la cuenta. Espera unos minutos y reintenta.",
  temporary:
    "Error temporal de Meta. Espera unos minutos y actualiza para ver si el anuncio se creó antes de reintentar.",
  rejected: "El conjunto de anuncios no acepta este anuncio (Meta lo rechazó).",
};

/**
 * Clasifica una respuesta fallida de Meta por su código (nunca por su texto).
 * `http` 0 = no hubo respuesta (red o tiempo de espera): puede que Meta sí
 * haya creado el anuncio, por eso "temporary" manda a revisar antes de
 * reintentar.
 */
export function metaWriteFailure(error: {
  http: number;
  code?: number | null;
  transient?: boolean;
}): MoveFailure {
  const { http, code } = error;
  const kind: MoveFailureKind =
    code === 190 || http === 401
      ? "token"
      : code === 10 ||
          code === 3 ||
          code === 294 ||
          (code != null && code >= 200 && code <= 299) ||
          http === 403
        ? "permission"
        : code === 4 ||
            code === 17 ||
            code === 32 ||
            code === 613 ||
            (code != null && code >= 80000 && code <= 80014) ||
            http === 429
          ? "limit"
          : error.transient ||
              code === 1 ||
              code === 2 ||
              http === 0 ||
              http >= 500
            ? "temporary"
            : "rejected";
  return { kind, reason: FAILURE_TEXT[kind] };
}

export const MOVE_FAILURE_TEXT = FAILURE_TEXT;
