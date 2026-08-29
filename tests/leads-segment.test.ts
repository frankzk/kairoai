import { describe, expect, it } from "vitest";
import {
  classifyLead,
  isInCallQueue,
  leadSegment,
  leadWorkState,
  segmentCounts,
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

describe("segmentCounts (los chips de intención)", () => {
  const clasificar = (rows: SegmentInput[]) =>
    rows.map((r) => ({ ...r, ...classifyLead(r) }));

  const cola = clasificar([
    lead({ shopify_cart_open: true }),
    lead({ shopify_cart_open: true }),
    lead({ inbound_count: 12 }),
    lead({ inbound_count: 3 }),
    lead(),
    lead(),
    lead({ status: "contactado_dejo_wsp", status_source: "manual", shopify_cart_open: true }),
    lead({ status: "no_responde", status_source: "manual" }),
  ]);

  it("los chips suman exactamente lo que se les paso", () => {
    // La invariante: el numero del chip tiene que coincidir con lo que uno
    // recibe al hacer clic. Se cumple porque el que llama pasa los leads del
    // tab activo, no toda la cola.
    const counts = segmentCounts(cola);
    const suma = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(suma).toBe(cola.length);
  });

  it("contar un subconjunto da el total de ESE subconjunto", () => {
    // El bug que tenia: parado en "Hoy" (619 leads) los chips contaban toda la
    // cola (2.580 = Hoy + Seguimiento), asi que "Carrito 196" filtraba a los
    // carritos de Hoy, muchos menos que 196.
    const soloGestionados = cola.filter((l) => l.work_state === "seguimiento");
    const counts = segmentCounts(soloGestionados);
    const suma = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(suma).toBe(soloGestionados.length);
    expect(suma).toBe(2);
    expect(counts.carrito).toBe(1);
  });

  it("reparte cada lead en un solo segmento", () => {
    const counts = segmentCounts(cola);
    expect(counts).toEqual({ carrito: 3, enganchado: 1, converso: 1, solo_saludo: 3 });
  });

  it("una lista vacia da todo en cero, no undefined", () => {
    expect(segmentCounts([])).toEqual({
      carrito: 0,
      enganchado: 0,
      converso: 0,
      solo_saludo: 0,
    });
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
    expect(segmentCounts(clasificar([conCarritoYGestion])).carrito).toBe(1);
  });
});
