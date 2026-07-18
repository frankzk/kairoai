const GENERIC_COURIER_LABELS = new Set([
  "",
  "transportadora",
  "transportista",
  "other",
  "otra",
  "custom",
  "manual",
  "n/a",
  "na",
  "none",
  "easysell",
]);

// Shopify/EasySell suele guardar una etiqueta generica en vez de "Moovin".
// Esta funcion se usa solo sobre tiendas cuya transportadora configurada es
// Moovin; por eso una etiqueta generica sigue siendo un candidato valido.
export function isMoovinCandidateCourier(rawCompany: string | null | undefined): boolean {
  const company = String(rawCompany ?? "").trim().toLowerCase();
  return GENERIC_COURIER_LABELS.has(company) || company.includes("moovin");
}
