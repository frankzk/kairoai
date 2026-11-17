import { describe, expect, it } from "vitest";
import { contarSinMovimiento, diasSinMovimiento, parseSinMovimiento, pasaSinMovimiento } from "@/lib/sin-movimiento";

describe("días sin movimiento de la transportadora", () => {
  const ahora = new Date("2026-11-17T18:00:00Z");

  it("cuenta días completos desde el último evento", () => {
    expect(diasSinMovimiento("2026-11-12T17:00:00Z", ahora)).toBe(5);
    expect(diasSinMovimiento("2026-11-12T19:00:00Z", ahora)).toBe(4);
    expect(diasSinMovimiento("2026-11-17T10:00:00Z", ahora)).toBe(0);
    expect(diasSinMovimiento(null, ahora)).toBeNull();
    expect(diasSinMovimiento("no es fecha", ahora)).toBeNull();
  });

  it("filtra +5 y +10 días y deja fuera las guías sin fecha", () => {
    expect(pasaSinMovimiento(5, "5")).toBe(true);
    expect(pasaSinMovimiento(4, "5")).toBe(false);
    expect(pasaSinMovimiento(9, "10")).toBe(false);
    expect(pasaSinMovimiento(null, "5")).toBe(false);
    expect(pasaSinMovimiento(null, "all")).toBe(true);
    expect(parseSinMovimiento("10")).toBe("10");
    expect(parseSinMovimiento("7")).toBe("all");
  });

  it("cuenta cada corte", () => {
    expect(contarSinMovimiento([1, 5, 6, 12, null])).toEqual({ all: 5, "5": 3, "10": 1 });
  });
});
