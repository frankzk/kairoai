export const KENKU_MANAGEMENT_STORES = [
  { code: "kenku-it", label: "Kenku Italia", region: "Italia", path: "/admin/finance/italia", api: "/api/italia", locale: "it-IT", timeZone: "Europe/Rome", currency: "EUR", postcodeLabel: "CAP", woo: true },
  { code: "kenku-mx", label: "Kenku México", region: "México", path: "/admin/finance/mexico", api: "/api/mexico", locale: "es-MX", timeZone: "America/Mexico_City", currency: "MXN", postcodeLabel: "CP", woo: false },
] as const;
export type KenkuManagementCode = typeof KENKU_MANAGEMENT_STORES[number]["code"];
export function kenkuManagementStore(code: KenkuManagementCode) {
  return KENKU_MANAGEMENT_STORES.find(store => store.code === code)!;
}
