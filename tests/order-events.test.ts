// Que resultado puede llevar cada tipo de evento de la bitacora. El CHECK de
// la tabla (migracion 0028) acepta cualquier outcome para cualquier kind, asi
// que la regla de cual va con cual vive en el codigo y se fija aca.

import { describe, expect, it } from "vitest";
import { isValidOrderEvent, ORDER_EVENT_OUTCOME_LABEL } from "../lib/order-events";

describe("isValidOrderEvent", () => {
  it("acepta los resultados de un intento de contacto", () => {
    for (const outcome of ["contesto", "no_contesta", "buzon", "numero_malo", "confirmado", "reagendar"]) {
      expect(isValidOrderEvent("contacto", outcome)).toBe(true);
    }
  });

  it("acepta las decisiones", () => {
    for (const outcome of ["autorizar_despacho", "retener", "anular"]) {
      expect(isValidOrderEvent("decision", outcome)).toBe(true);
    }
  });

  it("la nota va sin resultado", () => {
    expect(isValidOrderEvent("nota", "")).toBe(true);
    expect(isValidOrderEvent("nota", "contesto")).toBe(false);
  });

  it("no deja cruzar un resultado con el tipo que no le toca", () => {
    // Una "decision" no es un intento de contacto y viceversa: si se cruzan,
    // el conteo de intentos de la lista queda inflado.
    expect(isValidOrderEvent("contacto", "anular")).toBe(false);
    expect(isValidOrderEvent("decision", "no_contesta")).toBe(false);
  });

  it("rechaza tipos y resultados desconocidos", () => {
    expect(isValidOrderEvent("cualquiera", "contesto")).toBe(false);
    expect(isValidOrderEvent("contacto", "inventado")).toBe(false);
    expect(isValidOrderEvent("", "")).toBe(false);
  });

  it("toda opcion valida tiene etiqueta en la UI", () => {
    const conEtiqueta = ["contesto", "no_contesta", "buzon", "numero_malo", "confirmado",
      "reagendar", "autorizar_despacho", "retener", "anular"];
    for (const outcome of conEtiqueta) {
      expect(ORDER_EVENT_OUTCOME_LABEL[outcome]).toBeTruthy();
    }
  });
});
