// Catálogo operativo WooCommerce. No se añade a FINANCE_STORES: sus crons,
// couriers y conversiones siguen siendo específicos de CR/HN.
export const WOO_STORES = [{ code: "kenku-it", label: "Kenku Italia", country: "IT", currency: "EUR", timezone: "Europe/Rome" }] as const;
export const WOO_STATUS = {
  pending: "Por confirmar", confirmed: "Confirmado", dispatched: "Despachado",
  delivered: "Entregado", cancelled: "Anulado",
} as const;
export type WooStatus = keyof typeof WOO_STATUS;
export const WOO_TRANSITIONS: Record<WooStatus, WooStatus[]> = {
  pending: ["confirmed", "cancelled"], confirmed: ["dispatched", "cancelled"],
  dispatched: ["delivered", "cancelled"], delivered: [], cancelled: [],
};
export const WC_STATUS: Record<WooStatus, string> = {
  pending: "cod-pending", confirmed: "processing", dispatched: "cod-shipped",
  delivered: "completed", cancelled: "cancelled",
};
