import { describe, expect, it } from "vitest";
import { contarInventario, estadoStock, filtrarInventario, type ItemInventario } from "@/lib/inventario";

const item = (sku: string, nombre: string, disponible: number): ItemInventario => ({
  sku, nombre, disponible, enBodega: disponible, reservado: 0, pendientes: null, enCamino: null,
});

const ITEMS = [item("FAJA-M", "Faja Colombiana M", 40), item("BRA-01", "Brasier Ácido", 3), item("GEL-02", "Gel reductor", 0), item("X-1", "álbum", -2)];

describe("inventario", () => {
  it("clasifica el stock", () => {
    expect(estadoStock(0)).toBe("agotado");
    expect(estadoStock(-1)).toBe("agotado");
    expect(estadoStock(10)).toBe("pocas");
    expect(estadoStock(11)).toBe("con_stock");
  });

  it("cuenta por estado", () => {
    expect(contarInventario(ITEMS)).toEqual({ todos: 4, con_stock: 1, pocas: 1, agotado: 2 });
  });

  it("busca sin acentos por nombre o SKU y ordena por nombre", () => {
    expect(filtrarInventario(ITEMS, "acido", "todos").map((i) => i.sku)).toEqual(["BRA-01"]);
    expect(filtrarInventario(ITEMS, "gel-0", "todos").map((i) => i.sku)).toEqual(["GEL-02"]);
    expect(filtrarInventario(ITEMS, "", "agotado").map((i) => i.sku)).toEqual(["X-1", "GEL-02"]);
    expect(filtrarInventario(ITEMS, "", "todos").map((i) => i.nombre)).toEqual(["álbum", "Brasier Ácido", "Faja Colombiana M", "Gel reductor"]);
  });
});
