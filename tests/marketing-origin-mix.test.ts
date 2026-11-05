import { describe, expect, it } from "vitest";
import { buildComplements, buildOriginMix } from "../lib/marketing-origin-mix";
import type {
  FactState,
  OrderFactRow,
  OrderOrigin,
} from "../lib/marketing-insights-types";
import { shiftDate } from "../lib/marketing-dates";
import { MARKETING_TARGETS } from "../lib/marketing-targets";

const TODAY = "2026-11-05";
const plain = (value: string) => value.replace(/ | /g, " ");
const fact = (
  date: string,
  items: number[],
  origin: OrderOrigin = "formulario",
  state: FactState = 0,
): OrderFactRow => [
  date,
  state,
  state === 1 ? "duplicado" : "",
  origin,
  "",
  items,
];
const products = [
  "Turkesterone",
  "Gomitas de Shilajit",
  "Her Loss",
  "Creatina",
];
const titles = products.map((p) => `${p} – completo`);
const times = (n: number, make: () => OrderFactRow) =>
  Array.from({ length: n }, make);

describe("buildOriginMix", () => {
  it("shares real orders by origin and counts created ones", () => {
    const facts = [
      ...times(6, () => fact("2026-11-03", [0], "bot")),
      ...times(3, () => fact("2026-11-04", [0], "formulario")),
      fact("2026-11-04", [0], "carrito"),
      fact("2026-11-04", [0], "bot", 1),
      fact("2026-11-04", [0], "bot", 2),
      fact("2026-10-01", [0], "shopify"), // outside the period
    ];
    const mix = buildOriginMix({ facts }, "2026-11-03", "2026-11-04");
    expect(mix.total).toBe(12);
    expect(mix.real).toBe(10);
    expect(mix.rows.map((r) => [r.origin, r.real, r.created])).toEqual([
      ["bot", 6, 8],
      ["formulario", 3, 3],
      ["carrito", 1, 1],
    ]);
    expect(mix.rows[0].share).toBeCloseTo(0.6);
    expect(mix.rows[0].label).toBe("Bot de WhatsApp");
    expect(mix.daily).toHaveLength(2);
    expect(mix.daily[1]).toMatchObject({
      date: "2026-11-04",
      total: 4,
      byOrigin: { formulario: 3, carrito: 1, bot: 0 },
    });
    expect(mix.shopifyEnded).toBeNull();
  });

  it("notes when Shopify stopped receiving orders inside the period", () => {
    const facts = [
      fact("2026-10-25", [0], "shopify"),
      fact("2026-10-27", [0], "shopify"),
      fact("2026-11-04", [0], "formulario"),
    ];
    expect(
      buildOriginMix({ facts }, "2026-10-20", "2026-11-04").shopifyEnded,
    ).toBe("2026-10-27");
    // Still receiving at the end of the period: no note.
    expect(
      buildOriginMix({ facts }, "2026-10-20", "2026-10-28").shopifyEnded,
    ).toBeNull();
  });
});

describe("buildComplements", () => {
  const base = { products, titles, loadedFrom: shiftDate(TODAY, -35) };

  it("counts combos, principal and complement; 3x the same product is not a combo", () => {
    const facts = [
      fact("2026-11-04", [0, 1]),
      fact("2026-11-04", [0, 1]),
      fact("2026-11-04", [2, 1]),
      fact("2026-11-04", [0]),
      fact("2026-11-04", [3, 3]), // same product: quantity offer
      fact("2026-11-04", [0, 1, 2]),
      fact("2026-11-04", [1, 0], "bot", 1), // annulled: ignored
    ];
    const report = buildComplements(
      { ...base, facts },
      "2026-11-01",
      "2026-11-04",
      TODAY,
    );
    expect(report.orders).toBe(6);
    expect(report.combos).toBe(4);
    expect(report.comboRate).toBeCloseTo(4 / 6);
    const gomitas = report.products.find((p) => p.id === 1)!;
    expect(gomitas).toMatchObject({
      name: "Gomitas de Shilajit",
      fullName: "Gomitas de Shilajit – completo",
      orders: 4,
      asPrincipal: 0,
      asComplement: 4,
      complementShare: 1,
      mostlyComplement: false, // under 5 orders
    });
    const turk = report.products.find((p) => p.id === 0)!;
    expect(turk).toMatchObject({ orders: 4, asPrincipal: 4, asComplement: 0 });
    expect(report.products.find((p) => p.id === 3)).toMatchObject({
      orders: 1,
      asPrincipal: 1,
      asComplement: 0,
    });
    expect(report.pairs[0]).toMatchObject({
      principal: "Turkesterone",
      complement: "Gomitas de Shilajit",
      orders: 3,
    });
    expect(report.pairs).toHaveLength(3); // T+G ×3, H+G, T+H
  });

  it("flags a product sold mostly as a complement from 5 orders", () => {
    const facts = [
      ...times(4, () => fact("2026-11-04", [0, 1])),
      fact("2026-11-04", [1]),
    ];
    const report = buildComplements(
      { ...base, facts },
      "2026-11-01",
      "2026-11-04",
      TODAY,
    );
    const gomitas = report.products.find((p) => p.id === 1)!;
    expect(gomitas.complementShare).toBeCloseTo(0.8);
    expect(gomitas.mostlyComplement).toBe(true);
  });

  /** `perWeek[i]` complement orders of Gomitas in block i (0 = last 7 days). */
  const weeks = (perWeek: number[], end = shiftDate(TODAY, -1)) =>
    perWeek.flatMap((n, i) =>
      times(n, () => fact(shiftDate(end, -(7 * i) - 3), [0, 1])),
    );

  it("alerts a complement drop (12 a week → 3)", () => {
    const report = buildComplements(
      { ...base, facts: weeks([3, 12, 12, 12, 12]) },
      shiftDate(TODAY, -6),
      TODAY,
      TODAY,
    );
    expect(report.drops).toHaveLength(1);
    expect(report.drops[0]).toMatchObject({
      id: 1,
      before: 12,
      now: 3,
      title: "Gomitas de Shilajit como complemento cayó",
    });
    expect(plain(report.drops[0].detail)).toBe("De 12 a 3 por semana.");
    expect(report.dropWeeks).toEqual({
      from: shiftDate(TODAY, -7),
      to: shiftDate(TODAY, -1),
      beforeFrom: shiftDate(TODAY, -35),
    });
  });

  it("does not alert under 5 a week, nor a drop smaller than half", () => {
    expect(
      buildComplements(
        { ...base, facts: weeks([0, 4, 4, 4, 4]) },
        shiftDate(TODAY, -6),
        TODAY,
        TODAY,
      ).drops,
    ).toEqual([]);
    expect(
      buildComplements(
        { ...base, facts: weeks([7, 12, 12, 12, 12]) },
        shiftDate(TODAY, -6),
        TODAY,
        TODAY,
      ).drops,
    ).toEqual([]);
  });

  it("ignores annulled orders in the drops and uses the period end when it is in the past", () => {
    const end = "2026-10-20";
    const annulled = (perWeek: number[]) =>
      perWeek.flatMap((n, i) =>
        times(n, () =>
          fact(shiftDate(end, -(7 * i) - 3), [0, 1], "formulario", 1),
        ),
      );
    const report = buildComplements(
      {
        ...base,
        loadedFrom: shiftDate(end, -34),
        facts: [
          ...weeks([2, 10, 10, 10, 10], end),
          ...annulled([0, 9, 9, 9, 9]),
        ],
      },
      "2026-10-14",
      end,
      TODAY,
    );
    expect(report.dropWeeks?.to).toBe(end);
    expect(report.drops.map((d) => [d.before, d.now])).toEqual([[10, 2]]);
  });

  it("skips the drops when fewer than 5 weeks are loaded", () => {
    const report = buildComplements(
      { ...base, loadedFrom: shiftDate(TODAY, -20), facts: weeks([0, 12, 12]) },
      shiftDate(TODAY, -6),
      TODAY,
      TODAY,
      MARKETING_TARGETS,
    );
    expect(report.dropWeeks).toBeNull();
    expect(report.drops).toEqual([]);
  });
});
