import { describe, expect, it } from "vitest";

// El calculo que alimenta la columna "% res." de la Tendencia de 7 dias.
// Se replica aqui (es una linea) para fijar el contrato sin exportar la
// funcion desde un componente de cliente.
const pctResueltas = (resueltasDeLasNuevas: number, nuevas: number) =>
  nuevas ? Math.round((resueltasDeLasNuevas / nuevas) * 100) : 0;

describe("% de resolución de la tendencia", () => {
  it("es un porcentaje real: nunca pasa de 100", () => {
    // El calculo viejo era (resueltas + reprogramadas) / nuevas, donde el
    // numerador contaba EVENTOS sobre todo el acumulado y el denominador solo
    // las nuevas de ese dia. Un martes con 21 nuevas y 160 eventos daba 762%.
    const casosReales = [
      { nuevas: 45, resueltas: 5 },
      { nuevas: 24, resueltas: 1 },
      { nuevas: 50, resueltas: 5 },
      { nuevas: 11, resueltas: 0 },
    ];
    for (const c of casosReales) {
      const pct = pctResueltas(c.resueltas, c.nuevas);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  it("mide la misma poblacion que el denominador", () => {
    expect(pctResueltas(5, 45)).toBe(11);
    expect(pctResueltas(45, 45)).toBe(100);
    expect(pctResueltas(0, 11)).toBe(0);
  });

  it("un dia sin incidencias nuevas no divide por cero", () => {
    expect(pctResueltas(0, 0)).toBe(0);
    expect(Number.isFinite(pctResueltas(3, 0))).toBe(true);
  });
});
