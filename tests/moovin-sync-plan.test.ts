import { describe, expect, it } from "vitest";
import { isDeliveryRecheckDue, planMoovinSync } from "../lib/moovin-sync-plan";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;

describe("isDeliveryRecheckDue", () => {
  const entregada = (hace: number, leidaHace: number) => ({
    group: "delivered",
    deliveredAt: NOW - hace,
    checkedAt: NOW - leidaHace,
  });

  it("relee la entrega de hace mas de 48 horas que se leyo justo despues de entregar", () => {
    expect(isDeliveryRecheckDue(entregada(50 * H, 49 * H), NOW)).toBe(true);
  });

  it("espera las 48 horas: las reversiones arrancan hasta 43 horas despues", () => {
    expect(isDeliveryRecheckDue(entregada(10 * H, 9 * H), NOW)).toBe(false);
  });

  it("la relee una sola vez", () => {
    // Leida 55 horas despues de entregar: ya quedo verificada.
    expect(isDeliveryRecheckDue(entregada(60 * H, 5 * H), NOW)).toBe(false);
  });

  it("no relee entregas de hace mas de 45 dias", () => {
    expect(isDeliveryRecheckDue(entregada(46 * D, 46 * D - H), NOW)).toBe(false);
  });

  it("solo aplica a entregas con fecha", () => {
    expect(isDeliveryRecheckDue({ group: "returned", deliveredAt: NOW - 50 * H, checkedAt: NOW - 49 * H }, NOW)).toBe(false);
    expect(isDeliveryRecheckDue({ group: "delivered", deliveredAt: 0, checkedAt: NOW - 49 * H }, NOW)).toBe(false);
  });
});

describe("planMoovinSync", () => {
  const vivas = (n: number) => Array.from({ length: n }, (_, i) => ({ guide: `V${i}`, checkedAt: NOW - (i + 1) * H }));
  const relecturas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ guide: `R${i}`, deliveredAt: NOW - (3 + i) * D }));

  it("primero las relecturas, de la entrega mas reciente a la mas vieja; despues las vivas, la lectura mas vieja primero", () => {
    const plan = planMoovinSync({
      live: [
        { guide: "LEIDA_HACE_1H", checkedAt: NOW - H },
        { guide: "NUNCA_LEIDA", checkedAt: 0 },
      ],
      rechecks: [
        { guide: "ENTREGADA_HACE_10D", deliveredAt: NOW - 10 * D },
        { guide: "ENTREGADA_HACE_3D", deliveredAt: NOW - 3 * D },
      ],
      limit: 10,
    });
    expect(plan).toEqual(["ENTREGADA_HACE_3D", "ENTREGADA_HACE_10D", "NUNCA_LEIDA", "LEIDA_HACE_1H"]);
  });

  it("con atraso de relecturas, las guias en camino se quedan con tres cuartos de la corrida", () => {
    const plan = planMoovinSync({ live: vivas(100), rechecks: relecturas(40), limit: 20 });
    expect(plan.filter((g) => g.startsWith("R"))).toHaveLength(5);
    expect(plan.filter((g) => g.startsWith("V"))).toHaveLength(15);
  });

  it("si hay pocas guias en camino, las relecturas usan lo que sobra", () => {
    const plan = planMoovinSync({ live: vivas(3), rechecks: relecturas(40), limit: 20 });
    expect(plan.filter((g) => g.startsWith("V"))).toHaveLength(3);
    expect(plan.filter((g) => g.startsWith("R"))).toHaveLength(17);
  });

  it("sin relecturas pendientes, la corrida entera es para las guias en camino", () => {
    expect(planMoovinSync({ live: vivas(30), rechecks: [], limit: 20 })).toHaveLength(20);
  });

  it("con tope cero no consulta nada", () => {
    expect(planMoovinSync({ live: vivas(3), rechecks: relecturas(3), limit: 0 })).toEqual([]);
  });
});
