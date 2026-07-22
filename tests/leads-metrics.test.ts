import { describe, expect, it } from "vitest";
import {
  buildUncalledLeadSeries,
  crRange,
  daysAgoIso,
  isUncalledLeadOnDate,
  localDateKey,
  matchesLocalDateRange,
  parseRange,
  recentLocalDateKeys,
} from "../lib/leads-metrics";

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

describe("dias locales para el grafico de leads", () => {
  it("convierte el instante a fecha de Costa Rica", () => {
    expect(localDateKey("2026-07-20T05:59:59Z")).toBe("2026-07-19");
    expect(localDateKey("2026-07-20T06:00:00Z")).toBe("2026-07-20");
    expect(localDateKey("fecha-invalida")).toBeNull();
  });

  it("genera una ventana cronologica que incluye hoy local", () => {
    expect(recentLocalDateKeys(NOW, 4)).toEqual([
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
    ]);
  });

  it("filtra la ultima interaccion por un rango local inclusivo", () => {
    expect(matchesLocalDateRange("2026-07-20T05:59:59Z", "2026-07-20", "2026-07-22")).toBe(false);
    expect(matchesLocalDateRange("2026-07-20T06:00:00Z", "2026-07-20", "2026-07-22")).toBe(true);
    expect(matchesLocalDateRange("2026-07-23T05:59:59Z", "2026-07-20", "2026-07-22")).toBe(true);
    expect(matchesLocalDateRange("2026-07-23T06:00:00Z", "2026-07-20", "2026-07-22")).toBe(false);
    expect(matchesLocalDateRange(null, "", "")).toBe(true);
    expect(matchesLocalDateRange(null, "2026-07-20", "")).toBe(false);
  });

  it("agrupa solo leads sin gestion manual y usa created_at como respaldo", () => {
    const leads = [
      { status_source: "auto", first_seen_at: "2026-07-20T06:00:00Z" },
      { status_source: "auto", first_seen_at: null, created_at: "2026-07-20T08:00:00Z" },
      { status_source: "manual", first_seen_at: "2026-07-20T10:00:00Z" },
      { status_source: "auto", first_seen_at: "2026-07-16T10:00:00Z" },
    ];

    expect(buildUncalledLeadSeries(leads, NOW, 4)).toEqual([
      { date: "2026-07-17", count: 0 },
      { date: "2026-07-18", count: 0 },
      { date: "2026-07-19", count: 0 },
      { date: "2026-07-20", count: 2 },
    ]);
    expect(isUncalledLeadOnDate(leads[0], "2026-07-20")).toBe(true);
    expect(isUncalledLeadOnDate(leads[2], "2026-07-20")).toBe(false);
  });
});
