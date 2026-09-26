import { describe, expect, it } from "vitest";
import { isForzaGuide, planForzaSync, type ForzaTrackedGuide } from "../lib/forza-sync-plan";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

const base = { nowMs: NOW, limit: 10, freshWindowMs: 45 * MIN };

const nuevas = (n: number, prefix = "FD3") =>
  Array.from({ length: n }, (_, i) => ({ guide: `${prefix}${String(i).padStart(6, "0")}`, orderedAt: NOW - i * H }));
const vivas = (n: number, prefix = "FD4"): ForzaTrackedGuide[] =>
  Array.from({ length: n }, (_, i) => ({
    guide: `${prefix}${String(i).padStart(6, "0")}`,
    group: "in_progress",
    checkedAt: NOW - (i + 1) * D,
  }));

describe("isForzaGuide", () => {
  it("reconoce las guias Forza (FD + digitos), sin importar mayusculas ni espacios", () => {
    expect(isForzaGuide("FD40397301")).toBe(true);
    expect(isForzaGuide("fd40397301")).toBe(true);
    expect(isForzaGuide(" FD38178948 ")).toBe(true);
  });

  it("descarta las de los otros couriers de Honduras", () => {
    expect(isForzaGuide("6595-13968-20260922106513")).toBe(false); // c807 Xpress
    expect(isForzaGuide("BH262215954-1")).toBe(false); // Cargo Expreso
    expect(isForzaGuide("BFT-072EHQ5I")).toBe(false); // Boxful
    expect(isForzaGuide("")).toBe(false);
  });
});

describe("planForzaSync", () => {
  it("consulta primero las guias nunca leidas, de la mas reciente a la mas vieja", () => {
    const plan = planForzaSync({
      ...base,
      orderGuides: [
        { guide: "FD1000001", orderedAt: NOW - 30 * D },
        { guide: "FD1000002", orderedAt: NOW - 1 * D },
        { guide: "FD1000003", orderedAt: NOW - 10 * D },
      ],
      tracked: [],
    });
    expect(plan).toEqual(["FD1000002", "FD1000003", "FD1000001"]);
  });

  it("no repite una guia ya leida, ni la misma guia en dos pedidos, y salta otros couriers", () => {
    const plan = planForzaSync({
      ...base,
      orderGuides: [
        { guide: "FD1000001", orderedAt: NOW - D },
        { guide: "fd1000001", orderedAt: NOW - D },
        { guide: "FD1000002", orderedAt: NOW - D },
        { guide: "6595-13968-20260922106513", orderedAt: NOW - D },
      ],
      tracked: [{ guide: "FD1000002", group: "delivered", checkedAt: NOW - 5 * D }],
    });
    expect(plan).toEqual(["FD1000001"]);
  });

  it("re-lee lo que sigue en camino, la lectura mas vieja primero, y salta finales y frescas", () => {
    const plan = planForzaSync({
      ...base,
      orderGuides: [],
      tracked: [
        { guide: "FD2000001", group: "in_progress", checkedAt: NOW - 2 * H },
        // Congelada desde el 27/07: sin limite de antiguedad, igual entra.
        { guide: "FD2000002", group: "in_progress", checkedAt: NOW - 60 * D },
        { guide: "FD2000003", group: "delivered", checkedAt: NOW - 60 * D },
        { guide: "FD2000004", group: "returned", checkedAt: NOW - 60 * D },
        { guide: "FD2000005", group: "failed", checkedAt: NOW - 10 * MIN },
        { guide: "FD2000006", group: "failed", checkedAt: NOW - 3 * D },
      ],
    });
    expect(plan).toEqual(["FD2000002", "FD2000006", "FD2000001"]);
  });

  it("con miles de guias nuevas atrasadas, las que estan en camino igual reciben su parte", () => {
    const plan = planForzaSync({ ...base, limit: 20, orderGuides: nuevas(500), tracked: vivas(40) });
    expect(plan).toHaveLength(20);
    // 75% para nuevas, 25% garantizado para re-leer.
    expect(plan.filter((g) => g.startsWith("FD3"))).toHaveLength(15);
    expect(plan.filter((g) => g.startsWith("FD4"))).toHaveLength(5);
  });

  it("si un grupo no llena su parte, el otro usa lo que sobra", () => {
    const pocasVivas = planForzaSync({ ...base, limit: 10, orderGuides: nuevas(20), tracked: vivas(1) });
    expect(pocasVivas.filter((g) => g.startsWith("FD3"))).toHaveLength(9);
    expect(pocasVivas.filter((g) => g.startsWith("FD4"))).toHaveLength(1);

    const pocasNuevas = planForzaSync({ ...base, limit: 10, orderGuides: nuevas(2), tracked: vivas(20) });
    expect(pocasNuevas.filter((g) => g.startsWith("FD3"))).toHaveLength(2);
    expect(pocasNuevas.filter((g) => g.startsWith("FD4"))).toHaveLength(8);
  });

  it("con tope cero no consulta nada", () => {
    expect(planForzaSync({ ...base, limit: 0, orderGuides: nuevas(5), tracked: vivas(5) })).toEqual([]);
  });
});
