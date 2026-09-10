// El doble check de que la plata de una liquidacion llego DE VERDAD.
//
// EL PROBLEMA: `settlement_imports.total_to_liquidate` es lo que Boxful DICE que
// va a pagar, en colones. La plata llega a Mercury en DOLARES. Entre esas dos
// cifras hay una conversion que hasta ahora no se registraba en ninguna parte,
// asi que:
//
//   1. Nadie comprobaba que el monto que llego correspondiera al declarado.
//   2. La perdida por tipo de cambio era invisible. No aparecia como gasto en
//      ningun lado: simplemente llegaban menos dolares de los que hubieran
//      llegado convirtiendo a tasa de mercado, y eso no lo veia nadie.
//
// Este modulo es puro a proposito (sin DB ni red): las cifras de dinero se
// prueban con casos, no se depuran en produccion.

/** Lo que se registra al recibir el pago de una liquidacion. */
export interface ReceiptInput {
  /** Lo que Boxful declaro que iba a pagar, en la moneda local (CRC/HNL). */
  declaredLocal: number;
  /** Lo que efectivamente entro a Mercury, en dolares. */
  receivedUsd: number;
  /**
   * Tasa de mercado del dia en que entro la plata (moneda local por 1 USD).
   * Es el punto de comparacion: sin ella se puede saber el tipo de cambio
   * aplicado pero no si fue bueno o malo.
   */
  referenceRate?: number | null;
}

export interface ReceiptCheck {
  /** Tipo de cambio que salio en la practica: local declarado / USD recibido. */
  appliedRate: number | null;
  /** Cuantos dolares habrian entrado convirtiendo a tasa de mercado. */
  expectedUsd: number | null;
  /** Diferencia en dolares contra lo esperado. Negativo = entro menos. */
  diffUsd: number | null;
  /** La misma diferencia en moneda local, que es como se lee en el P&L. */
  diffLocal: number | null;
  /** Cuanto se perdio contra la tasa de mercado, en porcentaje. */
  spreadPct: number | null;
  /** Veredicto para pintar la tarjeta. */
  verdict: ReceiptVerdict;
}

/**
 * - `sin_registrar`: todavia nadie anoto cuanto llego.
 * - `sin_referencia`: se sabe cuanto llego, pero sin tasa de mercado no se
 *   puede juzgar si el cambio fue razonable.
 * - `ok`: la diferencia contra el mercado esta dentro de lo tolerable.
 * - `revisar`: la diferencia se pasa del umbral. No dice "les robaron": dice
 *   "esto merece que alguien lo mire".
 */
export type ReceiptVerdict = "sin_registrar" | "sin_referencia" | "ok" | "revisar";

/**
 * Umbral de tolerancia, en porcentaje sobre el monto esperado.
 *
 * POR QUE 1,5%: una conversion nunca da exacto. El banco cobra spread, la tasa
 * del dia no es la del minuto exacto de la transferencia, y puede haber
 * comisiones fijas de wire. Un 1,5% absorbe eso sin marcar falsas alarmas.
 *
 * Es un punto de partida, no una verdad: cuando haya varias liquidaciones
 * registradas se puede medir el spread real y ajustarlo con datos. Hoy no hay
 * NI UNA registrada, asi que cualquier numero mas fino seria inventado.
 */
export const TOLERANCIA_PCT = 1.5;

function esNumeroUtil(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Redondea a centavos. Sin esto los flotantes sacan colas de 14 decimales que
 * se ven mal y hacen que dos cifras iguales parezcan distintas.
 *
 * El `+ 0` no es decorativo: sin el, una diferencia minima negativa redondea a
 * `-0` y la pantalla mostraria "-0,00" o "-0%", que se lee como un error.
 */
function aCentavos(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

export function checkReceipt(input: ReceiptInput): ReceiptCheck {
  const vacio: ReceiptCheck = {
    appliedRate: null,
    expectedUsd: null,
    diffUsd: null,
    diffLocal: null,
    spreadPct: null,
    verdict: "sin_registrar",
  };

  if (!esNumeroUtil(input.declaredLocal) || !esNumeroUtil(input.receivedUsd)) {
    return vacio;
  }

  // El tipo de cambio que salio en la practica. Se puede calcular siempre, y ya
  // es util por si solo: si una liquidacion sale a 505 y la siguiente a 520,
  // esa diferencia se ve aunque no haya tasa de referencia.
  const appliedRate = aCentavos(input.declaredLocal / input.receivedUsd);

  if (!esNumeroUtil(input.referenceRate)) {
    return { ...vacio, appliedRate, verdict: "sin_referencia" };
  }

  const expectedUsd = aCentavos(input.declaredLocal / input.referenceRate);
  const diffUsd = aCentavos(input.receivedUsd - expectedUsd);
  const diffLocal = aCentavos(diffUsd * input.referenceRate);
  const spreadPct = aCentavos((diffUsd / expectedUsd) * 100);

  return {
    appliedRate,
    expectedUsd,
    diffUsd,
    diffLocal,
    spreadPct,
    // Se juzga por valor absoluto: recibir MAS de lo esperado tambien merece
    // una mirada (suele ser un monto mal anotado, no un regalo).
    verdict: Math.abs(spreadPct) <= TOLERANCIA_PCT ? "ok" : "revisar",
  };
}

export const VERDICT_META: Record<
  ReceiptVerdict,
  { label: string; hint: string; tone: "neutral" | "ok" | "warn" }
> = {
  sin_registrar: {
    label: "Sin confirmar",
    hint: "Nadie anotó cuánto entró a Mercury",
    tone: "neutral",
  },
  sin_referencia: {
    label: "Sin tasa de referencia",
    hint: "Se sabe cuánto entró, pero no con qué tasa compararlo",
    tone: "neutral",
  },
  ok: { label: "Recibido ✓", hint: "El monto cuadra con la tasa de mercado", tone: "ok" },
  revisar: {
    label: "Revisar",
    hint: `La diferencia contra el mercado pasa el ${TOLERANCIA_PCT}%`,
    tone: "warn",
  },
};

/**
 * Suma la perdida por tipo de cambio de varias liquidaciones.
 *
 * Es la cifra que interesa de verdad: una liquidacion suelta pierde poco, pero
 * el acumulado del año es un gasto real que hoy no figura en ninguna parte.
 * Solo cuenta las que tienen los dos datos; las no registradas no se estiman.
 */
export function totalFxLoss(checks: ReceiptCheck[]): {
  liquidacionesMedidas: number;
  perdidaLocal: number;
  perdidaUsd: number;
} {
  let liquidacionesMedidas = 0;
  let perdidaLocal = 0;
  let perdidaUsd = 0;
  for (const c of checks) {
    if (c.diffLocal == null || c.diffUsd == null) continue;
    liquidacionesMedidas += 1;
    perdidaLocal += c.diffLocal;
    perdidaUsd += c.diffUsd;
  }
  return {
    liquidacionesMedidas,
    perdidaLocal: aCentavos(perdidaLocal),
    perdidaUsd: aCentavos(perdidaUsd),
  };
}
