import { FINANCE_STORES } from "./store-config";
import { ARGENTINA_WORKSPACE } from "./management-workspace";
import { WOO_STORES } from "./woo-config";
// Authorization catalog, distinct from legacy finance/Shopify jobs.
export const ACCESS_STORES = [...FINANCE_STORES, ...WOO_STORES, ARGENTINA_WORKSPACE];
