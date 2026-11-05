import { describe, expect, it } from "vitest";
import {
  buildCancelReport,
  cancelBucket,
  cancelFactKind,
  closedCancelRate,
} from "../lib/marketing-cancellations";
import type { MotivoMarketing } from "../lib/anulacion-motivos";
import type {
  OrderFactRow,
  OrderOrigin,
} from "../lib/marketing-insights-types";

const TODAY = "2026-11-05";
const row = (
  date: string,
  state: 0 | 1 | 2,
  reason: MotivoMarketing | "" = "",
  items: number[] = [0],
  origin: OrderOrigin = "formulario",
): OrderFactRow => [date, state, reason, origin, "", items];
const payload = (facts: OrderFactRow[]) => ({
  facts,
  products: ["Her Loss", "Shilajit", "NAD+"],
  titles: ["Her Loss – Colonia", "Shilajit cápsulas", "NAD+ Men's Complex"],
  today: TODAY,
});
const repeat = (n: number, make: (i: number) => OrderFactRow) =>
  Array.from({ length: n }, (_, i) => make(i));

describe("cancelBucket", () => {
  it("splits avoidable, not a real loss and loss", () => {
    expect(cancelBucket("numero_errado")).toBe("evitable");
    expect(cancelBucket("cambio_en_la_orden")).toBe("evitable");
    expect(cancelBucket("duplicado")).toBe("no_perdida");
    expect(cancelBucket("upsell")).toBe("no_perdida");
    expect(cancelBucket("prueba")).toBe("no_perdida");
    expect(cancelBucket("cliente_cancelo")).toBe("perdida");
    expect(cancelBucket("lista_negra")).toBe("perdida");
    expect(cancelBucket("sin_motivo")).toBe("perdida");
    expect(cancelBucket("otro")).toBe("perdida");
  });
});

describe("buildCancelReport", () => {
  it("reproduces the week of 28 oct – 3 nov: 145 of 739 = 19,6 %", () => {
    // 755 created, 161 cancelled; 16 cancelled as upsell replacements.
    const date = (i: number) =>
      [
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
      ][i % 7];
    const facts = [
      ...repeat(594, (i) => row(date(i), 0)),
      ...repeat(16, (i) => row(date(i), 1, "upsell")),
      ...repeat(39, (i) => row(date(i), 1, "duplicado")),
      ...repeat(36, (i) => row(date(i), 1, "cambio_en_la_orden")),
      ...repeat(22, (i) => row(date(i), 1, "numero_errado")),
      ...repeat(11, (i) => row(date(i), 1, "cliente_cancelo")),
      ...repeat(15, (i) => row(date(i), 1, "lista_negra")),
      ...repeat(22, (i) => row(date(i), 1, "otro")),
    ];
    expect(facts).toHaveLength(755);
    const report = buildCancelReport(
      payload(facts),
      "2026-10-28",
      "2026-11-03",
    );
    expect(report.total.created).toBe(755);
    expect(report.total.base).toBe(739);
    expect(report.total.annulled).toBe(145);
    expect(report.total.replaced).toBe(16);
    expect(report.total.rate).toBeCloseTo(145 / 739, 6);
    expect(Math.round(report.total.rate! * 1000) / 10).toBe(19.6);
    // Without duplicates: (145 − 39) / (739 − 39).
    expect(report.total.rateWithoutDuplicates).toBeCloseTo(106 / 700, 6);
    // Like Gestión: also without número errado, cambio en la orden, lista negra.
    const gestion = 39 + 36 + 22 + 15;
    expect(report.total.rateGestion).toBeCloseTo(
      (145 - gestion) / (739 - gestion),
      6,
    );
    expect(report.buckets).toEqual({
      evitable: 58,
      no_perdida: 39,
      perdida: 48,
    });
    expect(report.reasons[0]).toMatchObject({ code: "duplicado", count: 39 });
    expect(report.reasons.find((r) => r.code === "upsell")).toBeUndefined();
    expect(report.bucketReasons.evitable.map((r) => r.code)).toEqual([
      "cambio_en_la_orden",
      "numero_errado",
    ]);
    expect(report.days).toHaveLength(7);
    expect(report.days.reduce((n, d) => n + d.base, 0)).toBe(739);
    expect(report.hasOpenDays).toBe(false);
  });

  it("leaves Testeos / Producto Agotado and tests out of the base", () => {
    const report = buildCancelReport(
      payload([
        row("2026-11-01", 0),
        row("2026-11-01", 1, "cliente_cancelo"),
        row("2026-11-01", 2),
        row("2026-11-01", 1, "prueba"),
      ]),
      "2026-11-01",
      "2026-11-01",
    );
    expect(report.total).toMatchObject({
      created: 4,
      base: 2,
      annulled: 1,
      rate: 0.5,
      notCounted: 1,
      replaced: 1,
    });
  });

  it("marks the last days as open and fills days without orders", () => {
    const report = buildCancelReport(
      payload([row("2026-11-05", 0), row("2026-11-02", 1, "otro")]),
      "2026-11-01",
      "2026-11-05",
    );
    expect(report.days.map((d) => [d.date, d.open, d.rate])).toEqual([
      ["2026-11-01", false, null],
      ["2026-11-02", false, 1],
      ["2026-11-03", false, null],
      ["2026-11-04", true, null],
      ["2026-11-05", true, 0],
    ]);
    expect(report.hasOpenDays).toBe(true);
    expect(report.days[1].byBucket.perdida).toBe(1);
    // Headline: closed days only (the open ones can still be annulled).
    expect(report.total.rate).toBe(0.5);
    expect(report.closed).toEqual({ base: 1, annulled: 1, rate: 1, days: 3 });
  });

  it("closedCancelRate: same definition as the report, last closed days", () => {
    const facts = [
      ...repeat(8, () => row("2026-11-03", 0)),
      row("2026-11-03", 1, "cliente_cancelo"),
      row("2026-11-03", 1, "upsell"), // replacement: out
      row("2026-11-03", 2), // Testeos: out
      row("2026-11-02", 1, ""), // sin motivo: annulled
      row("2026-11-02", 0),
      row("2026-11-04", 1, "otro"), // open day: out
      row("2026-10-20", 1, "otro"), // before loadedFrom: out
    ];
    const out = closedCancelRate(
      { facts, to: TODAY, loadedFrom: "2026-10-25" },
      TODAY,
      7,
    );
    expect(out).toEqual({
      from: "2026-11-02",
      to: "2026-11-03",
      days: 2,
      base: 11,
      annulled: 2,
      rate: 2 / 11,
    });
    const report = buildCancelReport(
      payload(facts),
      "2026-11-02",
      "2026-11-03",
    );
    expect(report.total.rate).toBe(out.rate);
    expect(cancelFactKind(row("2026-11-02", 1, "prueba"))).toBe("reemplazo");
  });

  it("ignores facts outside the period (loaded weeks before)", () => {
    const report = buildCancelReport(
      payload([row("2026-10-01", 1, "otro"), row("2026-11-03", 0)]),
      "2026-11-03",
      "2026-11-03",
    );
    expect(report.total.base).toBe(1);
    expect(report.total.annulled).toBe(0);
  });

  it("counts a combo once per product and only products with enough orders", () => {
    const facts = [
      ...repeat(8, () => row("2026-11-01", 0, "", [0, 1])),
      ...repeat(2, () => row("2026-11-01", 1, "numero_errado", [0, 1, 1])),
      ...repeat(9, () => row("2026-11-01", 0, "", [2])),
    ];
    const report = buildCancelReport(
      payload(facts),
      "2026-11-01",
      "2026-11-01",
    );
    expect(report.byProduct).toEqual([
      {
        id: 0,
        name: "Her Loss",
        title: "Her Loss – Colonia",
        orders: 10,
        annulled: 2,
        rate: 0.2,
        avoidable: 2,
      },
      {
        id: 1,
        name: "Shilajit",
        title: "Shilajit cápsulas",
        orders: 10,
        annulled: 2,
        rate: 0.2,
        avoidable: 2,
      },
    ]);
  });

  it("splits by origin", () => {
    const report = buildCancelReport(
      payload([
        row("2026-11-01", 0, "", [0], "bot"),
        row("2026-11-01", 1, "duplicado", [0], "bot"),
        row("2026-11-01", 0, "", [0], "shopify"),
      ]),
      "2026-11-01",
      "2026-11-01",
    );
    expect(report.byOrigin).toEqual([
      {
        origin: "bot",
        label: "Bot de WhatsApp e IA",
        orders: 2,
        annulled: 1,
        rate: 0.5,
      },
      {
        origin: "shopify",
        label: "Shopify",
        orders: 1,
        annulled: 0,
        rate: 0,
      },
    ]);
  });

  it("returns null rates without orders", () => {
    const report = buildCancelReport(payload([]), "2026-11-01", "2026-11-02");
    expect(report.total.rate).toBeNull();
    expect(report.total.rateWithoutDuplicates).toBeNull();
    expect(report.reasons).toEqual([]);
  });
});
