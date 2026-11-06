// Catálogo de ventas de hoy, solo para contar SKU del inventario sin producto
// (subida del CSV y sincronización de ShipHero). Solo servidor.
import { getMarketingInputs } from "./marketing-data";
import { presetPeriod } from "./marketing-dates";
import type { FinanceStoreConfig } from "./stores";

export const marketingCatalogLoader = (store: FinanceStoreConfig) => () =>
  getMarketingInputs(store, presetPeriod("today")).then(
    (input) => input.summary.catalog,
  );
