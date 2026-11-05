// Que anulaciones cuentan para la tasa de confirmacion.
//
// POR QUE ESTE TEST EXISTE: la tasa de confirmacion se usa para medir a las
// asesoras. Un duplicado, un cliente en lista negra, un "cambio en la orden" o
// un pedido reemplazado por upsell no son clientes que rechazaron: si contaran,
// la tasa castigaria trabajo bien hecho. Y al reves: sacar de mas (por ejemplo
// "Cliente no contesta") maquillaria la tasa.

import { describe, expect, it } from "vitest";
import {
  anulacionExcluida,
  esGrupoGestion,
  grupoAnulacionExcluida,
  MOTIVO_MARKETING_LABEL,
  MOTIVOS_MARKETING,
  motivoMarketing,
  tasaConfirmacion,
} from "../lib/anulacion-motivos";
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

  it("tasa de confirmación: confirmados ÷ generados", () => {
    expect(tasaConfirmacion(75, 100)).toBe(75);
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
    expect(m).toMatchObject({ generated: 4, dispatched: 3, confirmed: 3, annulled: 1, annulledExcluded: 2, annulRate: 25, confirmRate: 75 });
  });

  // Forza/Moovin anuló la guía: hoy es un pedido anulado. Antes contaba como
  // despachado y confirmado Y como anulado, y la base no cuadraba.
  it("una guía anulada por la transportadora es anulada, no despachada ni confirmada", () => {
    const m = computeOpMetricsFromTrackableRows(
      [fila({ guide_number: "F1", forza_group: "cancelled" }), fila({ icomfly_estado: "Pendiente" })],
      new Map()
    );
    expect(m).toMatchObject({ generated: 2, dispatched: 0, confirmed: 0, annulled: 1, inProgress: 1 });
    expect(m.confirmed + m.annulled + m.inProgress).toBe(m.generated);
  });

  // El caso del 03/11: confirmar no es despachar. Un pedido Confirmada sin guía
  // (falta stock, almacén) ya está confirmado; uno en Pendiente o Modificar
  // dirección todavía no. Confirmación y despacho van sobre la misma base.
  it("confirmados ÷ generados: Confirmada y Enviada sin guía cuentan como confirmados, no como despachados", () => {
    const m = computeOpMetricsFromTrackableRows(
      [
        fila({ guide_number: "G1", internal_status: "delivered", icomfly_estado: "Entregado" }),
        fila({ guide_number: "G2", internal_status: "pending", icomfly_estado: "Guia_Generada" }),
        fila({ icomfly_estado: "Confirmada" }),
        fila({ icomfly_estado: "Enviada" }),
        fila({ icomfly_estado: "Pendiente" }),
        fila({ icomfly_estado: "Modificar Dirección" }),
        fila({ icomfly_estado: "Comprar Después" }),
        fila({ internal_status: "annulled", shopify_cancelled_at: "2026-11-01T16:00:00Z", icomfly_estado: "Cancelado" }),
      ],
      new Map()
    );
    expect(m).toMatchObject({
      generated: 8,
      confirmed: 4,
      dispatched: 2,
      confirmedNotDispatched: 2,
      sentWithoutGuide: 1,
      inProgress: 3,
      annulled: 1,
      confirmRate: 50,
      dispatchRate: 25,
      annulRate: 12.5,
    });
    // generados = confirmados + anulados + en gestión
    expect(m.confirmed + m.annulled + m.inProgress).toBe(m.generated);
  });

  it("Testeos y Producto Agotado de iComfly no cuentan; un anulado solo en iComfly sí es anulado", () => {
    const m = computeOpMetricsFromTrackableRows(
      [
        fila({ icomfly_estado: "Testeos" }),
        fila({ icomfly_estado: "Producto Agotado" }),
        // Pedido de Shopify que se anuló solo en iComfly: Kairo lo ve pendiente.
        fila({ icomfly_estado: "Cancelado", anulacion_motivo: "Cliente canceló", anulacion_excluida: false }),
        fila({ icomfly_estado: "Cancelado", anulacion_motivo: "lista negra", anulacion_excluida: true }),
        fila({ icomfly_estado: "Confirmada" }),
      ],
      new Map()
    );
    expect(m).toMatchObject({ generated: 2, annulledExcluded: 3, annulled: 1, confirmed: 1, inProgress: 0, confirmRate: 50 });
  });

  it("sin estado de iComfly (pedidos viejos de Shopify) confirmado = con guía", () => {
    const m = computeOpMetricsFromTrackableRows(
      [fila({ guide_number: "G1", internal_status: "delivered" }), fila({})],
      new Map()
    );
    expect(m).toMatchObject({ generated: 2, confirmed: 1, inProgress: 1, confirmRate: 50 });
  });
});

describe("motivoMarketing (Marketing, módulo 7)", () => {
  it.each([
    ["Duplicado", "duplicado"],
    ["Error en el pedido", "cambio_en_la_orden"],
    ["error en  el pedido", "cambio_en_la_orden"],
    ["Número errado", "numero_errado"],
    ["cliente tiene 2 devoluciones \n", "lista_negra"],
    ["Lista negra", "lista_negra"],
    ["Cliente canceló", "cliente_cancelo"],
    ["cliente ya no lo quiere \n", "cliente_cancelo"],
    ["Cliente no lo desea", "cliente_cancelo"],
    ["cliente compro en otro lado", "cliente_cancelo"],
    ["lo consiguio en  otro lado mas barato", "cliente_cancelo"],
    ["Cancelado desde Shopify: other", "otro"],
    [
      "Reemplazado por pedido con upsell MANUAL-1 (id 877314). Evitar doble despacho y cobro.",
      "upsell",
    ],
    [
      "Reemplazado por el pedido #233 (792965), aceptado en Boxful/ShipHero.",
      "upsell",
    ],
    ["Pedido de prueba de integracion Kairo. No despachar.", "prueba"],
    ["Prueba técnica autorizada de etiqueta Kairo", "prueba"],
    ["prueba", "prueba"],
    ["Producto agotado", "producto_agotado"],
    ["", "sin_motivo"],
    ["   ", "sin_motivo"],
    [null, "sin_motivo"],
    ["quiere 2x1 en 19900", "otro"],
  ] as const)("%j → %s", (motivo, code) => {
    expect(motivoMarketing(motivo)).toBe(code);
  });

  it("has a Spanish label for every code and knows which ones Gestión excludes", () => {
    for (const code of MOTIVOS_MARKETING)
      expect(MOTIVO_MARKETING_LABEL[code]).toBeTruthy();
    expect(MOTIVO_MARKETING_LABEL.cambio_en_la_orden).toBe("Error en el pedido");
    expect(esGrupoGestion("duplicado")).toBe(true);
    expect(esGrupoGestion("cliente_cancelo")).toBe(false);
    expect(esGrupoGestion("otro")).toBe(false);
  });
});
