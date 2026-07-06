import { describe, expect, it } from "vitest";
import { classifyMoovinGroup as classifyMoovinReal, computeIncident, effectiveLatestMoovin, type MoovinEvent } from "../lib/moovin";

// Replica del parser de app/api/finance/moovin-tracking/route.ts para fijar el
// comportamiento sobre la estructura RSC real de Moovin (linea "1:{...}").
type MoovinGroup = "delivered" | "failed" | "returned" | "in_progress";
const MOOVIN_STATUS_GROUP: Record<string, MoovinGroup> = {
  DELIVERED: "delivered",
  FAILED: "failed",
  RETURNED: "returned",
  CANCELED: "returned",
  CANCELLED: "returned",
  CANCEL: "returned",
};

function classifyMoovinGroup(code: string, title: string): MoovinGroup {
  const mapped = MOOVIN_STATUS_GROUP[code];
  if (mapped) return mapped;
  if (title.toLowerCase().includes("cancelado")) return "returned";
  return "in_progress";
}

function findTrackingPayload(raw: string): any | null {
  for (const line of raw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const jsonPart = line.slice(colon + 1).trim();
    if (!jsonPart.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(jsonPart);
      if (parsed && Array.isArray(parsed.listStatus)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function parseMoovinResponse(raw: string) {
  const payload = findTrackingPayload(raw);
  if (!payload || !Array.isArray(payload.listStatus)) return null;
  const events = payload.listStatus
    .map((status: any) => {
      const code = String(status.status ?? "").toUpperCase();
      const note = (status.comments ?? [])
        .map((c: any) => [c.reason, c.value].filter(Boolean).join(": "))
        .filter(Boolean)
        .join(" | ");
      return {
        code,
        group: classifyMoovinGroup(code, String(status.title ?? "")),
        title: String(status.title ?? ""),
        date: status.date ?? null,
        note,
      };
    })
    .sort((a: any, b: any) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const delivery = (payload.coorList ?? []).find((p: any) =>
    String(p.name ?? "").toLowerCase().includes("entrega")
  );
  return {
    tracking_number: String(payload.serialNumber ?? ""),
    delivery_address: String(delivery?.address ?? ""),
    events,
  };
}

const RAW =
  '0:{"a":"$@1","f":"","b":"wsfyk"}\n' +
  '1:{"idPackage":2525294,"nameProfile":"BOXFUL TECHNOLOGIES personal","serialNumber":"8e2d4834875745c1","listStatus":[' +
  '{"idStatus":43870459,"date":"2026-06-08T16:37:44Z","status":"PREPARE","comments":[],"title":"Por preparar","description":"x"},' +
  '{"idStatus":43912814,"date":"2026-06-09T15:43:30Z","status":"FAILED","comments":[{"value":"San Jose, de lunes a viernes","reason":"Direccion incompleta o incorrecta"}],"title":"Incidencia en la entrega","description":"y"},' +
  '{"idStatus":44017797,"date":"2026-06-11T21:15:54Z","status":"COORDINATE","comments":[],"title":"Coordinado","description":"z"},' +
  '{"idStatus":44017855,"date":"2026-06-11T21:18:16Z","status":"DELIVERED","comments":[],"title":"Entregado por el Moover","description":"El paquete ha sido entregado en la direccion de destino."}' +
  '],"coorList":[{"address":"Los bajos de la claudia","name":"Punto de entrega"},{"address":"Bodega G4","name":"Punto de recoleccion"}],"invoice":"NOT_INVOICE"}\n';

describe("parseMoovinResponse", () => {
  it("extrae el estado mas reciente del listStatus", () => {
    const detail = parseMoovinResponse(RAW)!;
    expect(detail.events[0].title).toBe("Entregado por el Moover");
    expect(detail.events[0].code).toBe("DELIVERED");
    expect(detail.events[0].group).toBe("delivered");
    expect(detail.events[0].date).toBe("2026-06-11T21:18:16Z");
  });

  it("ordena por fecha descendente sin importar el orden de entrada", () => {
    const detail = parseMoovinResponse(RAW)!;
    expect(detail.events.map((e: any) => e.code)).toEqual([
      "DELIVERED",
      "COORDINATE",
      "FAILED",
      "PREPARE",
    ]);
  });

  it("rescata el motivo de la incidencia desde comments", () => {
    const detail = parseMoovinResponse(RAW)!;
    const failed = detail.events.find((e: any) => e.code === "FAILED")!;
    expect(failed.group).toBe("failed");
    expect(failed.note).toContain("Direccion incompleta o incorrecta");
  });

  it("toma la direccion del punto de entrega", () => {
    const detail = parseMoovinResponse(RAW)!;
    expect(detail.tracking_number).toBe("8e2d4834875745c1");
    expect(detail.delivery_address).toBe("Los bajos de la claudia");
  });

  it("devuelve null si no hay listStatus", () => {
    expect(parseMoovinResponse('0:{"a":"x"}\n')).toBeNull();
  });
});

describe("clasificacion de cancelaciones", () => {
  it("Cancelado (codigo CANCELED) cuenta como no entregado (returned), no en ruta", () => {
    const raw =
      '1:{"serialNumber":"abc","listStatus":[' +
      '{"date":"2026-06-13T08:56:00Z","status":"INROUTE","title":"En ruta para entregar a lo largo del dia"},' +
      '{"date":"2026-06-13T09:45:00Z","status":"CANCELED","title":"Cancelado"}' +
      ']}\n';
    const detail = parseMoovinResponse(raw)!;
    expect(detail.events[0].title).toBe("Cancelado");
    expect(detail.events[0].group).toBe("returned");
  });

  it("rescata la cancelacion por titulo aunque el codigo sea desconocido", () => {
    const raw =
      '1:{"serialNumber":"x","listStatus":[{"date":"2026-06-13T09:45:00Z","status":"WEIRD","title":"Cancelado"}]}\n';
    const detail = parseMoovinResponse(raw)!;
    expect(detail.events[0].group).toBe("returned");
  });
});

// La entrega es terminal: si una guia tiene un evento "delivered", ese estado
// prevalece sobre eventos posteriores (Moovin re-emite Preccoordinacion/Recolectado
// con fecha mas nueva bajo la misma guia). No hay reversion de una entrega.
describe("entrega es terminal (delivered prevails)", () => {
  // events ordenados desc por fecha (como salen de parseMoovinResponse): el mas
  // nuevo (Preccoordinacion 01/06) viene primero, pero la entrega fue el 30/05.
  const entregaRevertida: MoovinEvent[] = [
    { code: "PRECOORDINATION", group: "in_progress", title: "Preccoordinacion enviada", description: "", date: "2026-06-01T08:48:00Z", note: "" },
    { code: "DELIVERED", group: "delivered", title: "Entregado por el Moover", description: "Entregado en destino", date: "2026-05-30T15:10:00Z", note: "" },
    { code: "COORDINATE", group: "in_progress", title: "Coordinado", description: "", date: "2026-05-30T15:08:00Z", note: "" },
  ];

  it("prevalece Entregado aunque haya un evento posterior con fecha mas nueva", () => {
    const latest = effectiveLatestMoovin(entregaRevertida)!;
    expect(latest.group).toBe("delivered");
    expect(latest.title).toBe("Entregado por el Moover");
    expect(latest.date).toBe("2026-05-30T15:10:00Z");
  });

  it("una guia entregada no tiene incidencia activa", () => {
    expect(computeIncident(entregaRevertida).active).toBe(false);
  });

  it("sin entrega, toma el evento mas reciente (events[0]) y respeta la incidencia", () => {
    const sinEntrega: MoovinEvent[] = [
      { code: "FAILED", group: "failed", title: "Incidencia en la entrega", description: "", date: "2026-06-02T10:00:00Z", note: "Direccion incorrecta" },
      { code: "INROUTE", group: "in_progress", title: "En ruta", description: "", date: "2026-06-01T09:00:00Z", note: "" },
    ];
    expect(effectiveLatestMoovin(sinEntrega)!.code).toBe("FAILED");
    expect(computeIncident(sinEntrega).active).toBe(true);
  });

  it("lista vacia -> null y sin incidencia", () => {
    expect(effectiveLatestMoovin([])).toBeNull();
    expect(computeIncident([]).active).toBe(false);
  });
});

// Moovin usa titulos/codigos distintos para la entrega ("Entrega completa" con un
// codigo no mapeado). Sin rescate por texto quedaba in_progress y la novedad
// nunca se resolvia (guia entregada pero incidencia atascada en "Reprogramada").
describe("classifyMoovinGroup - entregas con titulo/codigo no estandar", () => {
  it("'Entrega completa' con codigo no mapeado se clasifica delivered", () => {
    expect(
      classifyMoovinReal("COMPLETED", "Entrega completa", "El paquete ha sido entregado en la direccion de destino.")
    ).toBe("delivered");
  });

  it("'Entregado por el Moover' (codigo DELIVERED) sigue delivered", () => {
    expect(classifyMoovinReal("DELIVERED", "Entregado por el Moover", "")).toBe("delivered");
  });

  it("un evento en ruta ('...para ser entregado') NO es delivered", () => {
    expect(
      classifyMoovinReal("INROUTE", "En ruta para entregar a lo largo del dia", "El envio esta en poder de un Moover para ser entregado.")
    ).toBe("in_progress");
  });

  it("'No entregado' no se confunde con una entrega", () => {
    expect(classifyMoovinReal("WEIRD", "No entregado", "")).not.toBe("delivered");
  });
});
