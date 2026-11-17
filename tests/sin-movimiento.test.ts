import { describe, expect, it } from "vitest";
import { contarSinMovimiento, diasAlerta, diasSinMovimiento, parseSinMovimiento, pasaSinMovimiento } from "@/lib/sin-movimiento";

describe("días sin movimiento de la transportadora", () => {
  const ahora = new Date("2026-11-17T18:00:00Z");

  it("cuenta días completos desde el último evento", () => {
    expect(diasSinMovimiento("2026-11-12T17:00:00Z", ahora)).toBe(5);
    expect(diasSinMovimiento("2026-11-12T19:00:00Z", ahora)).toBe(4);
    expect(diasSinMovimiento("2026-11-17T10:00:00Z", ahora)).toBe(0);
    expect(diasSinMovimiento(null, ahora)).toBeNull();
    expect(diasSinMovimiento("no es fecha", ahora)).toBeNull();
  });

  it("cada etapa tiene sus cortes y su alerta", () => {
    expect(diasAlerta("despacho_solicitado")).toBe(2);
    expect(diasAlerta("recolectado")).toBe(3);
    expect(diasAlerta("en_route")).toBe(5);
    expect(diasAlerta("en_route_retry")).toBe(3);
    expect(diasAlerta("delivered")).toBeNull();
    expect(parseSinMovimiento("10", "en_route")).toBe(10);
    expect(parseSinMovimiento("10", "recolectado")).toBe("all");
    expect(parseSinMovimiento("7", "recolectado")).toBe(7);
    expect(parseSinMovimiento("x", "en_route")).toBe("all");
  });

  it("filtra por el corte y deja fuera las guías sin fecha", () => {
    expect(pasaSinMovimiento(5, 5)).toBe(true);
    expect(pasaSinMovimiento(4, 5)).toBe(false);
    expect(pasaSinMovimiento(null, 2)).toBe(false);
    expect(pasaSinMovimiento(null, "all")).toBe(true);
  });

  it("cuenta cada corte de la etapa", () => {
    expect(contarSinMovimiento([1, 5, 6, 12, null], "en_route")).toEqual({ all: 5, cortes: [{ dias: 5, count: 3 }, { dias: 10, count: 1 }] });
    expect(contarSinMovimiento([1, 2, 4, null], "despacho_solicitado")).toEqual({ all: 4, cortes: [{ dias: 2, count: 2 }, { dias: 4, count: 1 }] });
    expect(contarSinMovimiento([1], "pending")).toBeNull();
  });
});
