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
  // M4 píxel contra pedidos reales
  pixelWindowDays: 7, // días completos comparados (desde ayer hacia atrás)
  pixelMinRealOrders: 5, // menos pedidos reales → "Pocos pedidos para comparar"
  pixelFactorHigh: 1.3, // píxel ÷ reales por encima → "El píxel cuenta de más"
  pixelFactorLow: 0.7, // por debajo → "El píxel cuenta de menos"
  pixelHealthMinReal: 3, // un día con ≥3 pedidos reales y 0 en el píxel → alerta
  pixelHealthDropRatio: 0.3, // factor del día < 30 % del habitual → alerta
  pixelHealthBaselineDays: 3, // días con ≥ pixelMinRealOrders para el factor habitual
  // M5 inventario para decidir
  waitingMinHours: 24, // confirmado sin guía hace más de esto = "esperando"
  waitingProxyMinOrders: 5, // confirmados sin guía para avisar sin columna Backorder
  restockAlertMinUnits: 20, // "Entró reposición": subida mínima de un SKU que ya estaba en el archivo anterior (anulaciones y devoluciones suben 1–2)
  // M6 stock sin publicidad
  unadvertisedDays: 7,
  unadvertisedMinUnits: 100,
  soldBeforeMinWeekly: 10,
  soldBeforeDropRatio: 0.5,
  unadvertisedMaxUnknownDays: 1, // días de gasto sin dato (TikTok llega al día siguiente) que se aceptan para decir "sin anuncios"
  // M7 cancelaciones
  cancelRateAlert: 0.2, // tasa diaria o semanal por encima → tono de riesgo
  cancelOpenDays: 2, // los últimos N días todavía se pueden anular ("abierto")
  // M8 complementos
  complementShareHigh: 0.5, // se vende sobre todo como complemento
  complementMinOrders: 5,
  complementDropMinWeekly: 5,
  complementDropRatio: 0.5,
  // M10 simulador
  repeatMinDays: 7, // una recompra necesita un pedido anterior de hace al menos estos días
  // M11 cuentas
  accountSpendCapWarn: 0.9,
  tiktokFeedLagDays: 2, // Make manda ayer ~08:45 CR; más viejo que hoy−2 = atrasado
  // M12 segmentación
  segmentMinSpendUsd: 5,
} as const;
export type MarketingTargets = typeof MARKETING_TARGETS;

/**
 * Tasas de referencia del equipo (documento, módulo 11). Las tasas aplicadas
 * salen de `fx` (Hacienda/BCRP o la manual de Charlie); estas solo se muestran
 * al lado para ver la diferencia.
 */
export const MARKETING_FX_REFERENCE = {
  penPerUsd: 3.5,
  crcPerUsd: 505,
  maxDriftPct: 3,
} as const;
