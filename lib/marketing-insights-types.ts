// Tipos de /api/marketing/insights (módulos 4–12 del documento de mejoras).
// Sin dependencias de servidor: los componentes los importan directamente.
// Nada de esto lleva nombres, teléfonos, direcciones ni números de pedido:
// solo agregados o tuplas anónimas.
import type { MotivoMarketing } from "./anulacion-motivos";
import type { CrProvince } from "./cr-provinces";
import type { UsdRate } from "./marketing-charlie-types";

export type InsightSection =
  | "pedidos"
  | "productos"
  | "cuentas"
  | "segmentacion";

/* ---------- Pedidos (M7 cancelaciones, M8 origen y complementos, M10, M12) ---------- */

export type OrderOrigin =
  | "shopify"
  | "carrito"
  | "bot"
  | "asesora"
  | "formulario";

export const ORDER_ORIGINS: readonly OrderOrigin[] = [
  "shopify",
  "carrito",
  "bot",
  "asesora",
  "formulario",
];

export const ORDER_ORIGIN_LABEL: Record<OrderOrigin, string> = {
  shopify: "Shopify",
  carrito: "Carrito recuperado",
  bot: "Bot de WhatsApp e IA",
  asesora: "Creado por asesora",
  formulario: "Formulario iComfly",
};

/** 0 real, 1 anulado, 2 no cuenta (iComfly Testeos / Producto Agotado). */
export type FactState = 0 | 1 | 2;

/**
 * One order: CR creation day, state, reason code (only when annulled, never
 * free text), origin, province ("" = unknown) and product indexes into
 * `products` in line order (first = principal).
 */
export type OrderFactRow = [
  date: string,
  state: FactState,
  reason: MotivoMarketing | "",
  origin: OrderOrigin,
  province: CrProvince | "",
  items: number[],
];

export interface RepeatOrdersDay {
  date: string;
  /** Non-annulled orders created that CR day. */
  orders: number;
  /** Of those, phone already bought (non-annulled) at least `repeatMinDays` before. */
  repeat: number;
}

export interface OrderFactsPayload {
  /** Requested period (CR dates, inclusive). */
  from: string;
  to: string;
  today: string;
  generatedAt: string;
  /** First CR date present in `facts` (≤ from: always ≥ 5 weeks for complement drops). */
  loadedFrom: string;
  /** Short product names for display, indexed by `OrderFactRow.items`. */
  products: string[];
  /** Full product names (same index), for `title`. */
  titles: string[];
  facts: OrderFactRow[];
  repeat: {
    status: "ok" | "pending_migration" | "error";
    days: RepeatOrdersDay[];
  };
  /** True when the page limit cut the read: numbers are partial. */
  truncated: boolean;
}

/* ---------- Productos (M5 variantes y esperando, M6 semanas) ---------- */

export interface WaitingStock {
  /** Confirmed in iComfly, no guide, not annulled, older than `waitingMinHours`. */
  confirmedNoGuide: number;
  /** iComfly status "Producto Agotado". */
  agotado: number;
  /** Age in whole days of the oldest waiting order (0 when none). */
  oldestDays: number;
}

export interface ProductInsightsPayload {
  today: string;
  generatedAt: string;
  /** 8 blocks of 7 complete CR days ending yesterday, newest first. */
  blocks: Array<{ from: string; to: string }>;
  /** Product key → real units per block (same order as `blocks`). */
  units: Record<string, number[]>;
  /** Product key → real units of the last 7 complete days (= units[key][0]). */
  variantUnits7d: Record<string, number>;
  /** Product key → orders waiting (iComfly proxy). */
  waiting: Record<string, WaitingStock>;
  /** False when the catalog could not be read: keys are the plain order keys. */
  variantAware: boolean;
}

/* ---------- Cuentas (M11) ---------- */

export type MetaAccountState =
  | "activa"
  | "deshabilitada"
  | "pago_pendiente"
  | "en_revision"
  | "periodo_gracia"
  | "cerrada"
  | "sin_acceso"
  | "error";

export interface MetaAccountStatus {
  accountId: string;
  name: string | null;
  state: MetaAccountState;
  statusCode: number | null;
  disableReason: number | null;
  currency: string | null;
  /** Account currency units (Meta sends minor units; already divided by 100). */
  amountSpent: number | null;
  /** Account currency units; null when no cap. */
  spendCap: number | null;
}

export interface TiktokFeedStatus {
  advertiserId: string;
  name: string;
  /** Last CR date with spend sent by Make. */
  lastDate: string | null;
  /** Last time Make wrote a row (ISO). */
  updatedAt: string | null;
}

export interface AccountsPayload {
  checkedAt: string;
  /** null when Meta is not configured or the account list is invalid. */
  meta: MetaAccountStatus[] | null;
  metaError: boolean;
  tiktok: TiktokFeedStatus[];
  tiktokError: boolean;
  fx: UsdRate;
}

/* ---------- Segmentación (M12) ---------- */

export interface AgeGenderRow {
  accountId: string;
  currency: string;
  age: string;
  gender: "female" | "male" | "unknown";
  /** Account currency. */
  spend: number;
  /** Pixel purchases (same attribution as the campaign sources). */
  purchases: number;
}

export interface SegmentationPayload {
  from: string;
  to: string;
  rows: AgeGenderRow[];
  /** Account ids that could not be read. */
  failed: string[];
  configured: boolean;
}
