import { describe, expect, it } from "vitest";
import {
  ageGenderReport,
  provinceReport,
  segmentationRange,
} from "../lib/marketing-segments";
import type { CrProvince } from "../lib/cr-provinces";
import type { MotivoMarketing } from "../lib/anulacion-motivos";
import type {
  AgeGenderRow,
  OrderFactRow,
} from "../lib/marketing-insights-types";
import type { UsdRate } from "../lib/marketing-charlie-types";

const fact = (
  province: CrProvince | "",
  state: 0 | 1 | 2 = 0,
  reason: MotivoMarketing | "" = "",
  date = "2026-11-03",
): OrderFactRow => [date, state, reason, "formulario", province, [0]];
const many = (n: number, make: () => OrderFactRow) =>
  Array.from({ length: n }, make);

describe("provinceReport", () => {
  const facts = [
    ...many(31, () => fact("San José")),
    ...many(9, () => fact("San José", 1, "duplicado")),
    ...many(20, () => fact("Alajuela")),
    ...many(5, () => fact("Alajuela", 1, "upsell")), // no era un pedido
    ...many(35, () => fact("Limón")),
    ...many(14, () => fact("")),
    fact("", 1, "numero_errado"),
    fact("Heredia", 2), // Testeos: no cuenta
    fact("Cartago", 0, "", "2026-10-01"), // fuera del período
  ];
  const report = provinceReport({ facts }, "2026-11-01", "2026-11-04");

  it("ordena por pedidos reales y calcula la parte sobre el total", () => {
    expect(report.total).toBe(100);
    expect(report.rows.map((r) => r.province)).toEqual([
      "Limón",
      "San José",
      "Alajuela",
    ]);
    expect(report.rows[1]).toMatchObject({ real: 31, share: 0.31, annulled: 9 });
    expect(report.rows[1].cancelRate).toBeCloseTo(9 / 40);
  });

  it("los reemplazos por upsell y Testeos no cuentan como anulación", () => {
    expect(report.rows[2]).toMatchObject({ real: 20, annulled: 0, cancelRate: 0 });
    expect(report.rows.some((r) => r.province === "Heredia")).toBe(false);
  });

  it("sin provincia va aparte", () => {
    expect(report.unknown).toBe(14);
    expect(report.unknownAnnulled).toBe(1);
  });
});

describe("ageGenderReport", () => {
  const fx: UsdRate = {
    rate: 500,
    date: "2026-11-04",
    source: "hacienda",
    checkedAt: "",
    message: "",
    pen: null,
  };
  const row = (
    over: Partial<AgeGenderRow> & Pick<AgeGenderRow, "age" | "gender">,
  ): AgeGenderRow => ({
    accountId: "1",
    currency: "USD",
    spend: 100,
    purchases: 10,
    ...over,
  });

  it("convierte a USD, suma cuentas y calcula el CPA del píxel", () => {
    const report = ageGenderReport(
      [
        row({ age: "25-34", gender: "female" }),
        row({
          accountId: "2",
          currency: "CRC",
          spend: 50_000,
          purchases: 5,
          age: "25-34",
          gender: "female",
        }),
        row({ age: "35-44", gender: "male", spend: 60, purchases: 0 }),
        row({ age: "18-24", gender: "unknown", spend: 2, purchases: 1 }),
        row({ age: "65+", gender: "male", spend: 3, purchases: 0 }),
      ],
      fx,
    );
    expect(report.total.spendUsd).toBe(265);
    expect(report.rows.map((r) => r.label)).toEqual([
      "25-34 · Mujeres",
      "35-44 · Hombres",
      "Otros",
    ]);
    expect(report.rows[0]).toMatchObject({ spendUsd: 200, purchases: 15 });
    expect(report.rows[0].cpaPixel).toBeCloseTo(13.33, 2);
    expect(report.rows[1].cpaPixel).toBeNull();
    expect(report.rows[2]).toMatchObject({ spendUsd: 5, purchases: 1 });
    expect(report.grouped).toBe(2);
    expect(report.byGender.map((g) => [g.label, g.spendUsd])).toEqual([
      ["Mujeres", 200],
      ["Hombres", 63],
      ["Sin dato", 2],
    ]);
    expect(report.byAge.map((a) => a.age)).toEqual([
      "18-24",
      "25-34",
      "35-44",
      "65+",
    ]);
    expect(report.rows[0].shareSpend).toBeCloseTo(200 / 265);
  });

  it("una cuenta en CRC sin tasa queda fuera y se avisa", () => {
    const report = ageGenderReport(
      [
        row({ age: "25-34", gender: "female" }),
        row({ accountId: "2", currency: "CRC", spend: 50_000, age: "25-34", gender: "male" }),
      ],
      { ...fx, rate: null, source: "unavailable" },
    );
    expect(report.unconverted).toEqual(["2"]);
    expect(report.total.spendUsd).toBe(100);
  });

  it("sin filas devuelve totales en cero", () => {
    const report = ageGenderReport([], fx);
    expect(report.rows).toEqual([]);
    expect(report.total).toEqual({ spendUsd: 0, purchases: 0, cpaPixel: null });
  });
});

describe("segmentationRange", () => {
  const today = "2026-11-05";
  it("corta en ayer y en 31 días", () => {
    expect(segmentationRange({ from: "2026-11-01", to: today }, today)).toEqual({
      from: "2026-11-01",
      to: "2026-11-04",
    });
    expect(segmentationRange({ from: "2026-08-01", to: "2026-10-31" }, today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });
  it("solo hoy: últimos 7 días completos", () => {
    expect(segmentationRange({ from: today, to: today }, today)).toEqual({
      from: "2026-10-29",
      to: "2026-11-04",
    });
  });
});
