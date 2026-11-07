// Inventario para decidir (documento de mejoras, módulo 5): una fila por
// presentación (cada SKU por separado: Shilajit cápsulas, gomitas y puro no
// se agrupan) con disponible, pedidos esperando, unidades en camino, venta
// diaria, días de cobertura, reposición desde el archivo anterior y si tiene
// un anuncio activo; la matriz de talla × color; y las alertas "anuncio
// activo sin stock", "pedidos esperando stock" y "entró reposición".
// Pedidos esperando y en camino solo existen si el product_table trae esas
// columnas (o, en camino, el plan manual del producto); sin ellas se dice.
// Puro: se prueba en tests/marketing-inventory-decide.test.ts.
import type {
  MarketingInventory,
  MarketingStock,
} from "./marketing-source-types";
import type { ProductPlan } from "./marketing-settings-types";
import type { MarketingFamily } from "./marketing-product-families";
import type { CampaignActionRow } from "./marketing-actions";
import type { WaitingStock } from "./marketing-insights-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { coverageOf, restockDelta, type Coverage } from "./marketing-coverage";
import { countText, shortDateText } from "./marketing-copy";
import { marketingDate, shiftDate } from "./marketing-dates";

/* ---------- Talla y color desde el SKU y el nombre ---------- */

export interface VariantAttrs {
  /** SKU without color/size tokens, lowercase, "." separated. */
  base: string;
  color: string | null;
  size: string | null;
}

const COLORS: Record<string, string> = {
  negro: "Negro",
  black: "Negro",
  beige: "Beige",
  nude: "Nude",
  blanco: "Blanco",
  white: "Blanco",
  gris: "Gris",
  gray: "Gris",
  grey: "Gris",
  rosa: "Rosa",
  pink: "Rosa",
  azul: "Azul",
  blue: "Azul",
  cafe: "Café",
  brown: "Café",
  piel: "Piel",
  rojo: "Rojo",
  red: "Rojo",
  verde: "Verde",
  green: "Verde",
  morado: "Morado",
};

/** Canonical size order (also the column order of the matrix). */
export const SIZE_ORDER = [
  "XS",
  "S",
  "S/M",
  "M",
  "L",
  "L/XL",
  "XL",
  "XXL",
  "XXXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "Talla única",
] as const;
const SIZES: Record<string, string> = {
  xs: "XS",
  s: "S",
  "s/m": "S/M",
  m: "M",
  l: "L",
  "l/xl": "L/XL",
  xl: "XL",
  xxl: "XXL",
  xxxl: "XXXL",
  "2xl": "2XL",
  "3xl": "3XL",
  "4xl": "4XL",
  "5xl": "5XL",
  unica: "Talla única",
  talla_unica: "Talla única",
  "talla unica": "Talla única",
};

const fold = (value: string) =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "S/M", "L/XL" stay one token; any other "/" separates. */
function skuTokens(sku: string): string[] {
  return fold(sku)
    .split(/[.\-_\s]+/)
    .flatMap((token) => (SIZES[token] ? [token] : token.split("/")))
    .filter(Boolean);
}

/** Color and size of the variant text of a name ("… - Negro / Talla única", "Color: Negro · Talla: M"). */
function nameAttributes(name: string): {
  color: string | null;
  size: string | null;
} {
  const folded = fold(name);
  const variant = folded.includes(" - ")
    ? folded.slice(folded.lastIndexOf(" - ") + 3)
    : /\b(color|talla)\s*:/.test(folded)
      ? folded
      : "";
  if (!variant) return { color: null, size: null };
  let color: string | null = null,
    size: string | null = null;
  const labelled = /talla\s*:\s*([a-z0-9/ ]+?)(?:\s*[·|,]|$)/.exec(variant);
  if (labelled) size = SIZES[labelled[1].trim()] ?? null;
  if (/\btalla\s+unica\b/.test(variant)) size = "Talla única";
  // A whole segment ("Beige / M") may be a one-letter size; a loose word may not.
  for (const segment of variant.split(/[/·|,]/))
    if (!size && SIZES[segment.trim()]) size = SIZES[segment.trim()];
  for (const part of variant
    .replace(/\b(color|talla)\s*:/g, " ")
    .split(/[\s/·|,()]+/)
    .filter(Boolean)) {
    if (!color && COLORS[part]) color = COLORS[part];
    if (!size && SIZES[part] && part.length > 1) size = SIZES[part];
  }
  return { color, size };
}

/**
 * Color and size encoded in a SKU (`FAT.BURN.NEGRO.S` → Negro, S), with the
 * product name as fallback. The first SKU token is never read as an
 * attribute (it names the product).
 */
export function variantAttributes(sku: string, name = ""): VariantAttrs {
  const tokens = skuTokens(sku);
  let color: string | null = null,
    size: string | null = null;
  const base: string[] = [];
  tokens.forEach((token, i) => {
    if (i > 0 && !color && COLORS[token]) {
      color = COLORS[token];
      return;
    }
    if (i > 0 && token === "talla" && SIZES[tokens[i + 1] ?? ""]) return;
    if (i > 0 && !size && SIZES[token]) {
      size = SIZES[token];
      return;
    }
    base.push(token);
  });
  const fromName = nameAttributes(name);
  return {
    base: base.join("."),
    color: color ?? fromName.color,
    size: size ?? fromName.size,
  };
}

/* ---------- Decisión por presentación ---------- */

/** Where the stock came from: the uploaded product_table or the ShipHero API. */
export type StockSource = "csv" | "shiphero";

/** ShipHero cron (vercel.json "13 0,12,16,20 * * *", UTC = 18:13, 06:13, 10:13 y 14:13 en CR). */
const SHIPHERO_RUNS_UTC_MIN = [13, 12 * 60 + 13, 16 * 60 + 13, 20 * 60 + 13];
/** Time a scheduled run may take (with retries) before it counts as missed. */
const SHIPHERO_RUN_GRACE_MS = 45 * 60_000;

/**
 * Snapshot date when the inventory is too old to drive stock rules, else null.
 * CSV (uploaded by hand once a day): older than yesterday. ShipHero (synced 4
 * times a day): one missed run is tolerated, two in a row are not, so a broken
 * sync shows the same day. A live read (no snapshotDate) is never stale.
 */
export function inventoryStaleDate(
  inventory: Pick<MarketingInventory, "origin" | "snapshotDate" | "uploadedAt">,
  now: Date = new Date(),
): string | null {
  const date = inventory.snapshotDate;
  if (!date) return null;
  const uploaded = inventory.uploadedAt ? Date.parse(inventory.uploadedAt) : NaN;
  if (inventory.origin !== "shiphero" || !Number.isFinite(uploaded))
    return date < shiftDate(marketingDate(now), -1) ? date : null;
  const due = now.getTime() - SHIPHERO_RUN_GRACE_MS;
  const runs: number[] = [];
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  for (let day = 0; day < 3; day++)
    for (const minute of SHIPHERO_RUNS_UTC_MIN) {
      const at = midnight - day * 86_400_000 + minute * 60_000;
      if (at <= due) runs.push(at);
    }
  runs.sort((a, b) => b - a);
  // Older than the second-to-last run that should have finished.
  return runs.length > 1 && uploaded < runs[1] - 5 * 60_000 ? date : null;
}

/**
 * "Old inventory" warning by source. `date` is the display text of the
 * snapshot date. The CSV wording is the original one.
 */
export function staleInventoryText(source: StockSource, date: string): string {
  return source === "shiphero"
    ? `El inventario de ShipHero es del ${date}. Revisa la conexión en Fuentes.`
    : `El inventario es del ${date}. Sube el archivo de hoy.`;
}

/** No earlier snapshot to compare restock against, by source. */
export function noPreviousSnapshotText(source: StockSource): string {
  return source === "shiphero"
    ? "Sin registro de reposición (falta la foto de ShipHero de un día anterior)."
    : "Sin registro de reposición (falta el archivo de un día anterior).";
}

/** Why orders waiting / units on the way are missing, by stock source. */
export function missingStockColumnsText(
  source: StockSource,
  missing: { backorder?: boolean; incoming?: boolean },
): string {
  const both = Boolean(missing.backorder && missing.incoming);
  if (source === "shiphero")
    return both
      ? "Sin pedidos esperando ni unidades en camino: el inventario de ShipHero no trae esos datos."
      : missing.backorder
        ? "Sin pedidos esperando: el inventario de ShipHero no trae ese dato."
        : "Sin unidades en camino: el inventario de ShipHero no trae ese dato.";
  return both
    ? "Sin pedidos esperando ni unidades en camino: el archivo product_table no trae esas columnas (Backorder, Incoming)."
    : missing.backorder
      ? "Sin pedidos esperando: el archivo product_table no trae la columna Backorder."
      : "Sin unidades en camino: el archivo product_table no trae esa columna.";
}

export interface InventoryAlert {
  code:
    | "anuncio_sin_stock"
    | "variantes_agotadas"
    | "esperando_stock"
    | "reposicion"
    | "inventario_viejo";
  tone: "risk" | "good" | "wait";
  key: string;
  title: string;
  detail: string;
}

export interface ActiveAd {
  key: string;
  name: string;
  accountLabel: string;
  platform: "meta" | "tiktok";
}

export interface PresentationRow {
  /** Product key (`sku:…`); stock-only SKUs use `sku:<sku>`. */
  key: string;
  sku: string;
  name: string;
  familyKey: string | null;
  /** Clamped at 0; null = no stock row (or duplicated SKU). */
  available: number | null;
  /** Orders waiting for stock (CSV Backorder); null = no data. */
  backorder: number | null;
  /** Units on the way: CSV Incoming, or the manual product plan. */
  incoming: number | null;
  incomingSource: "csv" | "plan" | null;
  dailyUnits: number;
  coverage: Coverage;
  /** Units that came in since the previous file; null without a previous file. */
  restocked: number | null;
  /** iComfly orders confirmed without guide / Producto Agotado (proxy). */
  waitingProxy: number | null;
  activeAds: ActiveAd[];
  /** In the sold catalog (false = only in the stock file). */
  cataloged: boolean;
}

export interface SizeColorCell {
  color: string | null;
  size: string | null;
  sku: string;
  available: number | null;
  backorder: number | null;
  dailyUnits: number | null;
}

export interface SizeColorGroup {
  base: string;
  name: string;
  colors: string[];
  sizes: string[];
  cells: SizeColorCell[];
  /** Σ available of the cells. */
  total: number;
}

export interface InventoryDecision {
  rows: PresentationRow[];
  sizeColor: SizeColorGroup[];
  alerts: InventoryAlert[];
  /** Restocks since the previous file (≥ restockAlertMinUnits, SKU already there), largest first. */
  restocks: Array<{ sku: string; name: string; delta: number }>;
  /** Stock SKUs that are not in the sold catalog. */
  uncataloged: number;
  /** Demand comes from the per-variant insight (talla/color separated). */
  variantDemand: boolean;
  notes: string[];
}

export const VARIANT_DEMAND_MISSING =
  "Venta por talla y color no disponible: iComfly no separa la variante en estos pedidos.";

const skuKey = (sku: string) => sku.trim().toLowerCase();

/** SKU → summed value; duplicated SKUs (several rows) are unknown (null), like stockIndex. */
function fieldIndex(
  stock: MarketingStock[],
  field: "available" | "backorder" | "incoming",
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of stock) {
    const key = skuKey(row.sku);
    if (!key) continue;
    const raw = row[field];
    const value =
      raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
    out.set(key, out.has(key) ? null : value);
  }
  return out;
}

/** "Fat Burn Shorts - Negro / Talla única" → "Fat Burn Shorts". */
const productName = (name: string) => {
  const cut = name.split(/\s+[-–—]\s+/)[0] ?? name;
  return cut.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
};

const listText = (items: string[], max = 2) =>
  items.length <= max
    ? items.join(", ")
    : `${items.slice(0, max).join(", ")} y ${countText(items.length - max)} más`;

/** Variants named in a grouped alert before "y N más". */
export const VARIANT_LIST_MAX = 6;

const lower = (value: string) => value.toLocaleLowerCase("es").trim();

/**
 * Short name of a variant inside its product ("Negro / S"): the Shopify
 * variant title, else color and size read from the SKU or the name, else the
 * name without the product part, else the SKU.
 */
export function variantLabel(
  row: { key: string; sku: string; name: string },
  family?: Pick<MarketingFamily, "name" | "members"> | null,
): string {
  const familyName = family?.name?.trim() ?? "";
  const member = family?.members.find((m) => m.key === row.key);
  const title = member?.name?.trim() ?? "";
  if (
    title &&
    title !== row.name.trim() &&
    title !== member?.sku &&
    lower(title) !== lower(familyName) &&
    !/^default title$/i.test(title)
  )
    return title;
  const attrs = variantAttributes(row.sku, row.name);
  const parts = [attrs.color, attrs.size].filter(Boolean);
  if (parts.length) return parts.join(" / ");
  for (const base of [familyName, productName(row.name)]) {
    if (!base || !lower(row.name).startsWith(lower(base))) continue;
    const rest = row.name
      .slice(base.length)
      .replace(/^[\s\-–—:·/|,(]+/, "")
      .replace(/\)\s*$/, "")
      .trim();
    if (rest) return rest;
  }
  return row.sku.trim() || row.name;
}

/** "Negro / S, Beige / M y 3 más": variant labels, repeated ones told apart by SKU. */
export function variantListText(
  rows: Array<{ key: string; sku: string; name: string }>,
  family?: Pick<MarketingFamily, "name" | "members"> | null,
  max = VARIANT_LIST_MAX,
): string {
  const labels = rows.map((row) => variantLabel(row, family));
  const seen = new Map<string, number>();
  for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);
  return listText(
    labels.map((label, i) =>
      (seen.get(label) ?? 0) > 1 && rows[i].sku && label !== rows[i].sku
        ? `${label} (${rows[i].sku})`
        : label,
    ),
    max,
  );
}

/** A campaign that is selling now: Meta active, TikTok with spend in the last reported days. */
export function isAdActive(
  row: Pick<CampaignActionRow, "platform" | "status" | "today" | "days3">,
): boolean {
  if (row.platform === "meta") return row.status === "activa";
  if (row.status === "pausada") return false;
  return (row.days3.spendNative ?? 0) > 0 || (row.today.spendNative ?? 0) > 0;
}

export function buildInventoryDecision(input: {
  products: Array<{
    key: string;
    sku: string;
    name: string;
    recentUnits: number;
  }>;
  stock: MarketingStock[];
  previous: MarketingStock[] | null;
  /** Whether the uploaded CSV had the columns (undefined = ShipHero/none). */
  columns?: { backorder: boolean; incoming: boolean } | null;
  /** Default "csv"; only changes the "sin dato" notes. */
  source?: StockSource;
  plans: ProductPlan[];
  actionRows: CampaignActionRow[];
  /** Campaign key → catalog keys it sells (from assignedCampaigns); families are the fallback. */
  campaignMembers?: Map<string, string[]> | null;
  families: MarketingFamily[];
  /** Per-variant units of the last 7 complete days (products insight). */
  variantUnits7d?: Record<string, number> | null;
  waiting?: Record<string, WaitingStock> | null;
  /** Date of the stock file when it is older than yesterday. */
  staleDate?: string | null;
  t?: MarketingTargets;
}): InventoryDecision {
  const t = input.t ?? MARKETING_TARGETS;
  const columns = input.columns ?? { backorder: false, incoming: false };
  const available = fieldIndex(input.stock, "available");
  const backorders = columns.backorder
    ? fieldIndex(input.stock, "backorder")
    : null;
  const incomings = columns.incoming
    ? fieldIndex(input.stock, "incoming")
    : null;
  const restock = input.previous
    ? restockDelta(input.stock, input.previous)
    : null;
  const plans = new Map(input.plans.map((p) => [p.product_key, p]));
  const variantDemand = Boolean(input.variantUnits7d);
  const familyOf = new Map<string, string>();
  for (const family of input.families)
    for (const member of family.members) familyOf.set(member.key, family.key);

  // Catalog key → active campaigns selling it.
  const adsByKey = new Map<string, ActiveAd[]>();
  for (const row of input.actionRows) {
    if (!row.product || !isAdActive(row)) continue;
    const family = input.families.find((f) => f.key === row.product!.key);
    const keys =
      input.campaignMembers?.get(row.key) ??
      (family ? family.members.map((m) => m.key) : [row.product.key]);
    for (const key of Array.from(new Set(keys))) {
      const list = adsByKey.get(key) ?? [];
      list.push({
        key: row.key,
        name: row.name,
        accountLabel: row.accountLabel,
        platform: row.platform,
      });
      adsByKey.set(key, list);
    }
  }

  const bySku = new Map<
    string,
    { key: string; sku: string; name: string; recentUnits: number }
  >();
  const entries: Array<{
    key: string;
    sku: string;
    name: string;
    recentUnits: number;
    cataloged: boolean;
  }> = [];
  for (const p of input.products) {
    const sku = skuKey(p.sku);
    if (sku) bySku.set(sku, p);
    entries.push({ ...p, cataloged: true });
  }
  let uncataloged = 0;
  const seenStock = new Set<string>();
  for (const s of input.stock) {
    const sku = skuKey(s.sku);
    if (!sku || bySku.has(sku) || seenStock.has(sku)) continue;
    seenStock.add(sku);
    uncataloged++;
    entries.push({
      key: `sku:${sku}`,
      sku: s.sku.trim(),
      name: s.sku.trim(),
      recentUnits: 0,
      cataloged: false,
    });
  }

  const rows: PresentationRow[] = [];
  for (const e of entries) {
    const sku = skuKey(e.sku);
    const known = sku ? available.has(sku) : false;
    const rawAvailable = known ? available.get(sku)! : null;
    const units = variantDemand
      ? (input.variantUnits7d![e.key] ?? 0)
      : e.recentUnits;
    const coverage = coverageOf(rawAvailable, units, t, {
      ambiguous: known && rawAvailable == null,
    });
    const backorder = backorders && sku ? (backorders.get(sku) ?? null) : null;
    const csvIncoming = incomings && sku ? (incomings.get(sku) ?? null) : null;
    const planIncoming = plans.get(e.key)?.incoming_units ?? 0;
    const incoming =
      csvIncoming != null
        ? csvIncoming
        : planIncoming > 0
          ? planIncoming
          : null;
    const waiting = input.waiting?.[e.key];
    const row: PresentationRow = {
      key: e.key,
      sku: e.sku,
      name: e.name,
      familyKey: familyOf.get(e.key) ?? null,
      available: rawAvailable == null ? null : Math.max(0, rawAvailable),
      backorder,
      incoming,
      incomingSource:
        csvIncoming != null ? "csv" : planIncoming > 0 ? "plan" : null,
      dailyUnits: units / 7,
      coverage,
      restocked: restock ? (sku ? (restock.get(sku) ?? 0) : 0) : null,
      waitingProxy: waiting ? waiting.confirmedNoGuide + waiting.agotado : null,
      activeAds: adsByKey.get(e.key) ?? [],
      cataloged: e.cataloged,
    };
    // A catalog product nobody stocks or sells adds nothing.
    if (
      row.available == null &&
      units <= 0 &&
      !row.backorder &&
      row.incoming == null &&
      !row.waitingProxy &&
      !row.activeAds.length
    )
      continue;
    rows.push(row);
  }
  const TONE = { red: 0, yellow: 1, unknown: 2, ok: 3, no_demand: 4 };
  rows.sort(
    (a, b) =>
      Number(b.activeAds.length > 0 && (b.available ?? 1) <= 0) -
        Number(a.activeAds.length > 0 && (a.available ?? 1) <= 0) ||
      (b.backorder ?? 0) - (a.backorder ?? 0) ||
      TONE[a.coverage.tone] - TONE[b.coverage.tone] ||
      (a.coverage.days ?? Infinity) - (b.coverage.days ?? Infinity) ||
      b.dailyUnits - a.dailyUnits ||
      a.name.localeCompare(b.name),
  );

  /* Alerts */
  // Like the stock rules of modules 1–3 (evaluateCampaignRules): an old file
  // does not raise stock alerts, it says they are not evaluated.
  const stale = Boolean(input.staleDate);
  const alerts: InventoryAlert[] = [];
  if (input.staleDate)
    alerts.push({
      code: "inventario_viejo",
      tone: "wait",
      key: "inventario_viejo",
      title: `Inventario del ${shortDateText(input.staleDate)}`,
      detail:
        input.source === "shiphero"
          ? "Las alertas de stock quedan sin evaluar. Revisa la conexión de ShipHero en Fuentes."
          : "Las alertas de stock quedan sin evaluar. Sube el archivo de hoy.",
    });
  // Products with variants (talla/color): the active ad sells the whole
  // family, so stock is judged on the family (Σ disponible y demanda). A
  // variant at 0 while its siblings have stock is not "sin stock".
  const familyById = new Map(input.families.map((f) => [f.key, f]));
  const familyRows = new Map<string, PresentationRow[]>();
  for (const row of rows)
    if (row.familyKey && row.available != null)
      familyRows.set(row.familyKey, [
        ...(familyRows.get(row.familyKey) ?? []),
        row,
      ]);
  const groupOf = (row: PresentationRow) => {
    const group = row.familyKey ? familyRows.get(row.familyKey) : undefined;
    return group && group.length > 1 ? group : null;
  };
  const familyName = (familyKey: string, group: PresentationRow[]) =>
    familyById.get(familyKey)?.name?.trim() || productName(group[0].name);
  const sum = (group: PresentationRow[], pick: (r: PresentationRow) => number) =>
    group.reduce((n, r) => n + pick(r), 0);
  const adsText = (ads: ActiveAd[]) =>
    `${listText(Array.from(new Set(ads.map((a) => a.name))))} (${Array.from(
      new Set(ads.map((a) => a.accountLabel)),
    ).join(", ")})`;

  /** A variant of a product with variants reads "Producto (Negro / S)". */
  const rowName = (row: PresentationRow) => {
    const group = groupOf(row);
    return group
      ? `${familyName(row.familyKey!, group)} (${variantLabel(row, familyById.get(row.familyKey!))})`
      : row.name;
  };

  const covered = new Set<string>();
  const doneFamilies = new Set<string>();
  for (const row of stale ? [] : rows) {
    if (!row.activeAds.length || row.available == null) continue;
    const group = groupOf(row);
    // The variants the active ads sell: the whole family for a family
    // campaign, the selection for a campaign of some variants.
    const advertised = group?.filter((r) => r.activeAds.length) ?? [];
    if (advertised.length > 1) {
      const familyKey = row.familyKey!;
      if (doneFamilies.has(familyKey)) continue;
      doneFamilies.add(familyKey);
      const name = familyName(familyKey, group!);
      const family = familyById.get(familyKey) ?? null;
      const whole = advertised.length === group!.length;
      const ads = advertised.flatMap((r) => r.activeAds);
      const total = sum(advertised, (r) => r.available ?? 0);
      const daily = sum(advertised, (r) => r.dailyUnits);
      const backorder = sum(advertised, (r) => r.backorder ?? 0);
      const coverage = coverageOf(total, daily * 7, t);
      const empty =
        total <= 0 &&
        (daily > 0 ||
          backorder > 0 ||
          sum(advertised, (r) => r.waitingProxy ?? 0) > 0);
      const variantsText = `${countText(advertised.length)} variantes${whole ? "" : " anunciadas"}`;
      if (empty || coverage.tone === "red") {
        for (const r of advertised) covered.add(r.key);
        alerts.push({
          code: "anuncio_sin_stock",
          tone: "risk",
          key: `anuncio:${familyKey}`,
          title:
            total <= 0
              ? `Anuncio activo sin stock: ${name}`
              : `Anuncio activo con poco stock: ${name}`,
          detail: `${adsText(ads)}. Disponible ${countText(total)} entre ${variantsText}${
            total > 0 ? ` · ${coverage.label}` : ""
          }${backorder ? ` · ${countText(backorder)} pedidos esperando` : ""}.`,
        });
        continue;
      }
      // The product has stock: one grouped, lower-severity alert for the
      // advertised variants at 0 that sell or have orders waiting.
      const out = advertised.filter((r) => (r.available ?? 0) <= 0);
      if (!out.length) continue;
      alerts.push({
        code: "variantes_agotadas",
        tone: "wait",
        key: `variantes:${familyKey}`,
        title: `${name}: tallas/colores agotados`,
        detail: `Sin stock: ${variantListText(out, family)}. ${countText(out.length)} de ${variantsText} sin stock · disponible total ${countText(total)}${
          coverage.tone === "ok" || coverage.tone === "yellow"
            ? ` (${coverage.label})`
            : ""
        }. Anuncio activo: ${adsText(ads)}.`,
      });
      continue;
    }
    const empty =
      row.available <= 0 &&
      (row.dailyUnits > 0 ||
        (row.backorder ?? 0) > 0 ||
        (row.waitingProxy ?? 0) > 0);
    if (!empty && !(row.backorder ?? 0) && row.coverage.tone !== "red")
      continue;
    covered.add(row.key);
    alerts.push({
      code: "anuncio_sin_stock",
      tone: "risk",
      key: `anuncio:${row.key}`,
      title: `Anuncio activo sin stock: ${rowName(row)}`,
      detail: `${adsText(row.activeAds)}. Disponible ${countText(row.available)}${
        row.available > 0 ? ` · ${row.coverage.label}` : ""
      }${row.backorder ? ` · ${countText(row.backorder)} pedidos esperando` : ""}.`,
    });
  }
  // Orders waiting: one alert per SKU, or per family for products with
  // variants (the family total says whether the product still has stock).
  const waitingByFamily = new Map<
    string,
    Array<{ row: PresentationRow; waiting: WaitingStock | null }>
  >();
  for (const row of rows) {
    if (covered.has(row.key)) continue;
    let waiting: WaitingStock | null = null;
    if (columns.backorder) {
      if (stale || !row.backorder || row.backorder <= 0) continue;
    } else {
      waiting = input.waiting?.[row.key] ?? null;
      const proxy = waiting ? waiting.confirmedNoGuide + waiting.agotado : 0;
      if (!waiting || proxy < t.waitingProxyMinOrders) continue;
    }
    const group = groupOf(row);
    if (group) {
      waitingByFamily.set(row.familyKey!, [
        ...(waitingByFamily.get(row.familyKey!) ?? []),
        { row, waiting },
      ]);
      continue;
    }
    if (columns.backorder) {
      alerts.push({
        code: "esperando_stock",
        tone: "risk",
        key: `esperando:${row.key}`,
        title: `${row.name}: ${countText(row.backorder!)} pedidos esperando stock`,
        detail: `Disponible ${row.available == null ? "sin dato" : countText(row.available)}${
          row.incoming != null ? ` · ${countText(row.incoming)} en camino` : ""
        }.`,
      });
      continue;
    }
    const proxy = waiting!.confirmedNoGuide + waiting!.agotado;
    alerts.push({
      code: "esperando_stock",
      tone: "wait",
      key: `esperando:${row.key}`,
      title: `${row.name}: ${countText(proxy)} pedidos confirmados sin guía`,
      detail: `En iComfly hace más de ${countText(t.waitingMinHours)} h${
        waiting!.agotado
          ? ` (${countText(waiting!.agotado)} en Producto Agotado)`
          : ""
      }; el más viejo tiene ${countText(waiting!.oldestDays)} días. Puede ser stock, almacén o retraso.`,
    });
  }
  for (const [familyKey, entries] of Array.from(waitingByFamily)) {
    const group = familyRows.get(familyKey)!;
    const name = familyName(familyKey, group);
    const family = familyById.get(familyKey) ?? null;
    const total = sum(group, (r) => r.available ?? 0);
    // "Negro / S (12), Beige / M (3)": largest first.
    const variants = (n: (e: (typeof entries)[number]) => number) =>
      listText(
        entries
          .map((e) => ({ e, units: n(e) }))
          .sort((a, b) => b.units - a.units)
          .map(
            ({ e, units }) =>
              `${variantLabel(e.row, family)} (${countText(units)})`,
          ),
        VARIANT_LIST_MAX,
      );
    const stockText = `disponible total del producto ${countText(total)}`;
    if (columns.backorder) {
      const backorder = sum(
        entries.map((e) => e.row),
        (r) => r.backorder ?? 0,
      );
      const incoming = entries.some((e) => e.row.incoming != null)
        ? sum(group, (r) => r.incoming ?? 0)
        : null;
      alerts.push({
        code: "esperando_stock",
        tone: "risk",
        key: `esperando:${familyKey}`,
        title: `${name}: ${countText(backorder)} pedidos esperando stock`,
        detail: `En ${variants((e) => e.row.backorder ?? 0)} · ${stockText}${
          incoming != null ? ` · ${countText(incoming)} en camino` : ""
        }.`,
      });
      continue;
    }
    const proxyOf = (e: (typeof entries)[number]) =>
      e.waiting!.confirmedNoGuide + e.waiting!.agotado;
    const proxy = entries.reduce((n, e) => n + proxyOf(e), 0);
    const agotado = entries.reduce((n, e) => n + e.waiting!.agotado, 0);
    const oldest = Math.max(...entries.map((e) => e.waiting!.oldestDays));
    alerts.push({
      code: "esperando_stock",
      tone: "wait",
      key: `esperando:${familyKey}`,
      title: `${name}: ${countText(proxy)} pedidos confirmados sin guía`,
      detail: `En ${variants(proxyOf)}. En iComfly hace más de ${countText(t.waitingMinHours)} h${
        agotado ? ` (${countText(agotado)} en Producto Agotado)` : ""
      }; el más viejo tiene ${countText(oldest)} días · ${stockText}. Puede ser stock, almacén o retraso.`,
    });
  }
  // Real restocks only: a SKU of the previous file that went up at least
  // `restockAlertMinUnits` (cancellations and returns add 1–2 a day; a SKU
  // new to the file is not a restock).
  const nameOf = new Map(rows.map((r) => [skuKey(r.sku), r.name]));
  const previousSkus = new Set(
    (input.previous ?? []).map((s) => skuKey(s.sku)).filter(Boolean),
  );
  const restocks = restock
    ? Array.from(restock.entries())
        .filter(
          ([sku, delta]) =>
            previousSkus.has(sku) && delta >= t.restockAlertMinUnits,
        )
        .map(([sku, delta]) => ({
          sku,
          name: nameOf.get(sku) ?? sku.toUpperCase(),
          delta,
        }))
        .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name))
    : [];
  if (restocks.length && !stale)
    alerts.push({
      code: "reposicion",
      tone: "good",
      key: "reposicion",
      title: "Entró reposición",
      detail: `${restocks
        .slice(0, 8)
        .map((r) => `${r.name} +${countText(r.delta)}`)
        .join(
          " · ",
        )}${restocks.length > 8 ? ` · y ${countText(restocks.length - 8)} más` : ""}.`,
    });

  /* Talla × color */
  const groups = new Map<string, Array<PresentationRow & VariantAttrs>>();
  for (const row of rows) {
    if (!row.sku) continue;
    const attrs = variantAttributes(row.sku, row.name);
    if (!attrs.base) continue;
    groups.set(attrs.base, [
      ...(groups.get(attrs.base) ?? []),
      { ...row, ...attrs },
    ]);
  }
  const sizeColor: SizeColorGroup[] = [];
  for (const [base, members] of Array.from(groups)) {
    if (members.length < 2 || !members.some((m) => m.color || m.size)) continue;
    const colors = Array.from(
      new Set(
        members.map((m) => m.color).filter((c): c is string => Boolean(c)),
      ),
    ).sort((a, b) => a.localeCompare(b, "es"));
    const order = (size: string) => {
      const i = (SIZE_ORDER as readonly string[]).indexOf(size);
      return i < 0 ? SIZE_ORDER.length : i;
    };
    const sizes = Array.from(
      new Set(
        members.map((m) => m.size).filter((s): s is string => Boolean(s)),
      ),
    ).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    const named = members.find((m) => m.cataloged) ?? members[0];
    sizeColor.push({
      base,
      name: named.cataloged ? productName(named.name) : base.toUpperCase(),
      colors,
      sizes,
      cells: members
        .map((m) => ({
          color: m.color,
          size: m.size,
          sku: m.sku,
          available: m.available,
          backorder: m.backorder,
          dailyUnits: m.dailyUnits,
        }))
        .sort((a, b) => a.sku.localeCompare(b.sku)),
      total: members.reduce((n, m) => n + (m.available ?? 0), 0),
    });
  }
  sizeColor.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const notes: string[] = [];
  const source = input.source ?? "csv";
  if (!columns.backorder)
    notes.push(missingStockColumnsText(source, { backorder: true }));
  if (!columns.incoming)
    notes.push(
      rows.some((r) => r.incomingSource === "plan")
        ? source === "csv"
          ? "Sin unidades en camino en el archivo: «a mano» sale del plan de cada producto."
          : "Sin unidades en camino en ShipHero: «a mano» sale del plan de cada producto."
        : missingStockColumnsText(source, { incoming: true }),
    );
  if (!variantDemand) notes.push(VARIANT_DEMAND_MISSING);
  if (uncataloged)
    notes.push(
      source === "shiphero"
        ? `${countText(uncataloged)} SKU de ShipHero sin producto en el catálogo de ventas.`
        : `${countText(uncataloged)} SKU del archivo sin producto en el catálogo de ventas.`,
    );
  return {
    rows,
    sizeColor,
    alerts: [
      ...alerts.filter((a) => a.tone === "risk"),
      ...alerts.filter((a) => a.tone === "wait"),
      ...alerts.filter((a) => a.tone === "good"),
    ],
    restocks,
    uncataloged,
    variantDemand,
    notes,
  };
}
