import {
  listExpenses,
  listProductCosts,
  listProductCostVersions,
} from "./finance";
import { buildFinanceControlCenter } from "./finance-orders";
import { buildMarketingSummary } from "./marketing";
import type { MarketingPeriod } from "./marketing-dates";
import type { FinanceStoreConfig } from "./stores";
import { getOrdersDataset } from "../app/api/finance/_shared/orders-dataset";

export async function getMarketingInputs(
  store: FinanceStoreConfig,
  period: MarketingPeriod,
  month = "",
) {
  const [dataset, expenses, costs, versions] = await Promise.all([
    getOrdersDataset(store, [
      "rows",
      "matchedSettlementRows",
      "imports",
      "settlementTraceByKey",
    ]),
    listExpenses("ads", store.id),
    listProductCosts(store.id),
    listProductCostVersions(undefined, store.id),
  ]);
  const control = buildFinanceControlCenter(
    dataset.rows,
    dataset.matchedSettlementRows,
    dataset.imports,
    costs.filter((cost) => cost.currency?.toUpperCase() === "CRC"),
    versions.filter((cost) => cost.currency?.toUpperCase() === "CRC"),
    dataset.settlementTraceByKey,
  );
  const summary = buildMarketingSummary({
    orders: control.orders,
    expenses,
    month,
    from: period.from,
    to: period.to,
  });
  const catalog = new Map(
    summary.catalog.map((product) => [product.key, product]),
  );
  for (const product of costs)
    if (product.sku?.trim()) {
      const sku = product.sku.trim(),
        key = `sku:${sku.toLowerCase()}`;
      if (!catalog.has(key))
        catalog.set(key, { key, sku, name: product.product_name || sku });
    }
  summary.catalog = Array.from(catalog.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return {
    summary,
    orders: control.orders,
    phones: new Map(
      dataset.rows.map((row) => [row.row_key, row.phone ?? null]),
    ),
  };
}

export async function getMarketingData(
  store: FinanceStoreConfig,
  period: MarketingPeriod,
  month = "",
) {
  return (await getMarketingInputs(store, period, month)).summary;
}
