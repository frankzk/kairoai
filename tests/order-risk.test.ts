// Umbrales de las alertas previas al despacho. Los numeros salen de medir la
// base (ver el encabezado de lib/order-risk.ts), asi que las pruebas fijan
// tanto que la alerta salte como que NO salte antes de tiempo.

import { describe, expect, it } from "vitest";
import {
  orderAlerts,
  orderRiskLevel,
  daysSinceOrder,
  riskInputFromHistory,
  type OrderRiskInput,
} from "../lib/order-risk";

const AHORA = Date.parse("2026-08-23T12:00:00Z");
const hace = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString();

function pedido(over: Partial<OrderRiskInput> = {}): OrderRiskInput {
  return {
    created_at: hace(1),
    dispatched: false,
    phone: "+50688887777",
    previous_returned: 0,
    previous_delivered: 0,
    in_transit: 0,
    duplicate_within_72h: false,
    ...over,
  };
}

const ids = (input: OrderRiskInput) => orderAlerts(input, AHORA).map((a) => a.id);

describe("daysSinceOrder", () => {
  it("cuenta dias completos y tolera fechas ausentes", () => {
    expect(daysSinceOrder(hace(6), AHORA)).toBe(6);
    expect(daysSinceOrder(null, AHORA)).toBe(0);
    expect(daysSinceOrder("no es fecha", AHORA)).toBe(0);
  });
});

describe("pedido frio", () => {
  it("no molesta con un pedido de ayer", () => {
    expect(ids(pedido({ created_at: hace(1) }))).not.toContain("pedido_frio");
  });

  it("avisa a partir del quinto dia", () => {
    expect(ids(pedido({ created_at: hace(4) }))).not.toContain("pedido_frio");
    expect(ids(pedido({ created_at: hace(5) }))).toContain("pedido_frio");
  });

  it("cambia el mensaje pasados los 8 dias, donde la entrega cae al 39%", () => {
    const normal = orderAlerts(pedido({ created_at: hace(6) }), AHORA)[0];
    const grave = orderAlerts(pedido({ created_at: hace(9) }), AHORA)[0];
    expect(normal.action).toContain("Despachar hoy");
    expect(grave.action).toContain("anular");
  });

  it("no aplica a un pedido que ya salio", () => {
    // Ya tiene guia: esperar no lo enfria mas, el paquete esta en la calle.
    expect(ids(pedido({ created_at: hace(20), dispatched: true }))).not.toContain("pedido_frio");
  });
});

describe("historial del cliente", () => {
  it("marca al que ya devolvio", () => {
    const alerta = orderAlerts(pedido({ previous_returned: 1 }), AHORA)[0];
    expect(alerta.id).toBe("devolucion_previa");
    expect(alerta.level).toBe("alta");
    expect(alerta.detail).toContain("53%");
  });

  it("endurece el mensaje con dos devoluciones", () => {
    const alerta = orderAlerts(pedido({ previous_returned: 2 }), AHORA)[0];
    expect(alerta.detail).toContain("25%");
  });

  it("da la verde al recurrente sin devoluciones", () => {
    const alertas = orderAlerts(pedido({ previous_delivered: 3 }), AHORA);
    expect(alertas).toHaveLength(1);
    expect(alertas[0].id).toBe("cliente_confiable");
    expect(alertas[0].level).toBe("favor");
  });

  it("un recurrente que ademas devolvio NO es confiable", () => {
    const salida = ids(pedido({ previous_delivered: 3, previous_returned: 1 }));
    expect(salida).toContain("devolucion_previa");
    expect(salida).not.toContain("cliente_confiable");
  });
});

describe("otras alertas", () => {
  it("avisa del paquete que ya esta en la calle", () => {
    expect(ids(pedido({ in_transit: 1 }))).toContain("paquete_en_calle");
  });

  it("avisa del posible duplicado", () => {
    expect(ids(pedido({ duplicate_within_72h: true }))).toContain("posible_duplicado");
  });

  it("avisa cuando no hay telefono", () => {
    expect(ids(pedido({ phone: "" }))).toContain("sin_telefono");
    expect(ids(pedido({ phone: "   " }))).toContain("sin_telefono");
  });
});

describe("orden y semaforo", () => {
  it("pone lo grave primero y la verde al final", () => {
    const alertas = orderAlerts(
      pedido({ created_at: hace(10), in_transit: 1, previous_returned: 1 }),
      AHORA
    );
    expect(alertas[0].level).toBe("alta");
    expect(alertas[alertas.length - 1].level).toBe("media");
    expect(alertas.map((a) => a.level)).toEqual(["alta", "alta", "media"]);
  });

  it("el semaforo toma la alerta mas grave", () => {
    expect(orderRiskLevel(orderAlerts(pedido(), AHORA))).toBe("ok");
    expect(orderRiskLevel(orderAlerts(pedido({ previous_delivered: 1 }), AHORA))).toBe("favor");
    expect(orderRiskLevel(orderAlerts(pedido({ in_transit: 1 }), AHORA))).toBe("media");
    expect(orderRiskLevel(orderAlerts(pedido({ previous_returned: 1 }), AHORA))).toBe("alta");
  });

  it("un pedido sano de ayer no genera ruido", () => {
    expect(orderAlerts(pedido(), AHORA)).toEqual([]);
  });
});

describe("riskInputFromHistory", () => {
  const historia = [
    { name: "#MCRC100", created_at: hace(40), state: "delivered" },
    { name: "#MCRC200", created_at: hace(20), state: "returned" },
    { name: "#MCRC300", created_at: hace(2), state: "in_transit" },
    { name: "#MCRC400", created_at: hace(1), state: "cancelled" },
  ];

  it("cuenta el historial dejando fuera el pedido que se esta mirando", () => {
    const input = riskInputFromHistory({
      orderName: "#MCRC300",
      createdAt: hace(2),
      dispatched: true,
      phone: "+50688887777",
      history: historia,
    });
    expect(input.previous_delivered).toBe(1);
    expect(input.previous_returned).toBe(1);
    // El propio pedido en transito NO se cuenta como "otro paquete en la calle".
    expect(input.in_transit).toBe(0);
  });

  it("no se confunde por mayusculas o espacios en el numero de pedido", () => {
    const input = riskInputFromHistory({
      orderName: " #mcrc300 ",
      createdAt: hace(2),
      dispatched: true,
      phone: "+50688887777",
      history: historia,
    });
    expect(input.in_transit).toBe(0);
  });

  it("detecta el duplicado dentro de las 72 horas", () => {
    const cerca = riskInputFromHistory({
      orderName: "#MCRC500",
      createdAt: hace(1),
      dispatched: false,
      phone: "+50688887777",
      history: historia,
    });
    expect(cerca.duplicate_within_72h).toBe(true);

    const lejos = riskInputFromHistory({
      orderName: "#MCRC500",
      createdAt: hace(10),
      dispatched: false,
      phone: "+50688887777",
      history: historia,
    });
    expect(lejos.duplicate_within_72h).toBe(false);
  });

  it("sin historial no inventa alertas", () => {
    const input = riskInputFromHistory({
      orderName: "#MCRC900",
      createdAt: hace(1),
      dispatched: false,
      phone: "+50688887777",
      history: [],
    });
    expect(orderAlerts(input, AHORA)).toEqual([]);
  });
});
