import { describe, expect, it } from "vitest";
import {
  coverageOf,
  restockDelta,
  stockFor,
  stockIndex,
  targetCoverage,
} from "../lib/marketing-coverage";
import type { MarketingStock } from "../lib/marketing-source-types";

const stock = (sku: string, available: number, warehouseId = "CR") =>
  ({
    sku,
    warehouseId,
    available,
    onHand: available,
    allocated: 0,
  }) as MarketingStock;

describe("stock en días de cobertura", () => {
  it("measures days with the last 7 completed days of demand", () => {
    // Her Loss: 100 units at 16.7 a day → 6 days, yellow.
    expect(coverageOf(100, 16.7 * 7)).toMatchObject({
      tone: "yellow",
      label: "6,0 días",
    });
    expect(coverageOf(100, 16.7 * 7).days).toBeCloseTo(5.99, 2);
    // Cápsulas: 100 units at 0.8 a day → 125 days.
    expect(coverageOf(100, 0.8 * 7)).toMatchObject({
      tone: "ok",
      days: 125,
      label: "125 días",
    });
    expect(coverageOf(5, 14)).toMatchObject({
      tone: "red",
      days: 2.5,
      label: "2,5 días",
    });
  });
  it("names sold out, no demand and unknown stock, and never paints them red without demand", () => {
    expect(coverageOf(0, 7)).toMatchObject({
      tone: "red",
      days: 0,
      label: "Agotado",
    });
    expect(coverageOf(-3, 7)).toMatchObject({ days: 0, label: "Agotado" });
    expect(coverageOf(0, 0)).toMatchObject({
      tone: "no_demand",
      days: null,
      label: "Sin ventas en 7 días",
    });
    expect(coverageOf(null, 10)).toMatchObject({
      tone: "unknown",
      label: "Sin stock cargado",
    });
    expect(coverageOf(null, 10, undefined, { ambiguous: true }).label).toBe(
      "SKU sin coincidencia única",
    );
  });
  it("indexes SKUs case-insensitively and marks a repeated SKU as ambiguous", () => {
    const index = stockIndex([
      stock("HER.LOSS", 100),
      stock("A", 1),
      stock("a", 2),
    ]);
    expect(stockFor(index, " her.loss ")).toEqual({
      available: 100,
      ambiguous: false,
    });
    expect(stockFor(index, "A")).toEqual({ available: null, ambiguous: true });
    expect(stockFor(index, "X")).toEqual({ available: null, ambiguous: false });
    expect(stockIndex(null).size).toBe(0);
  });
  it("sums a family's known stock against the demand of every member", () => {
    const products = [
      { key: "sku:fat.s", sku: "FAT.S", recentUnits: 14 },
      { key: "sku:fat.m", sku: "FAT.M", recentUnits: 7 },
    ];
    const both = targetCoverage(
      ["sku:fat.s", "sku:fat.m"],
      products,
      stockIndex([stock("FAT.S", 10), stock("FAT.M", 11)]),
    );
    expect(both).toMatchObject({
      available: 21,
      dailyUnits: 3,
      days: 7,
      tone: "ok",
      partial: false,
    });
    expect(both.members.map((m) => m.coverage.tone)).toEqual(["yellow", "ok"]);
    // One member that sells has no stock loaded: partial and unknown.
    const partial = targetCoverage(
      ["sku:fat.s", "sku:fat.m"],
      products,
      stockIndex([stock("FAT.S", 100)]),
    );
    expect(partial).toMatchObject({
      available: 100,
      partial: true,
      tone: "unknown",
      days: null,
    });
    // …unless the known part is already red on its own demand.
    expect(
      targetCoverage(
        ["sku:fat.s", "sku:fat.m"],
        products,
        stockIndex([stock("FAT.S", 2)]),
      ),
    ).toMatchObject({ partial: true, tone: "red", available: 2 });
    // A member without sales and without stock does not make it partial.
    expect(
      targetCoverage(
        ["sku:fat.s", "sku:fat.xl"],
        products,
        stockIndex([stock("FAT.S", 100)]),
      ),
    ).toMatchObject({ partial: false, tone: "ok" });
  });
  it("detects restocks against the previous snapshot", () => {
    const delta = restockDelta(
      [stock("HER.LOSS", 400), stock("TURKESTERONE", 93), stock("A", 5)],
      [stock("her.loss", 100), stock("A", 9)],
    );
    expect(Object.fromEntries(delta)).toEqual({
      "her.loss": 300,
      turkesterone: 93,
    });
    expect(restockDelta([stock("A", 5)], null).size).toBe(0);
    expect(
      restockDelta(
        [stock("A", 5, "CR"), stock("A", 5, "SJ")],
        [stock("A", 4)],
      ).get("a"),
    ).toBe(6);
  });
});
