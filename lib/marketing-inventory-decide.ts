// Inventario para decidir (documento de mejoras, módulo 5): una fila por
// presentación (cada SKU por separado: Shilajit cápsulas, gomitas y puro no
// se agrupan) con disponible, pedidos esperando, unidades en camino, venta
// diaria, días de cobertura, reposición desde el archivo anterior y si tiene
// un anuncio activo; la matriz de talla × color; y las alertas "anuncio
// activo sin stock", "pedidos esperando stock" y "entró reposición".
// Pedidos esperando y en camino solo existen si el product_table trae esas
// columnas (o, en camino, el plan manual del producto); sin ellas se dice.
// Puro: se prueba en tests/marketing-inventory-decide.test.ts.
import type { MarketingStock } from "./marketing-source-types";
import type { ProductPlan } from "./marketing-settings-types";
import type { MarketingFamily } from "./marketing-product-families";
import type { CampaignActionRow } from "./marketing-actions";
import type { WaitingStock } from "./marketing-insights-types";
import { MARKETING_TARGETS, type MarketingTargets } from "./marketing-targets";
import { coverageOf, restockDelta, type Coverage } from "./marketing-coverage";
import { countText, shortDateText } from "./marketing-copy";

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
        "Las alertas de stock quedan sin evaluar. Sube el archivo de hoy.",
    });
  const covered = new Set<string>();
  for (const row of stale ? [] : rows) {
    if (!row.activeAds.length || row.available == null) continue;
    const empty =
      row.available <= 0 &&
      (row.dailyUnits > 0 ||
        (row.backorder ?? 0) > 0 ||
        (row.waitingProxy ?? 0) > 0);
    if (!empty && !(row.backorder ?? 0) && row.coverage.tone !== "red")
      continue;
    covered.add(row.key);
    const campaigns = Array.from(new Set(row.activeAds.map((a) => a.name)));
    const accounts = Array.from(
      new Set(row.activeAds.map((a) => a.accountLabel)),
    );
    alerts.push({
      code: "anuncio_sin_stock",
      tone: "risk",
      key: `anuncio:${row.key}`,
      title: `Anuncio activo sin stock: ${row.name}`,
      detail: `${listText(campaigns)} (${accounts.join(", ")}). Disponible ${countText(row.available)}${
        row.available > 0 ? ` · ${row.coverage.label}` : ""
      }${row.backorder ? ` · ${countText(row.backorder)} pedidos esperando` : ""}.`,
    });
  }
  for (const row of rows) {
    if (covered.has(row.key)) continue;
    if (columns.backorder) {
      if (stale || !row.backorder || row.backorder <= 0) continue;
      alerts.push({
        code: "esperando_stock",
        tone: "risk",
        key: `esperando:${row.key}`,
        title: `${row.name}: ${countText(row.backorder)} pedidos esperando stock`,
        detail: `Disponible ${row.available == null ? "sin dato" : countText(row.available)}${
          row.incoming != null ? ` · ${countText(row.incoming)} en camino` : ""
        }.`,
      });
      continue;
    }
    const waiting = input.waiting?.[row.key];
    const proxy = waiting ? waiting.confirmedNoGuide + waiting.agotado : 0;
    if (!waiting || proxy < t.waitingProxyMinOrders) continue;
    alerts.push({
      code: "esperando_stock",
      tone: "wait",
      key: `esperando:${row.key}`,
      title: `${row.name}: ${countText(proxy)} pedidos confirmados sin guía`,
      detail: `En iComfly hace más de ${countText(t.waitingMinHours)} h${
        waiting.agotado
          ? ` (${countText(waiting.agotado)} en Producto Agotado)`
          : ""
      }; el más viejo tiene ${countText(waiting.oldestDays)} días. Puede ser stock, almacén o retraso.`,
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
      `${countText(uncataloged)} SKU del archivo sin producto en el catálogo de ventas.`,
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
