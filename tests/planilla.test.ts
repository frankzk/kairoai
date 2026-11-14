import { describe, expect, it } from "vitest";
import {
  formatoMonto,
  montoEnColones,
  moverQuincena,
  notaGasto,
  nombreQuincena,
  puedeCerrar,
  quincenaDe,
  quincenaDeFecha,
  totalesLinea,
  totalesQuincena,
} from "@/lib/planilla";

describe("quincenas", () => {
  it("calcula las fechas de cada mitad, con fin de mes real", () => {
    expect(quincenaDe("2026-11-1")).toEqual({ startsOn: "2026-11-01", endsOn: "2026-11-15" });
    expect(quincenaDe("2026-11-2")).toEqual({ startsOn: "2026-11-16", endsOn: "2026-11-30" });
    expect(quincenaDe("2028-02-2")).toEqual({ startsOn: "2028-02-16", endsOn: "2028-02-29" });
    expect(quincenaDe("2026-13-1")).toBeNull();
    expect(quincenaDe("2026-11-3")).toBeNull();
  });

  it("ubica una fecha y se mueve entre quincenas y años", () => {
    expect(quincenaDeFecha("2026-11-15")).toBe("2026-11-1");
    expect(quincenaDeFecha("2026-11-16")).toBe("2026-11-2");
    expect(moverQuincena("2026-12-2", 1)).toBe("2027-01-1");
    expect(moverQuincena("2027-01-1", -1)).toBe("2026-12-2");
    expect(moverQuincena("2026-11-1", -1)).toBe("2026-10-2");
    expect(nombreQuincena("2026-11-2")).toBe("16 al 30 de noviembre 2026");
  });
});

describe("totales por persona", () => {
  it("suma extras y resta rebajos; los abonos anulados no cuentan", () => {
    const t = totalesLinea(
      150000,
      [
        { kind: "extra", amount: 12000 },
        { kind: "bono", amount: 10000 },
        { kind: "rebajo", amount: 5000 },
        { kind: "ccss", amount: 15975 },
      ],
      [
        { amount: 50000 },
        { amount: 30000, voided_at: "2026-11-10T10:00:00Z" },
      ]
    );
    expect(t).toEqual({ base: 150000, sumas: 22000, restas: 20975, total: 151025, abonado: 50000, saldo: 101025, estado: "parcial" });
  });

  it("estados", () => {
    expect(totalesLinea(100, [], []).estado).toBe("pendiente");
    expect(totalesLinea(100, [], [{ amount: 100 }]).estado).toBe("pagado");
    expect(totalesLinea(100, [], [{ amount: 120 }]).estado).toBe("sobrepago");
    expect(totalesLinea(0, [], []).estado).toBe("sin_monto");
  });

  it("totales de la quincena por moneda y cierre", () => {
    const a = { moneda: "CRC", totales: totalesLinea(100, [], [{ amount: 100 }]) };
    const b = { moneda: "CRC", totales: totalesLinea(200, [], [{ amount: 50 }]) };
    const c = { moneda: "USD", totales: totalesLinea(300, [], []) };
    expect(totalesQuincena([a, b, c])).toEqual([
      { moneda: "CRC", total: 300, abonado: 150, saldo: 150, personas: 2, pagadas: 1 },
      { moneda: "USD", total: 300, abonado: 0, saldo: 300, personas: 1, pagadas: 0 },
    ]);
    expect(puedeCerrar([a, b])).toBe(false);
    expect(puedeCerrar([a])).toBe(true);
    expect(puedeCerrar([])).toBe(false);
  });

  it("formato de montos", () => {
    const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
    expect(plain(formatoMonto(151025, "CRC"))).toBe("₡151 025");
    expect(plain(formatoMonto(-500, "CRC"))).toBe("−₡500");
    expect(plain(formatoMonto(250.5, "PEN"))).toBe("S/ 250,5");
  });

  it("convierte el abono a colones con la nota que Gastos lee", () => {
    expect(montoEnColones("PEN", 1200, 141.25)).toBe(169500);
    expect(montoEnColones("CRC", 50000, null)).toBe(50000);
    expect(notaGasto("PEN", 1200, 141.25, "Abono 1")).toBe("Monto original: PEN 1200.00\nTipo de cambio PEN->CRC: 141.25\nNota: Abono 1");
    expect(notaGasto("CRC", 50000, null, "x")).toBe("x");
  });
});
