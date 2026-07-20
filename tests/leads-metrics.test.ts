import { describe, expect, it } from "vitest";
import { crRange, daysAgoIso, parseRange } from "../lib/leads-metrics";

// Referencia: 2026-07-20T18:00:00Z = 12:00 CR (mediodia).
const NOW = new Date("2026-07-20T18:00:00Z");

describe("parseRange", () => {
  it("acepta rangos validos y cae en 'hoy' por defecto", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("mes")).toBe("mes");
    expect(parseRange("basura")).toBe("hoy");
    expect(parseRange(null)).toBe("hoy");
  });
});

describe("crRange (hora CR, UTC-6)", () => {
  it("hoy: desde medianoche CR (06:00 UTC) hasta ahora", () => {
    const { fromIso, toIso } = crRange("hoy", NOW);
    expect(fromIso).toBe("2026-07-20T06:00:00.000Z"); // 00:00 CR
    expect(toIso).toBe(NOW.toISOString());
  });
  it("ayer: dia calendario anterior completo en CR", () => {
    const { fromIso, toIso } = crRange("ayer", NOW);
    expect(fromIso).toBe("2026-07-19T06:00:00.000Z"); // 00:00 CR del 19
    expect(toIso).toBe("2026-07-20T06:00:00.000Z"); // 00:00 CR del 20
  });
  it("mes: desde el 1 del mes a las 00:00 CR", () => {
    const { fromIso } = crRange("mes", NOW);
    expect(fromIso).toBe("2026-07-01T06:00:00.000Z");
  });
  it("7d y 30d terminan en ahora", () => {
    expect(crRange("7d", NOW).toIso).toBe(NOW.toISOString());
    expect(crRange("30d", NOW).toIso).toBe(NOW.toISOString());
  });
});

describe("daysAgoIso", () => {
  it("resta dias en milisegundos", () => {
    expect(daysAgoIso(NOW, 30)).toBe(new Date(NOW.getTime() - 30 * 86400_000).toISOString());
  });
});
