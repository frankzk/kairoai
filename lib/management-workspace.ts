export interface ManagementWorkspace {
  code: string;
  label: string;
  country: string;
  api: string;
  href: string;
  currency: string;
  locale: string;
  timeZone: string;
  postcodeLabel: string;
  woocommerce: boolean;
}

export const ITALIA_WORKSPACE: ManagementWorkspace = {
  code: "kenku-it", label: "Kenku Italia", country: "Italia",
  api: "/api/italia", href: "/admin/finance/italia", currency: "EUR",
  locale: "it-IT", timeZone: "Europe/Rome", postcodeLabel: "CAP", woocommerce: true,
};

export const ARGENTINA_WORKSPACE: ManagementWorkspace = {
  code: "kenku-ar", label: "Kenku Argentina", country: "Argentina",
  api: "/api/argentina", href: "/admin/finance/argentina", currency: "ARS",
  locale: "es-AR", timeZone: "America/Argentina/Buenos_Aires", postcodeLabel: "CP", woocommerce: false,
};
