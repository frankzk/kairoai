import { FINANCE_STORES } from "./store-config";
import { KENKU_MANAGEMENT_STORES } from "./kenku-management";
// Authorization catalog, distinct from legacy finance/Shopify jobs.
export const ACCESS_STORES = [...FINANCE_STORES, ...KENKU_MANAGEMENT_STORES];
