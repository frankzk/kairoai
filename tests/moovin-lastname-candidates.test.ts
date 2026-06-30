import { describe, expect, it } from "vitest";
import { moovinLastNameCandidates } from "@/lib/moovin";

// Moovin indexa por el apellido tal cual lo registro Boxful. Cuando el last_name
// que tenemos viene mal partido (nombre completo adentro, o un solo apellido de
// dos), derivamos variantes del nombre para reintentar. Estos casos fijan ese
// orden de prioridad.
describe("moovinLastNameCandidates", () => {
  it("nombre completo metido en last_name -> rescata los dos apellidos ticos", () => {
    // Caso real: la guia mostraba 'Antonio salas Elizondo' como apellido.
    const candidates = moovinLastNameCandidates("Antonio salas Elizondo");
    expect(candidates).toEqual(["Antonio salas Elizondo", "salas Elizondo", "Elizondo"]);
  });

  it("last_name con un solo apellido + nombre completo -> agrega los dos apellidos", () => {
    // Shopify partio como first='Antonio salas', last='Elizondo'; el apellido
    // real de Moovin es 'salas Elizondo' y solo el nombre completo lo recupera.
    const candidates = moovinLastNameCandidates("Elizondo", "Antonio salas Elizondo");
    expect(candidates[0]).toBe("Elizondo");
    expect(candidates).toContain("salas Elizondo");
  });

  it("prioriza el last_name (Apellido de Boxful) como primer intento", () => {
    const candidates = moovinLastNameCandidates("salas Elizondo", "Antonio salas Elizondo");
    expect(candidates[0]).toBe("salas Elizondo");
  });

  it("apellido simple no genera variantes redundantes", () => {
    expect(moovinLastNameCandidates("Elizondo")).toEqual(["Elizondo"]);
  });

  it("normaliza espacios y deduplica sin distinguir mayusculas", () => {
    expect(moovinLastNameCandidates("  salas   Elizondo ", "salas elizondo")).toEqual([
      "salas Elizondo",
      "Elizondo",
    ]);
  });

  it("last_name vacio cae al nombre completo", () => {
    const candidates = moovinLastNameCandidates("", "Antonio salas Elizondo");
    expect(candidates).toContain("salas Elizondo");
    expect(candidates).not.toContain("");
  });

  it("sin ningun dato devuelve lista vacia", () => {
    expect(moovinLastNameCandidates("", "")).toEqual([]);
  });
});
