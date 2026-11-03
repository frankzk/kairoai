// Que anulaciones cuentan para la tasa de confirmacion.
//
// POR QUE ESTE TEST EXISTE: la tasa de confirmacion se usa para medir a las
// asesoras. Un duplicado, un cliente en lista negra, un "cambio en la orden" o
// un pedido reemplazado por upsell no son clientes que rechazaron: si contaran,
// la tasa castigaria trabajo bien hecho. Y al reves: sacar de mas (por ejemplo
// "Cliente no contesta") maquillaria la tasa.

import { describe, expect, it } from "vitest";
import { anulacionExcluida, grupoAnulacionExcluida, tasaConfirmacion } from "../lib/anulacion-motivos";
import { computeOpMetricsFromTrackableRows, type TrackableOrderRow } from "../lib/finance-orders";

describe("motivos de anulación de iComfly", () => {
  it("no cuentan: los que no eran un pedido real que confirmar", () => {
    const casos: Array<[string, string]> = [
      ["Duplicado", "duplicado"],
      ["Número errado", "numero_errado"],
      ["numero errado", "numero_errado"],
      ["Producto agotado", "producto_agotado"],
      ["sin stock", "producto_agotado"],
      ["lista negra ", "lista_negra"],
      ["Lista negra cliente rechazo pedido 2 veces ya no se le puede", "lista_negra"],
      ["cliente tiene 2 devoluciones \n", "lista_negra"],
      ["cliente ya cuenta con dos devoluciones", "lista_negra"],
      ["Mal historial", "lista_negra"],
      ["Error en el pedido", "cambio_en_la_orden"],
      ["Cambio en la orden", "cambio_en_la_orden"],
      ["Fraude/Sospechoso", "fraude"],
      ["Reemplazado por pedido con upsell MANUAL-1793636560140-BYKO3 (ID 84457). Evitar doble despacho y cobro.", "upsell"],
      ["Reemplazado por upsell existente 822506; total acordado 50899. Evitar doble", "upsell"],
      ["migracion de datos", "prueba"],
      ["Testeo", "prueba"],
    ];
    for (const [motivo, grupo] of casos) expect(grupoAnulacionExcluida(motivo), motivo).toBe(grupo);
  });

  it("cuentan: los rechazos y problemas reales de confirmación", () => {
    for (const motivo of [
      "Cliente no contesta",
      "cliente no contesta msj ni llamadas",
      "Cliente canceló",
      "Dirección incorrecta",
      "No cobertura",
      "Cancelado desde Shopify: other",
      "Cancelado desde Shopify: customer",
      "other",
      "reclamo",
      "",
      null,
    ]) {
      expect(anulacionExcluida(motivo), String(motivo)).toBe(false);
    }
  });

  it("tasa de confirmación: despachados ÷ (despachados + anulados que cuentan)", () => {
    expect(tasaConfirmacion(90, 10)).toBe(90);
    expect(tasaConfirmacion(0, 0)).toBeNull();
  });
});

describe("KPIs de Finanzas", () => {
  const fila = (over: Partial<TrackableOrderRow>): TrackableOrderRow =>
    ({
      row_key: Math.random().toString(36),
      source: "shopify",
      guide_number: "",
      courier: "",
      order_name: "IC-1",
      customer_name: "Ana",
      boxful_status: "",
      internal_status: "pending",
      match_status: "matched",
      cod_amount: 10000,
      shopify_order_name: "IC-1",
      shopify_order_number: null,
      shopify_financial_status: "pending",
      shopify_fulfillment_status: "",
      shopify_cancelled_at: null,
      shopify_created_at: "2026-11-01T15:00:00Z",
      package_items: [],
      ...over,
    }) as TrackableOrderRow;

  it("los anulados que no cuentan salen de generados, anulados y de la tasa", () => {
    const m = computeOpMetricsFromTrackableRows(
      [
        fila({ guide_number: "G1", internal_status: "delivered" }),
        fila({ guide_number: "G2", internal_status: "delivered" }),
        fila({ guide_number: "G3", internal_status: "delivered" }),
        fila({ internal_status: "annulled", shopify_cancelled_at: "2026-11-01T16:00:00Z", anulacion_motivo: "Cliente canceló", anulacion_excluida: false }),
        fila({ internal_status: "annulled", shopify_cancelled_at: "2026-11-01T16:00:00Z", anulacion_motivo: "Duplicado", anulacion_excluida: true }),
        fila({ internal_status: "annulled", shopify_cancelled_at: "2026-11-01T16:00:00Z", anulacion_motivo: "Error en el pedido", anulacion_excluida: true }),
      ],
      new Map()
    );
    expect(m).toMatchObject({ generated: 4, dispatched: 3, annulled: 1, annulledExcluded: 2, annulRate: 25, confirmRate: 75 });
  });
});
