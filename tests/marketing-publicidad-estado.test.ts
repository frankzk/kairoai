// Filtro por estado de Marketing › Publicidad: varios a la vez (Activo y En
// revisión, por ejemplo); sin ninguno marcado se ven todas las filas.
import { describe, expect, it } from "vitest";
import {
  applyStatusFilter,
  publicidadStatusOptions,
  statusFilterLabel,
} from "../lib/marketing-publicidad";

const rows = [
  { id: "a", statusLabel: "Pausado" },
  { id: "b", statusLabel: "Activo" },
  { id: "c", statusLabel: "Pausado" },
  { id: "d", statusLabel: "—" },
  { id: "e", statusLabel: "Eliminado" },
  { id: "f", statusLabel: "En revisión" },
];

describe("filtro por estado", () => {
  it("lista los estados presentes, activos primero, con cuántas filas tiene cada uno", () => {
    expect(publicidadStatusOptions(rows)).toEqual([
      { label: "Activo", count: 1 },
      { label: "Pausado", count: 2 },
      { label: "En revisión", count: 1 },
      { label: "Eliminado", count: 1 },
      { label: "Sin estado", count: 1 },
    ]);
  });

  it("sin nada marcado deja todas las filas", () => {
    expect(applyStatusFilter(rows, [])).toBe(rows);
  });

  it("con varios marcados deja las filas de cualquiera de ellos", () => {
    expect(
      applyStatusFilter(rows, ["Activo", "En revisión"]).map((r) => r.id),
    ).toEqual(["b", "f"]);
    expect(applyStatusFilter(rows, ["Pausado"]).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("la fila sin estado de Meta se filtra como «Sin estado»", () => {
    expect(statusFilterLabel({ statusLabel: "—" })).toBe("Sin estado");
    expect(applyStatusFilter(rows, ["Sin estado"]).map((r) => r.id)).toEqual([
      "d",
    ]);
  });
});
