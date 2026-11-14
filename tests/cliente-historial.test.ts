import { describe, expect, it } from "vitest";
import { estadoParaHistorial, historialPorFila, resumirHistorial, riesgoCliente } from "@/lib/cliente-historial";

const fila = (row_key: string, phone: string, extra: Record<string, unknown> = {}) => ({ row_key, phone, guide_number: "", courier: "", ...extra });

describe("historial de entrega por cliente", () => {
  it("clasifica cada pedido como iComfly: entregado, devuelto, en camino, sin despachar, cancelado", () => {
    expect(estadoParaHistorial(fila("a", "1"), "delivered")).toBe("entregado");
    expect(estadoParaHistorial(fila("a", "1"), "returned")).toBe("devuelto");
    expect(estadoParaHistorial(fila("a", "1", { guide_number: "MLCR1" }), "pending")).toBe("en_camino");
    expect(estadoParaHistorial(fila("a", "1"), "pending")).toBe("sin_despachar");
    expect(estadoParaHistorial(fila("a", "1"), "annulled")).toBe("cancelado");
    expect(estadoParaHistorial(fila("a", "1", { anulacion_excluida: true }), "annulled")).toBeNull();
  });

  it("resume por transportadora y calcula la tasa sobre lo resuelto", () => {
    const h = resumirHistorial([
      { row: fila("a", "1", { guide_number: "MLCR1", courier: "MailAmericas" }), status: "delivered" },
      { row: fila("b", "1", { guide_number: "MLCR2", courier: "MailAmericas" }), status: "returned" },
      { row: fila("c", "1", { guide_number: "M3", courier: "Moovin" }), status: "delivered" },
      { row: fila("d", "1"), status: "annulled" },
    ]);
    expect(h).toMatchObject({ total: 4, entregados: 2, devueltos: 1, cancelados: 1, tasa: 66.7, riesgo: "atencion" });
    expect(h.couriers[0]).toMatchObject({ id: "wyn", entregados: 1, devueltos: 1 });
  });

  it("riesgo: nuevo, confiable, atención y riesgo", () => {
    expect(riesgoCliente(0, 0)).toBe("nuevo");
    expect(riesgoCliente(3, 0)).toBe("confiable");
    expect(riesgoCliente(3, 1)).toBe("atencion");
    expect(riesgoCliente(1, 2)).toBe("riesgo");
    expect(riesgoCliente(0, 1)).toBe("riesgo");
  });

  it("busca por teléfono normalizado y no cuenta el pedido de la fila", () => {
    const todas = [fila("x", "8888-1111"), fila("y", "+506 88881111"), fila("z", "7000-0000")];
    const norm = (p: string | null | undefined) => (p ? p.replace(/\D/g, "").slice(-8) : null);
    const resolver = (rows: typeof todas) => rows.map((row) => ({ row, status: "returned" }));
    const map = historialPorFila([todas[0]], todas, norm, resolver);
    expect(map.get("x")).toMatchObject({ total: 1, devueltos: 1 });
  });
});
