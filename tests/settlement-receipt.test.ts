import { describe, expect, it } from "vitest";
import {
  checkReceipt,
  totalFxLoss,
  TOLERANCIA_PCT,
  VERDICT_META,
} from "../lib/settlement-receipt";

// Numeros de una liquidacion real (cd2330.xlsx, corte 12/08/2026): 727 filas y
// 6.949.192 colones declarados por Boxful.
const DECLARADO = 6_949_192;

describe("checkReceipt", () => {
  it("sin monto recibido no inventa nada", () => {
    const r = checkReceipt({ declaredLocal: DECLARADO, receivedUsd: 0 });
    expect(r.verdict).toBe("sin_registrar");
    expect(r.appliedRate).toBeNull();
    expect(r.diffLocal).toBeNull();
  });

  it("con monto pero sin tasa de referencia, da el tipo de cambio aplicado y nada mas", () => {
    // Util por si solo: si una liquidacion sale a 505 y la siguiente a 520, esa
    // diferencia se ve aunque no haya con que compararla.
    const r = checkReceipt({ declaredLocal: DECLARADO, receivedUsd: 13_600 });
    expect(r.verdict).toBe("sin_referencia");
    expect(r.appliedRate).toBeCloseTo(511.0, 0);
    // No se juzga lo que no se puede juzgar.
    expect(r.spreadPct).toBeNull();
    expect(r.diffLocal).toBeNull();
  });

  it("una conversion a tasa de mercado da diferencia cero", () => {
    const tasa = 505;
    const r = checkReceipt({
      declaredLocal: DECLARADO,
      receivedUsd: DECLARADO / tasa,
      referenceRate: tasa,
    });
    expect(r.verdict).toBe("ok");
    expect(r.diffUsd).toBe(0);
    expect(r.spreadPct).toBe(0);
  });

  it("cuantifica la perdida cuando entra menos de lo que corresponde", () => {
    // Mercado a 505, pero el cambio salio a 520: entran menos dolares.
    const r = checkReceipt({
      declaredLocal: DECLARADO,
      receivedUsd: DECLARADO / 520,
      referenceRate: 505,
    });
    expect(r.verdict).toBe("revisar");
    // Perdio plata: la diferencia es negativa en las dos monedas.
    expect(r.diffUsd!).toBeLessThan(0);
    expect(r.diffLocal!).toBeLessThan(0);
    // 520 vs 505 son ~2,9% de spread.
    expect(r.spreadPct!).toBeCloseTo(-2.88, 1);
    // Y en colones son unos 200 mil de una sola liquidacion.
    expect(Math.abs(r.diffLocal!)).toBeGreaterThan(190_000);
  });

  it("una diferencia chica NO se marca: una conversion nunca da exacto", () => {
    // 1% de spread: banco, comision de wire, la tasa del dia que no es la del
    // minuto exacto. Marcar esto seria una falsa alarma cada vez.
    const r = checkReceipt({
      declaredLocal: DECLARADO,
      receivedUsd: (DECLARADO / 505) * 0.99,
      referenceRate: 505,
    });
    expect(r.verdict).toBe("ok");
    expect(r.spreadPct!).toBeCloseTo(-1, 1);
  });

  it("recibir MAS de lo esperado tambien se marca para revisar", () => {
    // Suele ser un monto mal anotado, no un regalo del banco.
    const r = checkReceipt({
      declaredLocal: DECLARADO,
      receivedUsd: (DECLARADO / 505) * 1.05,
      referenceRate: 505,
    });
    expect(r.verdict).toBe("revisar");
    expect(r.diffUsd!).toBeGreaterThan(0);
  });

  it("el umbral se aplica por valor absoluto y justo en el borde pasa", () => {
    const justo = checkReceipt({
      declaredLocal: 1_000_000,
      receivedUsd: (1_000_000 / 500) * (1 - TOLERANCIA_PCT / 100),
      referenceRate: 500,
    });
    expect(justo.verdict).toBe("ok");
  });

  it("no se rompe con basura", () => {
    for (const malo of [NaN, Infinity, -1, 0]) {
      const r = checkReceipt({ declaredLocal: DECLARADO, receivedUsd: malo });
      expect(r.verdict).toBe("sin_registrar");
    }
    // Tasa de referencia invalida: se degrada a "sin referencia", no explota.
    const r = checkReceipt({
      declaredLocal: DECLARADO,
      receivedUsd: 13_600,
      referenceRate: 0,
    });
    expect(r.verdict).toBe("sin_referencia");
  });

  it("cada veredicto tiene su etiqueta", () => {
    for (const v of ["sin_registrar", "sin_referencia", "ok", "revisar"] as const) {
      expect(VERDICT_META[v].label).toBeTruthy();
      expect(VERDICT_META[v].hint).toBeTruthy();
    }
  });
});

describe("totalFxLoss", () => {
  it("acumula solo lo medido y no estima lo que falta", () => {
    // La cifra que importa: una liquidacion pierde poco, el año pierde mucho.
    const medidas = [
      checkReceipt({ declaredLocal: 5_000_000, receivedUsd: 5_000_000 / 515, referenceRate: 505 }),
      checkReceipt({ declaredLocal: 6_000_000, receivedUsd: 6_000_000 / 515, referenceRate: 505 }),
      // Esta no tiene tasa: no se cuenta ni se adivina.
      checkReceipt({ declaredLocal: 7_000_000, receivedUsd: 13_600 }),
      // Y esta ni se registro.
      checkReceipt({ declaredLocal: 4_000_000, receivedUsd: 0 }),
    ];
    const total = totalFxLoss(medidas);
    expect(total.liquidacionesMedidas).toBe(2);
    expect(total.perdidaLocal).toBeLessThan(0);
    // ~2% de 11 millones.
    expect(Math.abs(total.perdidaLocal)).toBeGreaterThan(180_000);
  });

  it("sin nada medido devuelve cero, no undefined", () => {
    expect(totalFxLoss([])).toEqual({
      liquidacionesMedidas: 0,
      perdidaLocal: 0,
      perdidaUsd: 0,
    });
  });
});
