import type { MarketingSummary } from "./marketing";
import { buildMarketingAdsSummary } from "./marketing-ads-summary";
import type { MarketingSources } from "./marketing-source-types";
import {
  campaignKey,
  type MarketingSettings,
} from "./marketing-settings-types";

export const MARKETING_CPA_LIMIT = 8.5;
export const MARKETING_STOCK_MIN = 100;
export function buildMarketingIntelligence(
  summary: MarketingSummary,
  sources: MarketingSources | null,
  settings: MarketingSettings | null,
) {
  const ads = buildMarketingAdsSummary(
    sources,
    summary.period,
    summary.totals.generated,
    summary.totals.delivered,
  );
  const mappings = new Map(
    settings?.mappings.map((item) => [
      campaignKey(item.platform, item.account_id, item.campaign_id),
      item,
    ]) ?? [],
  );
  const plans = new Map(
    settings?.plans.map((plan) => [plan.product_key, plan]) ?? [],
  );
  const campaigns = (["meta", "tiktok"] as const).flatMap((platform) => {
    const source = sources?.[platform];
    return source?.status === "ready"
      ? (source.data?.accounts ?? []).flatMap((account) =>
          account.campaigns.map((campaign) => ({
            ...campaign,
            key: campaignKey(platform, account.accountId, campaign.id),
            platform,
            accountId: account.accountId,
            accountName: account.accountName || account.accountId,
            currency: account.currency,
            timezone: account.timezone,
            budgetMessage: account.budgetMessage,
            mapping:
              mappings.get(
                campaignKey(platform, account.accountId, campaign.id),
              ) ?? null,
            platformCpa:
              campaign.purchases != null && campaign.purchases > 0
                ? campaign.spend / campaign.purchases
                : null,
          })),
        )
      : [];
  });
  const stock = new Map<string, number | null>();
  if (sources?.shiphero.status === "ready")
    for (const item of sources.shiphero.data?.stock ?? []) {
      const sku = item.sku.trim().toLowerCase();
      stock.set(sku, stock.has(sku) ? null : item.available);
    }
  const metrics = new Map(
    summary.products.map((product) => [product.key, product]),
  );
  const products = summary.catalog
    .map((product) => {
      const metric = metrics.get(product.key);
      const plan = plans.get(product.key) ?? null;
      const related = campaigns.filter(
        (campaign) => campaign.mapping?.product_key === product.key,
      );
      const currencies = new Set(related.map((campaign) => campaign.currency));
      const currency = currencies.size === 1 ? related[0].currency : null;
      const spend =
        settings && currency
          ? related.reduce((sum, campaign) => sum + campaign.spend, 0)
          : null;
      const orders = metric?.orders ?? 0;
      const cpa =
        ads.aligned && currency && spend != null && orders > 0
          ? spend / orders
          : null;
      const available = product.sku
        ? (stock.get(product.sku.toLowerCase()) ?? null)
        : null;
      const dailyDemand = (metric?.recentUnits ?? 0) / 7;
      const coverageDays =
        available != null && dailyDemand > 0
          ? Math.max(0, available) / dailyDemand
          : null;
      const reorderPoint =
        plan?.lead_days != null && dailyDemand > 0
          ? Math.max(
              MARKETING_STOCK_MIN,
              Math.ceil(dailyDemand * plan.lead_days),
            )
          : null;
      const stockPosition =
        available == null ? null : available + (plan?.incoming_units ?? 0);
      const suggestedUnits =
        stockPosition != null &&
        reorderPoint != null &&
        plan?.cover_days != null &&
        plan.lead_days != null
          ? stockPosition < reorderPoint
            ? Math.max(
                0,
                Math.ceil(
                  Math.max(
                    MARKETING_STOCK_MIN,
                    dailyDemand * (plan.lead_days + plan.cover_days),
                  ) - stockPosition,
                ),
              )
            : 0
          : null;
      return {
        ...product,
        orders,
        units: metric?.units ?? 0,
        delivered: metric?.delivered ?? 0,
        open: metric?.open ?? 0,
        previousOrders: metric?.previousOrders ?? 0,
        todayOrders: metric?.todayOrders ?? 0,
        yesterdayOrders: metric?.yesterdayOrders ?? 0,
        sevenDayOrders: metric?.sevenDayOrders ?? 0,
        recentUnits: metric?.recentUnits ?? 0,
        daily: metric?.daily ?? [],
        currency,
        spend,
        cpa,
        campaignCount: related.length,
        priority: plan?.priority ?? false,
        plan,
        available,
        dailyDemand,
        coverageDays,
        reorderPoint,
        suggestedUnits,
      };
    })
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        b.orders - a.orders ||
        a.name.localeCompare(b.name),
    );
  const completeAssignments =
    Boolean(settings) &&
    campaigns.every(
      (campaign) => campaign.spend <= 0 || Boolean(campaign.mapping),
    );
  const alerts: Array<{
    key: string;
    tone: "risk" | "opportunity" | "info";
    title: string;
    detail: string;
    productKey?: string;
  }> = [];
  for (const product of products) {
    if (
      !ads.partial &&
      completeAssignments &&
      summary.period.days >= 7 &&
      product.currency === "USD" &&
      product.cpa != null &&
      product.cpa > 0 &&
      product.cpa <= MARKETING_CPA_LIMIT &&
      product.orders >= 20 &&
      product.orders >= product.previousOrders &&
      product.available != null &&
      product.available >= MARKETING_STOCK_MIN
    )
      alerts.push({
        key: `scale:${product.key}`,
        tone: "opportunity",
        title: `${product.name}: revisar para escalar`,
        detail:
          "Costo combinado dentro del objetivo, al menos 20 pedidos y stock suficiente. Validar atribución y margen antes de subir presupuesto.",
        productKey: product.key,
      });
    if (product.available != null && product.available < MARKETING_STOCK_MIN)
      alerts.push({
        key: `stock:${product.key}`,
        tone: "risk",
        title: `${product.name}: stock bajo`,
        detail: `${product.available} unidades disponibles. Mínimo: 100.`,
        productKey: product.key,
      });
    if (
      product.cpa != null &&
      product.currency === "USD" &&
      product.cpa > MARKETING_CPA_LIMIT &&
      (product.spend ?? 0) >= 17
    )
      alerts.push({
        key: `cpa:${product.key}`,
        tone: "risk",
        title: `${product.name}: costo por pedido alto`,
        detail: `USD ${product.cpa.toFixed(2)} por pedido del producto. Revisar campañas y cobertura de inversión.`,
        productKey: product.key,
      });
    if (product.suggestedUnits != null && product.suggestedUnits > 0)
      alerts.push({
        key: `restock:${product.key}`,
        tone: "opportunity",
        title: `${product.name}: preparar reposición`,
        detail: `${product.suggestedUnits} unidades sugeridas según demanda reciente, stock y plazo configurado.`,
        productKey: product.key,
      });
    if (
      product.previousOrders >= 10 &&
      product.orders >= 20 &&
      product.orders > product.previousOrders * 1.25
    )
      alerts.push({
        key: `trend:${product.key}`,
        tone: "opportunity",
        title: `${product.name}: demanda creciente`,
        detail: `${product.orders} pedidos frente a ${product.previousOrders} en el período anterior equivalente. Valida stock antes de aumentar inversión.`,
        productKey: product.key,
      });
  }
  for (const campaign of campaigns)
    if (
      campaign.clicks >= 100 &&
      campaign.purchases != null &&
      campaign.purchases < 1 &&
      campaign.spend >= 17
    )
      alerts.push({
        key: `clicks:${campaign.key}`,
        tone: "risk",
        title: `${campaign.name}: clics sin compras reportadas`,
        detail: `${campaign.clicks} clics y ${campaign.purchases} compras en ${campaign.platform === "meta" ? "Meta" : "TikTok"}. Revisar medición, anuncio y página del producto.`,
      });
  const unmapped = settings
    ? campaigns.filter((campaign) => !campaign.mapping && campaign.spend > 0)
    : [];
  if (unmapped.length)
    alerts.push({
      key: "mapping",
      tone: "info",
      title: `${unmapped.length} campañas con gasto sin producto`,
      detail:
        "Asigna sus productos para completar el costo por producto. La asignación no atribuye pedidos a una campaña.",
    });
  const toneOrder = { risk: 0, opportunity: 1, info: 2 };
  alerts.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);
  return {
    ads,
    campaigns,
    products,
    alerts,
    unmapped,
    assignedCampaigns: campaigns.filter((campaign) => campaign.mapping).length,
  };
}
export type MarketingIntelligence = ReturnType<
  typeof buildMarketingIntelligence
>;
export type MarketingProductMetric = MarketingIntelligence["products"][number];
