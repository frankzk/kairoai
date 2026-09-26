// Que guias de Moovin consultar en una corrida del cron, y en que orden. Modulo
// PURO: recibe lo ya leido de la base y devuelve la lista. Sin base ni red.
//
// Ademas de las guias en camino, vuelve a leer UNA vez cada guia entregada.
// POR QUE: el cron trataba "entregado" como estado final y no volvia a leer la
// guia, pero Moovin a veces revierte una entrega. Marca "Entregado" y, entre 16
// minutos y 43 horas despues, el paquete vuelve a la sede, hay una incidencia y
// la guia termina "Cancelado". Si el cron la leyo en el medio, el tablero la
// contaba como venta entregada para siempre. Paso con 8 guias entre marzo y
// julio (ver la migracion 0037).

/** La segunda lectura espera esto desde la entrega: la reversion mas tardia vista arranco a las 43 h. */
export const RECHECK_DELAY_MS = 48 * 3_600_000;
/** Entregas mas viejas no se releen: es la ventana de pedidos de Shopify que el cron puede consultar. */
export const RECHECK_LOOKBACK_MS = 45 * 86_400_000;
/** Parte de cada corrida reservada para las segundas lecturas; el resto queda para las guias en camino. */
export const RECHECK_SHARE = 0.25;

export interface MoovinTrackedGuide {
  group: string;
  /** latest_at de una guia entregada = cuando se entrego (epoch ms, 0 si no se sabe). */
  deliveredAt: number;
  /** checked_at (epoch ms, 0 si no se sabe). */
  checkedAt: number;
}

/**
 * Una guia entregada se relee una sola vez, pasadas 48 horas desde la entrega.
 * Si la ultima lectura ya fue posterior a ese plazo, ya quedo verificada.
 */
export function isDeliveryRecheckDue(t: MoovinTrackedGuide, nowMs: number): boolean {
  if (t.group !== "delivered" || !t.deliveredAt) return false;
  const sinceDelivery = nowMs - t.deliveredAt;
  if (sinceDelivery < RECHECK_DELAY_MS || sinceDelivery > RECHECK_LOOKBACK_MS) return false;
  return t.checkedAt < t.deliveredAt + RECHECK_DELAY_MS;
}

export interface MoovinSyncPlanInput {
  /** Guias en camino (o nunca leidas, checkedAt 0). */
  live: Array<{ guide: string; checkedAt: number }>;
  /** Guias entregadas con la segunda lectura pendiente. */
  rechecks: Array<{ guide: string; deliveredAt: number }>;
  /** Tope de consultas de la corrida. */
  limit: number;
}

/**
 * Lista ordenada de guias a consultar.
 *
 * - Segundas lecturas: hasta un cuarto de la corrida, la entrega mas reciente
 *   primero, para que el dia a dia no espere detras del atraso.
 * - Guias en camino: la que lleva mas tiempo sin leerse primero, y antes que
 *   todas las que nunca se leyeron (checkedAt 0).
 * Si un grupo no llena su parte, el otro usa lo que sobra.
 */
export function planMoovinSync(input: MoovinSyncPlanInput): string[] {
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit === 0) return [];
  const rechecks = [...input.rechecks].sort((a, b) => b.deliveredAt - a.deliveredAt);
  const live = [...input.live].sort((a, b) => a.checkedAt - b.checkedAt);

  const rechecksShare = Math.min(rechecks.length, Math.round(limit * RECHECK_SHARE));
  const takeLive = Math.min(live.length, limit - rechecksShare);
  const takeRechecks = Math.min(rechecks.length, limit - takeLive);

  // Las segundas lecturas van primero: son pocas y son las que corrigen plata.
  return [...rechecks.slice(0, takeRechecks).map((r) => r.guide), ...live.slice(0, takeLive).map((l) => l.guide)];
}
