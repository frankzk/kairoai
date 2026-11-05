import { describe, expect, it } from "vitest";
import { editDistance, provinceOf } from "../lib/cr-provinces";

describe("provinceOf", () => {
  it.each([
    ["San José", "San José"],
    ["SAN JOSE", "San José"],
    ["San jose", "San José"],
    ["Sanjose", "San José"],
    ["Sam jose", "San José"],
    ["San jisw", "San José"],
    ["Provincia de Alajuela", "Alajuela"],
    ["Heredia Province", "Heredia"],
    ["GUANCASTE", "Guanacaste"],
    ["Guanaste", "Guanacaste"],
    ["Gte", "Guanacaste"],
    ["Pontarena", "Puntarenas"],
    ["Catrtago", "Cartago"],
    ["CR-H", "Heredia"],
    ["CR-SJ", "San José"],
    ["Limón", "Limón"],
    ["LIMON", "Limón"],
    ["San Carlos", "Alajuela"],
    ["Río Cuarto", "Alajuela"],
    ["San Ramon", "Alajuela"],
    ["Talamanca", "Limón"],
    ["Corredores", "Puntarenas"],
    ["Nuevo Arenal", "Guanacaste"],
    ["Paso Ancho", "San José"],
    ["San Antonio de Belén", "Heredia"],
    ["san jose san jose", "San José"],
    ["Cartago, Paraíso", "Cartago"],
  ])("%s → %s", (raw, province) => {
    expect(provinceOf(raw)).toBe(province);
  });

  it.each(["Shopify", "Seleccione región/estado", "", null, "xyz"])(
    "%j is unknown",
    (raw) => {
      expect(provinceOf(raw)).toBeNull();
    },
  );

  it("falls back to the city when the department is unreadable", () => {
    expect(provinceOf("Shopify", "Montes de Oca")).toBe("San José");
    expect(provinceOf("Seleccione región/estado", "Liberia")).toBe(
      "Guanacaste",
    );
    expect(provinceOf(null, null)).toBeNull();
    // The department wins over the city.
    expect(provinceOf("Heredia", "Liberia")).toBe("Heredia");
  });

  it("measures transpositions as one edit", () => {
    expect(editDistance("catrago", "cartago")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});
