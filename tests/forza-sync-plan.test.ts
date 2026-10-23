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
// Los pedidos vigentes de esas guias ya leidas (solo esas se releen).
const pedidosDe = (tracked: ForzaTrackedGuide[]) => tracked.map((t) => ({ guide: t.guide, orderedAt: NOW - 20 * D }));

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
      tracked: [{ guide: "FD1000002", group: "delivered", checkedAt: NOW - 5 * D, historial: true }],
    });
    expect(plan).toEqual(["FD1000001"]);
  });

  it("re-lee lo que sigue en camino, la lectura mas vieja primero, y salta finales y frescas", () => {
    const tracked: ForzaTrackedGuide[] = [
      { guide: "FD2000001", group: "in_progress", checkedAt: NOW - 2 * H },
      // Congelada desde el 27/07: mientras el pedido siga vigente, entra.
      { guide: "FD2000002", group: "in_progress", checkedAt: NOW - 60 * D },
      { guide: "FD2000003", group: "delivered", checkedAt: NOW - 60 * D, historial: true },
      { guide: "FD2000004", group: "returned", checkedAt: NOW - 60 * D, historial: true },
      { guide: "FD2000005", group: "failed", checkedAt: NOW - 10 * MIN },
      { guide: "FD2000006", group: "failed", checkedAt: NOW - 3 * D },
    ];
    const plan = planForzaSync({ ...base, orderGuides: pedidosDe(tracked), tracked });
    expect(plan).toEqual(["FD2000002", "FD2000006", "FD2000001"]);
  });

  // Forza mostraba la devolucion como "Entregado" en sus 5 hitos: las cerradas
  // leidas asi se releen una vez con el historial completo.
  it("con lo que sobra, relee una vez las cerradas leidas sin historial, del pedido mas reciente al mas viejo", () => {
    const tracked: ForzaTrackedGuide[] = [
      { guide: "FD5000001", group: "delivered", checkedAt: NOW - 5 * D },
      { guide: "FD5000002", group: "returned", checkedAt: NOW - 5 * D },
      { guide: "FD5000003", group: "delivered", checkedAt: NOW - 5 * D, historial: true },
      { guide: "FD5000004", group: "in_progress", checkedAt: NOW - 2 * D },
    ];
    const plan = planForzaSync({
      ...base,
      limit: 3,
      orderGuides: [
        { guide: "FD5000001", orderedAt: NOW - 40 * D },
        { guide: "FD5000002", orderedAt: NOW - 10 * D },
        { guide: "FD5000003", orderedAt: NOW - 5 * D },
        { guide: "FD5000004", orderedAt: NOW - 3 * D },
        { guide: "FD5000005", orderedAt: NOW - 1 * D },
      ],
      tracked,
    });
    // Primero la nueva y la viva; despues la cerrada sin historial del pedido mas reciente.
    expect(plan).toEqual(["FD5000005", "FD5000004", "FD5000002"]);
  });

  it("aunque las en camino llenen el cupo, las cerradas sin historial tienen su parte", () => {
    const enCamino = vivas(20);
    const cerradas: ForzaTrackedGuide[] = Array.from({ length: 10 }, (_, i) => ({
      guide: `FD6${String(i).padStart(6, "0")}`,
      group: "delivered",
      checkedAt: NOW - 5 * D,
    }));
    const tracked = [...enCamino, ...cerradas];
    const plan = planForzaSync({ ...base, limit: 12, orderGuides: pedidosDe(tracked), tracked });
    expect(plan).toHaveLength(12);
    // La cuarta parte del cupo (3) va a las cerradas.
    expect(plan.filter((g) => g.startsWith("FD6"))).toHaveLength(3);
  });

  it("no relee guias de pedidos cancelados o fuera de la ventana", () => {
    // Paso con guias de enero que quedaron en "Creado": se releian cada pocas
    // horas y nunca se iban a mover.
    const plan = planForzaSync({
      ...base,
      orderGuides: [{ guide: "FD2000001", orderedAt: NOW - 10 * D }],
      tracked: [
        { guide: "FD2000001", group: "in_progress", checkedAt: NOW - 5 * H },
        { guide: "FD1900001", group: "in_progress", checkedAt: NOW - 200 * D },
      ],
    });
    expect(plan).toEqual(["FD2000001"]);
  });

  it("con miles de guias nuevas atrasadas, las que estan en camino igual reciben su parte", () => {
    const enCamino = vivas(40);
    const plan = planForzaSync({
      ...base,
      limit: 20,
      orderGuides: [...nuevas(500), ...pedidosDe(enCamino)],
      tracked: enCamino,
    });
    expect(plan).toHaveLength(20);
    // 75% para nuevas, 25% garantizado para re-leer.
    expect(plan.filter((g) => g.startsWith("FD3"))).toHaveLength(15);
    expect(plan.filter((g) => g.startsWith("FD4"))).toHaveLength(5);
  });

  it("si un grupo no llena su parte, el otro usa lo que sobra", () => {
    const una = vivas(1);
    const pocasVivas = planForzaSync({ ...base, limit: 10, orderGuides: [...nuevas(20), ...pedidosDe(una)], tracked: una });
    expect(pocasVivas.filter((g) => g.startsWith("FD3"))).toHaveLength(9);
    expect(pocasVivas.filter((g) => g.startsWith("FD4"))).toHaveLength(1);

    const veinte = vivas(20);
    const pocasNuevas = planForzaSync({ ...base, limit: 10, orderGuides: [...nuevas(2), ...pedidosDe(veinte)], tracked: veinte });
    expect(pocasNuevas.filter((g) => g.startsWith("FD3"))).toHaveLength(2);
    expect(pocasNuevas.filter((g) => g.startsWith("FD4"))).toHaveLength(8);
  });

  it("con tope cero no consulta nada", () => {
    const cinco = vivas(5);
    expect(planForzaSync({ ...base, limit: 0, orderGuides: [...nuevas(5), ...pedidosDe(cinco)], tracked: cinco })).toEqual([]);
  });
});
