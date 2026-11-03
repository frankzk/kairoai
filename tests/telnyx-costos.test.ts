// Costo de las llamadas de Telnyx en Configuracion.
//
// POR QUE ESTE TEST EXISTE: el total tiene que ser honesto. Una llamada sin
// costo informado (anterior a activar el aviso, o que Telnyx no pudo calcular)
// no puede sumar 0 como si hubiera sido gratis: se cuenta aparte. Y "hoy" es
// hoy en Costa Rica, no en UTC.

import { describe, expect, it } from "vitest";
import { iniciosDePeriodo, resumirCostos, type FilaCosto } from "../lib/telnyx-costos";
import { describeZadarmaCall } from "../lib/zadarma";
import { ESTADO_NO_MARCADA } from "../lib/telnyx";

const fila = (f: Partial<FilaCosto>): FilaCosto => ({
  store_id: 1,
  vendedora: 7,
  status: "answered",
  started_at: "2026-11-03T15:00:00.000Z",
  answered_at: "2026-11-03T15:00:05.000Z",
  cost: null,
  cost_currency: null,
  billed_seconds: null,
  ...f,
});

describe("costo de llamadas Telnyx", () => {
  it("hoy y el mes empiezan a medianoche de Costa Rica", () => {
    // 03/11 a las 02:00 UTC todavia es 02/11 en Costa Rica.
    expect(iniciosDePeriodo(new Date("2026-11-03T02:00:00Z"))).toEqual({
      hoy: "2026-11-02T06:00:00.000Z",
      mes: "2026-11-01T06:00:00.000Z",
    });
  });

  it("suma por tienda y asesora, y cuenta aparte las llamadas sin costo", () => {
    const nombres = new Map([[7, "Marife Rodriguez"], [8, "Tatiana"]]);
    const r = resumirCostos(
      [
        fila({ cost: "0.0250", cost_currency: "USD", billed_seconds: 120 }),
        fila({ vendedora: 8, cost: 0.0125, cost_currency: "usd", billed_seconds: 60 }),
        fila({ vendedora: 8, store_id: 2, answered_at: null, status: "no answer" }),
        // Preparada y nunca marcada: no es una llamada.
        fila({ status: ESTADO_NO_MARCADA, cost: null }),
        // Antes del periodo.
        fila({ started_at: "2026-11-02T05:00:00.000Z", cost: 1 }),
      ],
      "2026-11-03T06:00:00.000Z",
      nombres,
      (id) => (id === 1 ? "Mireva Costa Rica" : "Mireva Honduras")
    );
    expect(r.general).toMatchObject({ llamadas: 3, contestadas: 2, conCosto: 2, minutosCobrados: 3 });
    expect(r.general.total.USD).toBeCloseTo(0.0375);
    expect(r.porTienda.map((t) => [t.nombre, t.llamadas, t.conCosto])).toEqual([
      ["Mireva Costa Rica", 2, 2],
      ["Mireva Honduras", 1, 0],
    ]);
    expect(r.porAsesora.map((a) => a.nombre)).toEqual(["Marife Rodriguez", "Tatiana"]);
  });

  it("el historial muestra el costo cuando Telnyx lo informo", () => {
    expect(describeZadarmaCall({ direction: "outgoing", status: "answered", duration_seconds: 70, cost: "0.025", cost_currency: "usd" })).toContain(
      "0.0250 USD"
    );
    expect(describeZadarmaCall({ direction: "outgoing", status: "answered", duration_seconds: 70 })).not.toContain("USD");
  });
});
