import { describe, expect, it } from "vitest";

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
