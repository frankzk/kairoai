import { describe, expect, it } from "vitest";
import { auditRow, auditRows, daysSince, type AuditInput } from "../lib/dispatch-audit";

const AHORA = Date.parse("2026-08-17T12:00:00Z");

function fila(over: Partial<AuditInput> = {}): AuditInput {
  return {
    guide_number: "MLCR000000001SD",
    order_name: "#MCRC10000",
    customer_name: "Cliente",
    customer_phone: "+50688888888",
    amount: 19_900,
    courier_status: "en_route",
    courier_code: "LM-2",
    courier_event: "En manos del cartero",
    latest_at: "2026-08-17T00:00:00Z",
    crm_status: "En_Reparto",
    crm_synced_at: "2026-08-17T11:00:00Z",
    ...over,
  };
}

const hace = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString();

describe("daysSince", () => {
  it("cuenta dias completos y tolera fechas ausentes", () => {
    expect(daysSince(hace(6), AHORA)).toBe(6);
    expect(daysSince(null, AHORA)).toBe(0);
    expect(daysSince("no es fecha", AHORA)).toBe(0);
  });
});

describe("desfase courier vs CRM", () => {
  it("marca el paquete devuelto que el CRM muestra en circulacion", () => {
    // Caso real: #MCRC18213, PF-2 el 11/08 y en iComfly seguia como "Novedad".
    const f = auditRow(
      fila({ courier_status: "returned", courier_code: "PF-2", crm_status: "Novedad", latest_at: hace(6) }),
      AHORA
    );
    expect(f?.kind).toBe("desfase");
    expect(f?.severity).toBe("alta");
    expect(f?.action).toContain("devuelto");
  });

  it("marca el entregado que el CRM muestra en circulacion, con menos urgencia", () => {
    // Caso real: #MCRC17416, entregado el 04/08 y en iComfly como "Novedad".
    const f = auditRow(
      fila({ courier_status: "delivered", courier_code: "PF-1", crm_status: "Novedad" }),
      AHORA
    );
    expect(f?.kind).toBe("desfase");
    expect(f?.severity).toBe("media");
  });

  it("no reporta nada cuando ambos coinciden", () => {
    expect(
      auditRow(fila({ courier_status: "delivered", courier_code: "PF-1", crm_status: "Entregado" }), AHORA)
    ).toBeNull();
    expect(
      auditRow(fila({ courier_status: "returned", courier_code: "PF-2", crm_status: "Devolucion" }), AHORA)
    ).toBeNull();
  });

  it("a un paquete ya cerrado no se le mide tiempo detenido", () => {
    // Entregado hace 40 dias y el CRM de acuerdo: no es un estancado.
    expect(
      auditRow(
        fila({ courier_status: "delivered", courier_code: "PF-1", crm_status: "Entregado", latest_at: hace(40) }),
        AHORA
      )
    ).toBeNull();
  });
});

describe("paquetes estancados", () => {
  it("detecta el que nunca entro a la red del courier", () => {
    // Caso real: #MCRC17050, un solo evento OC-1 hace 21 dias.
    const f = auditRow(
      fila({ courier_status: "pending", courier_code: "OC-1", latest_at: hace(21), crm_status: "Novedad" }),
      AHORA
    );
    expect(f?.kind).toBe("estancado");
    expect(f?.severity).toBe("alta");
    expect(f?.action).toContain("bodega");
  });

  it("no alarma por una etiqueta recien impresa", () => {
    expect(
      auditRow(fila({ courier_status: "pending", courier_code: "OC-1", latest_at: hace(1) }), AHORA)
    ).toBeNull();
  });

  it("detecta el perdido en la ultima milla", () => {
    // Caso real: #MCRC14748, RC-0 hace 34 dias.
    const f = auditRow(
      fila({ courier_status: "en_route", courier_code: "RC-0", latest_at: hace(34) }),
      AHORA
    );
    expect(f?.kind).toBe("estancado");
    expect(f?.action).toContain("Reclamo");
  });

  it("no alarma por un traspaso normal al distribuidor", () => {
    // Del RC-0 a la entrega pasan ~4 dias en un envio sano.
    expect(
      auditRow(fila({ courier_status: "en_route", courier_code: "RC-0", latest_at: hace(4) }), AHORA)
    ).toBeNull();
  });

  it("detecta la incidencia que lleva demasiado sin resolver", () => {
    // Caso real: #MCRC16395, LM-7 hace 23 dias.
    const f = auditRow(
      fila({ courier_status: "incident", courier_code: "LM-7", latest_at: hace(23) }),
      AHORA
    );
    expect(f?.severity).toBe("alta");
    expect(f?.action).toContain("hoy");
  });

  it("deja tranquila una incidencia de hace dos dias", () => {
    // Todavia es gestionable por la via normal; no es trabajo de la auditoria.
    expect(
      auditRow(fila({ courier_status: "incident", courier_code: "LM-7", latest_at: hace(2) }), AHORA)
    ).toBeNull();
  });

  it("aplica el umbral generico a un transito sin movimiento", () => {
    expect(auditRow(fila({ courier_code: "LM-2", latest_at: hace(13) }), AHORA)).toBeNull();
    expect(auditRow(fila({ courier_code: "LM-2", latest_at: hace(15) }), AHORA)?.severity).toBe("media");
  });
});

describe("auditRows", () => {
  it("ordena por gravedad y suma la plata mal contada", () => {
    const { findings, summary } = auditRows(
      [
        fila({ courier_status: "delivered", courier_code: "PF-1", crm_status: "Novedad", amount: 10_000 }),
        fila({
          courier_status: "returned",
          courier_code: "PF-2",
          crm_status: "En_Reparto",
          amount: 25_000,
          latest_at: hace(30),
        }),
        fila({
          courier_status: "returned",
          courier_code: "PF-2",
          crm_status: "Novedad",
          amount: 15_000,
          latest_at: hace(5),
        }),
        fila({ courier_status: "en_route", courier_code: "LM-2", latest_at: hace(2) }), // sano
      ],
      AHORA
    );

    expect(findings).toHaveLength(3);
    expect(findings[0].severity).toBe("alta");
    // Dentro de la misma gravedad, primero lo mas viejo.
    expect(findings[0].days_stuck).toBe(30);
    expect(summary.desfase_devuelto).toBe(2);
    expect(summary.desfase_entregado).toBe(1);
    // Solo cuenta la plata de las devoluciones mal contadas, no la entregada.
    expect(summary.monto_devuelto_mal_contado).toBe(40_000);
    expect(summary.total).toBe(3);
  });
});
