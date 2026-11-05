// Metas y umbrales del equipo de marketing de Mireva Costa Rica (documento
// "Mejoras al dashboard de marketing", 4 nov 2026). Un solo lugar: el resto
// del código y la interfaz los leen de aquí, nunca como números sueltos.
export const MARKETING_TARGETS = {
  dailyOrders: 200, // pedidos reales / día
  dailySpendUsd: 1700, // Meta + TikTok
  cpaUsd: 8.5, // CPA real objetivo (y puja COST CAP por defecto)
  stockRedDays: 3,
  stockYellowDays: 7,
  metaTestKillUsd: 17,
  metaTestPassUsd: 40,
  metaTestPassOrders: 3,
  tiktokTestKillPen: 60,
  tiktokTestPassPen: 200,
  tiktokTestPassOrders: 5,
  testMaxAgeDays: 14, // campaña lanzada hace ≤14 días = en prueba (si no llegó al gasto de aprobación)
  scaleStep: 0.2,
  scaleMinRealOrders: 20, // pedidos reales del período para "Revisar para escalar"
  holdMinHours: 48,
  holdHours: 72,
  tiktokLaunchesPerDay: 2,
  costCapDailyAlertUsd: 100,
  costCapCpaMultiple: 2,
  costCapNoDeliveryUsd: 5,
  costCapCandidateMinPurchases: 3,
} as const;
export type MarketingTargets = typeof MARKETING_TARGETS;
