import { describe, expect, it } from "vitest";
import {
  boardFacets,
  classifyLead,
  isInCallQueue,
  leadSegment,
  leadWorkState,
  type SegmentInput,
} from "../lib/leads-segment";

function lead(partial: Partial<SegmentInput> = {}): SegmentInput & { needs_attention?: boolean } {
  return {
    status: "conversando",
    status_source: "auto",
    category: "open",
    cart_item_count: 0,
    shopify_cart_open: false,
    shopify_draft_cart_count: 0,
    has_cart_signal: false,
    inbound_count: 0,
    ...partial,
  };
}

describe("leadWorkState (eje 1: quien lo trabajo)", () => {
  it("los estados que escribe el bot son 'sin llamar', no solo 'nuevo'", () => {
    // En kairoai el bot escribe frio/conversando/carrito_abandonado/por_cerrar.
    // Ninguno de esos fue llamado, asi que el truco de "status !== nuevo" del
    // CRM original daria un falso "ya gestionado" para miles de leads.
    for (const status of ["nuevo", "frio", "conversando", "carrito_abandonado", "por_cerrar"]) {
      expect(leadWorkState(lead({ status, status_source: "auto" }))).toBe("sin_llamar");
    }
  });

  it("un estado puesto por la asesora es 'en seguimiento'", () => {
    expect(
      leadWorkState(lead({ status: "contactado_dejo_wsp", status_source: "manual" }))
    ).toBe("seguimiento");
  });
});

describe("leadSegment (eje 2: cuanta intencion)", () => {
  it("carrito gana sobre todo lo demas", () => {
    expect(leadSegment(lead({ cart_item_count: 2, inbound_count: 40 }))).toBe("carrito");
  });

  it("reconoce el carrito por cualquiera de sus señales", () => {
    expect(leadSegment(lead({ cart_item_count: 1 }))).toBe("carrito");
    expect(leadSegment(lead({ shopify_cart_open: true }))).toBe("carrito");
    expect(leadSegment(lead({ shopify_draft_cart_count: 3 }))).toBe("carrito");
    expect(leadSegment(lead({ has_cart_signal: true }))).toBe("carrito");
  });

  // El corte de 10 sale de la medicion: 4-9 mensajes llegan lejos en el 7,5%
  // de los casos y 10+ en el 38,8%. Es el unico corte que separa de verdad.
  it("enganchado son 10 mensajes o mas del cliente", () => {
    expect(leadSegment(lead({ inbound_count: 10 }))).toBe("enganchado");
    expect(leadSegment(lead({ inbound_count: 9 }))).toBe("converso");
  });

  it("converso son 2 a 9 mensajes; con uno o ninguno, solo saludó", () => {
    expect(leadSegment(lead({ inbound_count: 2 }))).toBe("converso");
    expect(leadSegment(lead({ inbound_count: 1 }))).toBe("solo_saludo");
  });

  it("solo saludó es el caso por defecto", () => {
    expect(leadSegment(lead())).toBe("solo_saludo");
  });
});

describe("isInCallQueue", () => {
  it("deja fuera los pagos por verificar aunque sean hot: es otro trabajo", () => {
    expect(isInCallQueue(lead({ status: "sinpe_por_verificar", category: "hot" }))).toBe(false);
  });

  it("deja fuera ganados y descartados", () => {
    expect(isInCallQueue(lead({ status: "pedido_generado", category: "won" }))).toBe(false);
    expect(isInCallQueue(lead({ status: "duplicado", category: "lost" }))).toBe(false);
  });

  it("incluye los hot accionables y los abiertos", () => {
    expect(isInCallQueue(lead({ status: "por_cerrar", category: "hot" }))).toBe(true);
    expect(isInCallQueue(lead({ status: "frio", category: "open" }))).toBe(true);
  });
});

describe("boardFacets (los contadores)", () => {
  // Los facets leen los ejes ya resueltos, tal como llegan de la API.
  const clasificar = (rows: SegmentInput[]) => rows.map((r) => classifyLead(r));

  const universo = clasificar([
    // sin llamar
    lead({ shopify_cart_open: true }),
    lead({ shopify_cart_open: true }),
    lead({ inbound_count: 12 }),
    lead({ inbound_count: 3 }),
    lead(),
    lead(),
    // en seguimiento (la asesora ya los toco)
    lead({ status: "contactado_dejo_wsp", status_source: "manual", shopify_cart_open: true }),
    lead({ status: "no_responde", status_source: "manual" }),
    // fuera de la cola
    lead({ status: "pedido_generado", category: "won" }),
    lead({ status: "sinpe_por_verificar", category: "hot" }),
  ]);

  it("los segmentos suman exactamente el total del tab activo", () => {
    // Es la comprobacion que delata un scope mal puesto.
    for (const estado of ["sin_llamar", "seguimiento"] as const) {
      const f = boardFacets(universo, estado);
      const suma = Object.values(f.bySegment).reduce((a, b) => a + b, 0);
      expect(suma).toBe(f.byWorkState[estado]);
    }
  });

  it("los contadores del eje 1 NO se encogen al elegir un segmento", () => {
    const sinFiltro = boardFacets(universo, null);
    const conFiltro = boardFacets(universo, "sin_llamar");
    expect(conFiltro.byWorkState).toEqual(sinFiltro.byWorkState);
  });

  it("cuenta la cola sin los ganados ni los pagos por verificar", () => {
    const f = boardFacets(universo, null);
    expect(f.total).toBe(8);
    expect(f.byWorkState).toEqual({ sin_llamar: 6, seguimiento: 2 });
  });

  it("un lead con carrito Y ya contactado cuenta en los dos ejes a la vez", () => {
    // El caso que rompia el tablero viejo: tenia que elegir entre Carrito y
    // Seguimiento, y se quedaba en Carrito viendose sin trabajar.
    const conCarritoYGestion = lead({
      status: "contactado_dejo_wsp",
      status_source: "manual",
      shopify_cart_open: true,
    });
    expect(leadWorkState(conCarritoYGestion)).toBe("seguimiento");
    expect(leadSegment(conCarritoYGestion)).toBe("carrito");

    const f = boardFacets([classifyLead(conCarritoYGestion)], "seguimiento");
    expect(f.bySegment.carrito).toBe(1);
    expect(f.byWorkState.seguimiento).toBe(1);
  });
});
