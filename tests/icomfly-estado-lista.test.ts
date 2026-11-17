import { describe, expect, it } from "vitest";
import { claseEstadoIcomfly, contarEstadosIcomfly, estadoIcomflyDe, etiquetaEstadoIcomfly, pasaEstadoIcomfly } from "@/lib/icomfly-estado-lista";
import { ultimoComentarioIcomfly } from "@/lib/icomfly-comentarios";

describe("estado de iComfly en Pendientes", () => {
  it("cuenta por estado, de mayor a menor y lo sin estado al final", () => {
    const rows = [
      { icomfly_estado: "Comprar Después" },
      { icomfly_estado: "Comprar Después" },
      { icomfly_estado: "Modificar Dirección" },
      { icomfly_estado: "" },
      {},
    ];
    expect(contarEstadosIcomfly(rows)).toEqual([
      { estado: "Comprar Después", count: 2 },
      { estado: "Modificar Dirección", count: 1 },
      { estado: "Sin estado en iComfly", count: 2 },
    ]);
  });

  it("filtra por el estado exacto; vacío deja pasar todo", () => {
    expect(pasaEstadoIcomfly({ icomfly_estado: "Comprar Después" }, "Comprar Después")).toBe(true);
    expect(pasaEstadoIcomfly({ icomfly_estado: "Pendiente" }, "Comprar Después")).toBe(false);
    expect(pasaEstadoIcomfly({}, "Sin estado en iComfly")).toBe(true);
    expect(pasaEstadoIcomfly({ icomfly_estado: "Pendiente" }, "")).toBe(true);
    expect(estadoIcomflyDe({ icomfly_estado: "  " })).toBe("Sin estado en iComfly");
  });

  it("etiqueta y color como en iComfly", () => {
    expect(etiquetaEstadoIcomfly("quiere cordinar entrega con repartidor")).toBe("Quiere cordinar entrega con repartidor");
    expect(etiquetaEstadoIcomfly("En_Reparto")).toBe("En Reparto");
    expect(claseEstadoIcomfly("Comprar Después")).toContain("purple");
    expect(claseEstadoIcomfly("Modificar Dirección")).toContain("blue");
    expect(claseEstadoIcomfly("algo nuevo")).toContain("muted");
  });

  it("toma el último comentario de la nota interna", () => {
    const nota = "[2026-11-14 09:13 · Jeanny Linares] se llamó\n[2026-11-17 09:33 · Jeanny Linares] saldrá del país, en lo que llegue se\nle envía";
    expect(ultimoComentarioIcomfly(nota)).toEqual({ fecha: "2026-11-17 09:33", autor: "Jeanny Linares", texto: "saldrá del país, en lo que llegue se\nle envía" });
    expect(ultimoComentarioIcomfly("")).toBeNull();
  });
});
