// Las notas de una novedad respetan la tienda, como el resto de la API.
//
// El hueco: el middleware solo verifica que la persona tenga acceso a la tienda
// del ?store=, y este endpoint ignoraba la tienda. Alguien con acceso solo a
// Honduras podia escribir o editar notas de una novedad de Costa Rica
// conociendo su numero.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const NOVEDAD_CR = { id: 10, store_id: 1 };
const NOTA_CR = { id: 500, incident_id: 10, kind: "nota" };
const DETECCION_CR = { id: 501, incident_id: 10, kind: "detectada" };

const db = vi.hoisted(() => ({
  getIncident: vi.fn(),
  getIncidentEvent: vi.fn(),
  recordIncidentEvent: vi.fn(),
  updateIncidentNote: vi.fn(),
}));

vi.mock("@/lib/incidents", () => db);

import { PATCH, POST } from "@/app/api/incidents/events/route";

function pedir(method: "POST" | "PATCH", store: string | null, body: unknown) {
  const url = `http://kairo.test/api/incidents/events${store ? `?store=${store}` : ""}`;
  return new NextRequest(url, { method, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Como getIncident real: filtra por la tienda pedida.
  db.getIncident.mockImplementation(async (id: number, storeId?: number) =>
    id === NOVEDAD_CR.id && storeId === NOVEDAD_CR.store_id ? NOVEDAD_CR : null
  );
  db.getIncidentEvent.mockImplementation(async (id: number) =>
    [NOTA_CR, DETECCION_CR].find((e) => e.id === id) ?? null
  );
});

describe("POST /api/incidents/events (nota nueva)", () => {
  it("con acceso a Honduras no se puede escribir en una novedad de Costa Rica", async () => {
    const res = await POST(pedir("POST", "mireva-hn", { incident_id: 10, message: "intruso" }));
    expect(res.status).toBe(404);
    expect(db.recordIncidentEvent).not.toHaveBeenCalled();
  });

  it("sin tienda no se acepta", async () => {
    const res = await POST(pedir("POST", null, { incident_id: 10, message: "hola" }));
    expect(res.status).toBe(400);
    expect(db.recordIncidentEvent).not.toHaveBeenCalled();
  });

  it("en la novedad de su tienda la nota se guarda", async () => {
    const res = await POST(pedir("POST", "mireva-cr", { incident_id: 10, message: "Cliente pide el viernes" }));
    expect(res.status).toBe(201);
    expect(db.recordIncidentEvent).toHaveBeenCalledWith(10, expect.objectContaining({ kind: "nota", message: "Cliente pide el viernes" }));
  });
});

describe("PATCH /api/incidents/events (editar nota)", () => {
  it("con acceso a Honduras no se puede editar una nota de Costa Rica", async () => {
    const res = await PATCH(pedir("PATCH", "mireva-hn", { event_id: 500, message: "editada" }));
    expect(res.status).toBe(404);
    expect(db.updateIncidentNote).not.toHaveBeenCalled();
  });

  it("solo se editan notas: el resto del historial es inmutable", async () => {
    const res = await PATCH(pedir("PATCH", "mireva-cr", { event_id: 501, message: "editada" }));
    expect(res.status).toBe(404);
    expect(db.updateIncidentNote).not.toHaveBeenCalled();
  });

  it("sin tienda no se acepta", async () => {
    const res = await PATCH(pedir("PATCH", null, { event_id: 500, message: "editada" }));
    expect(res.status).toBe(400);
  });

  it("una nota de su tienda se edita", async () => {
    const res = await PATCH(pedir("PATCH", "mireva-cr", { event_id: 500, message: "Corregida" }));
    expect(res.status).toBe(200);
    expect(db.updateIncidentNote).toHaveBeenCalledWith(500, "Corregida");
  });
});
