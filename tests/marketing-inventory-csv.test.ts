import { describe, expect, it } from "vitest";
import {
  matchInventoryToCatalog,
  parseInventoryCsv,
  parseInventoryNumber,
} from "../lib/marketing-inventory-csv";

describe("product_table CSV", () => {
  it("reads a ShipHero comma file and uses Available over On Hand", () => {
    const result = parseInventoryCsv(
      "SKU,Name,Warehouse,On Hand,Allocated,Available\nHER.LOSS,Her Loss,Boxful,120,20,100\nTURK,Turkesterone,Boxful,5,0,5\n",
    );
    expect(result.fatal).toBeNull();
    expect(result.delimiter).toBe(",");
    expect(result.columns).toMatchObject({
      sku: "SKU",
      available: "Available",
      availableFrom: "available",
      onHand: "On Hand",
      allocated: "Allocated",
      warehouse: "Warehouse",
      name: "Name",
    });
    expect(result.stock).toEqual([
      {
        sku: "HER.LOSS",
        name: "Her Loss",
        warehouseId: "Boxful",
        onHand: 120,
        allocated: 20,
        available: 100,
      },
      {
        sku: "TURK",
        name: "Turkesterone",
        warehouseId: "Boxful",
        onHand: 5,
        allocated: 0,
        available: 5,
      },
    ]);
    expect(result.rows[0]).toMatchObject({ line: 2, skuKey: "her.loss" });
  });

  it("reads a semicolon file with Spanish headers and thousands separators", () => {
    const result = parseInventoryCsv(
      'sku;Producto;Disponible\nBLOOD;Blood Sugar;"1.079"\nFAN;Ventilador;1 079\nX;Otro;12,5\n',
    );
    expect(result.delimiter).toBe(";");
    expect(result.stock.map((s) => s.available)).toEqual([1079, 1079, 12.5]);
    expect(result.errors).toEqual([]);
  });

  it("handles sep=, BOM, CRLF and quoted names with commas and escaped quotes", () => {
    const text =
      '﻿sep=;\r\nSKU;Nombre;Disponible\r\nA1;"Crema ""extra"", 50 ml";7\r\n\r\nB2;"Línea\r\npartida";3\r\nC3;Sin número;\r\n';
    const result = parseInventoryCsv(text);
    expect(result.fatal).toBeNull();
    expect(result.delimiter).toBe(";");
    expect(
      result.rows.map((r) => [r.line, r.sku, r.name, r.available]),
    ).toEqual([
      [3, "A1", 'Crema "extra", 50 ml', 7],
      [5, "B2", "Línea\r\npartida", 3],
    ]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([
      { line: 7, message: "Disponible vacío o no es un número" },
    ]);
  });

  it("falls back to On hand when there is no Available column", () => {
    const result = parseInventoryCsv("Sku\tExistencias\nA\t4\n");
    expect(result.delimiter).toBe("\t");
    expect(result.columns.availableFrom).toBe("on_hand");
    expect(result.stock[0]).toMatchObject({ sku: "A", available: 4 });
  });

  it("returns friendly fatal errors", () => {
    expect(parseInventoryCsv("").fatal).toBe("El archivo está vacío.");
    expect(parseInventoryCsv("﻿ \n").fatal).toBe("El archivo está vacío.");
    expect(parseInventoryCsv("Nombre,Disponible\nA,1").fatal).toBe(
      "No se encontró la columna de SKU (sku, SKU, Sku, código).",
    );
    expect(parseInventoryCsv("SKU,Nombre\nA,B").fatal).toBe(
      "No se encontró la columna de disponibles (Available, Disponible u On hand).",
    );
    expect(
      parseInventoryCsv(`SKU,Available\n${"A,1\n".repeat(20_001)}`).fatal,
    ).toBe("El archivo tiene más de 20.000 filas.");
    expect(
      parseInventoryCsv(`SKU,Available\n${"x".repeat(1_000_001)}`).fatal,
    ).toBe("El archivo pesa más de 1 MB.");
  });

  it("reports row errors with 1-based lines", () => {
    const result = parseInventoryCsv(
      "SKU,Available,Name\n,5,Sin código\nA,,Vacío\nB,abc,Texto\n",
    );
    expect(result.errors).toEqual([
      { line: 2, message: "Fila sin SKU" },
      { line: 3, message: "Disponible vacío o no es un número" },
      { line: 4, message: "Disponible vacío o no es un número" },
    ]);
    expect(result.stock).toEqual([]);
  });

  it("drops a SKU repeated in the same warehouse and sums distinct warehouses", () => {
    const result = parseInventoryCsv(
      "SKU,Warehouse,Available\nDUP,Boxful,5\ndup,Boxful,6\nMULTI,Boxful,10\nmulti,Bodega 2,4\nOK,,1\n",
    );
    expect(result.errors).toEqual([
      { line: 2, message: "SKU repetido en la misma bodega" },
      { line: 3, message: "SKU repetido en la misma bodega" },
    ]);
    expect(result.stock).toEqual([
      expect.objectContaining({
        sku: "MULTI",
        available: 14,
        warehouseId: "varias",
      }),
      expect.objectContaining({ sku: "OK", available: 1, warehouseId: "csv" }),
    ]);
  });

  it("treats Sku and sku as the same key", () => {
    const result = parseInventoryCsv("Sku,Available\nAbC,1\n");
    expect(result.rows[0].skuKey).toBe("abc");
    expect(
      matchInventoryToCatalog(result.stock, [
        { key: "sku:abc", sku: "ABC", name: "Producto" },
      ]).matched,
    ).toBe(1);
  });

  it("parses numbers in both locales", () => {
    expect(parseInventoryNumber("1.234,5")).toBe(1234.5);
    expect(parseInventoryNumber("1,234.5")).toBe(1234.5);
    expect(parseInventoryNumber("1,079")).toBe(1079);
    expect(parseInventoryNumber("2,5")).toBe(2.5);
    expect(parseInventoryNumber("0,500")).toBe(0.5);
    expect(parseInventoryNumber("1.234.567")).toBe(1234567);
    expect(parseInventoryNumber(" 1 079 ")).toBe(1079);
    expect(parseInventoryNumber("-3")).toBe(-3);
    expect(parseInventoryNumber("")).toBeNull();
    expect(parseInventoryNumber("12a")).toBeNull();
    expect(parseInventoryNumber("1.23.4")).toBeNull();
  });

  it("matches inventory to the catalog by lowercase SKU key", () => {
    const { stock } = parseInventoryCsv(
      "SKU,Name,Available\nHER.LOSS,Her Loss,100\nNUEVO,Producto nuevo,3\n",
    );
    expect(
      matchInventoryToCatalog(stock, [
        { key: "sku:her.loss", sku: "HER.LOSS", name: "Her Loss" },
        { key: "sku:turk", sku: "TURK", name: "Turkesterone" },
        { key: "name:abridor", sku: "", name: "Abridor" },
      ]),
    ).toEqual({
      matched: 1,
      unmatched: [{ sku: "NUEVO", name: "Producto nuevo" }],
      catalogWithoutStock: 1,
    });
  });

  it("reads the optional Backorder and Incoming columns and sums warehouses", () => {
    const result = parseInventoryCsv(
      "SKU,Warehouse,Available,Backorder,Incoming\nFAT.BURN.NEGRO.S,Boxful,0,85,\nFAT.BURN.NEGRO.S,Bodega 2,3,,40\nHER.LOSS,Boxful,300,,\n",
    );
    expect(result.columns).toMatchObject({
      backorder: "Backorder",
      incoming: "Incoming",
    });
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ backorder: 85, incoming: null });
    expect(result.stock).toEqual([
      expect.objectContaining({
        sku: "FAT.BURN.NEGRO.S",
        available: 3,
        backorder: 85,
        incoming: 40,
        warehouseId: "varias",
      }),
      // Empty cells are "sin dato", not zero and not an error.
      expect.objectContaining({
        sku: "HER.LOSS",
        backorder: null,
        incoming: null,
      }),
    ]);
  });

  it("recognizes Spanish aliases and leaves the extras out when absent", () => {
    const spanish = parseInventoryCsv(
      "Código;Disponible;Pedidos en espera;En tránsito\nA;5;2;1.000\n",
    );
    expect(spanish.columns).toMatchObject({
      backorder: "Pedidos en espera",
      incoming: "En tránsito",
    });
    expect(spanish.stock[0]).toMatchObject({ backorder: 2, incoming: 1000 });
    const plain = parseInventoryCsv("SKU,Available\nA,5\n");
    expect(plain.columns).toMatchObject({ backorder: null, incoming: null });
    expect(plain.stock[0]).not.toHaveProperty("backorder");
    expect(plain.stock[0]).not.toHaveProperty("incoming");
  });

  it("does not reject a row for an unreadable extra cell", () => {
    const result = parseInventoryCsv("SKU,Available,On order\nA,5,n/d\n");
    expect(result.errors).toEqual([]);
    expect(result.columns.incoming).toBe("On order");
    expect(result.stock[0]).toMatchObject({ available: 5, incoming: null });
  });
});
