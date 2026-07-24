import { describe, expect, it } from "vitest";

import { expectsSettlement } from "../lib/finance-orders";

// expectsSettlement define la regla de "falta cuadrar": un pedido solo deberia
// tener liquidacion si tuvo movimiento terminal real. Los anulados sin despacho
// quedan fuera aunque tengan settlement_count=0, para que la alerta financiera
// no se infle con pedidos que nunca van a liquidarse.
describe("expectsSettlement", () => {
  it("incluye estados con movimiento terminal real", () => {
    expect(expectsSettlement("delivered")).toBe(true);
    expect(expectsSettlement("not_delivered")).toBe(true);
    expect(expectsSettlement("returned")).toBe(true);
  });

  it("excluye anulados: nunca generan liquidacion", () => {
    expect(expectsSettlement("annulled")).toBe(false);
  });

  it("excluye estados operativos aun sin cerrar", () => {
    expect(expectsSettlement("pending")).toBe(false);
    expect(expectsSettlement("en_route")).toBe(false);
    expect(expectsSettlement("en_route_retry")).toBe(false);
    expect(expectsSettlement("incident")).toBe(false);
    expect(expectsSettlement("despacho_solicitado")).toBe(false);
    expect(expectsSettlement("recolectado")).toBe(false);
  });

  it("es robusto ante estados desconocidos", () => {
    expect(expectsSettlement("")).toBe(false);
    expect(expectsSettlement("unknown")).toBe(false);
  });
});
