// Cuando se puede reprogramar una novedad.
//
// EL PEDIDO (08/10/2026): hay pedidos que, aunque el cliente no conteste, se
// mandan igual al segundo intento de entrega, porque ese intento ya esta pagado:
// intentarlo cuesta lo mismo que no intentarlo. El sistema no lo dejaba: pedia
// "Contestó" o 3 "No contestó" en dias distintos (y entonces solo viernes o
// sabado). Ese dia habia 30 novedades de Moovin abiertas con UN solo intento
// fallido.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { reglaReprogramar } from "../lib/incidents-reprog";

// Jueves 08/10/2026, 10:00 hora local.
const AHORA = new Date(2026, 9, 8, 10, 0, 0);

function llamada(resultado: "contesto" | "no_contesto", dia: string) {
  return { kind: "llamada" as const, metadata: { resultado }, created_at: `${dia}T15:00:00.000Z` };
}

describe("reglaReprogramar", () => {
  it("sin llamadas y sin intentos del courier: todavia no", () => {
    expect(reglaReprogramar([], 0, AHORA).modo).toBeNull();
  });

  it("EL CASO NUEVO: un solo intento fallido habilita el segundo aunque nadie conteste", () => {
    const r = reglaReprogramar([llamada("no_contesto", "2026-10-08")], 1, AHORA);
    expect(r).toEqual({ modo: "segundo_intento", min: "2026-10-09", max: null });
  });

  it("tambien sin haber llamado nunca", () => {
    expect(reglaReprogramar([], 1, AHORA).modo).toBe("segundo_intento");
  });

  it("con dos o mas intentos fallidos ya no: el courier no reintenta", () => {
    expect(reglaReprogramar([], 2, AHORA).modo).toBeNull();
    expect(reglaReprogramar([llamada("no_contesto", "2026-10-08")], 3, AHORA).modo).toBeNull();
  });

  it("si el cliente contesto, cualquier fecha desde hoy (como antes)", () => {
    const r = reglaReprogramar([llamada("no_contesto", "2026-10-07"), llamada("contesto", "2026-10-08")], 2, AHORA);
    expect(r).toEqual({ modo: "contesto", min: "2026-10-08", max: null });
  });

  it("manda la ULTIMA llamada: un Contestó viejo no habilita si despues no contesto", () => {
    const r = reglaReprogramar([llamada("contesto", "2026-10-06"), llamada("no_contesto", "2026-10-08")], 2, AHORA);
    expect(r.modo).toBeNull();
  });

  it("3 No contestó en dias distintos sigue llevando al proximo viernes o sabado (como antes)", () => {
    const r = reglaReprogramar(
      [llamada("no_contesto", "2026-10-06"), llamada("no_contesto", "2026-10-07"), llamada("no_contesto", "2026-10-08")],
      2,
      AHORA
    );
    expect(r).toEqual({ modo: "finde", min: "2026-10-09", max: "2026-10-10" });
  });

  it("3 No contestó el MISMO dia no cuenta como tres", () => {
    const r = reglaReprogramar(
      [llamada("no_contesto", "2026-10-08"), llamada("no_contesto", "2026-10-08"), llamada("no_contesto", "2026-10-08")],
      2,
      AHORA
    );
    expect(r.modo).toBeNull();
  });

  it("con el intento pagado disponible no se espera a los 3 dias ni se limita al finde", () => {
    const r = reglaReprogramar(
      [llamada("no_contesto", "2026-10-06"), llamada("no_contesto", "2026-10-07"), llamada("no_contesto", "2026-10-08")],
      1,
      AHORA
    );
    expect(r.modo).toBe("segundo_intento");
    expect(r.max).toBeNull();
  });
});

// ── El historial deja la marca "sin contacto" ────────────────────────────────

const patchIncident = vi.fn();
vi.mock("@/lib/incidents", () => ({
  getIncident: async () => ({ id: 7, store_id: 1, status: "pendiente", shopify_order_id: "" }),
  patchIncident: (...a: unknown[]) => patchIncident(...a),
  recordIncidentEvent: vi.fn(),
}));
vi.mock("@/lib/shopify", () => ({ addOrderTag: vi.fn(), cancelOrder: vi.fn() }));

async function reprogramar(extra: Record<string, unknown>) {
  const { POST } = await import("../app/api/incidents/actions/route");
  return POST(
    new NextRequest("http://localhost/api/incidents/actions?store=mireva-cr", {
      method: "POST",
      body: JSON.stringify({ id: 7, action: "reprogramar", fecha: "2026-10-09", ...extra }),
    })
  );
}

describe("accion reprogramar", () => {
  beforeEach(() => {
    patchIncident.mockReset();
    patchIncident.mockResolvedValue({ id: 7 });
  });

  it("el segundo intento queda marcado sin contacto en el historial", async () => {
    const res = await reprogramar({ modo: "segundo_intento" });
    expect(res.status).toBe(200);
    const [, patch, evento] = patchIncident.mock.calls[0];
    expect(patch).toMatchObject({ status: "reprogramada", reprogramada_para: "2026-10-09" });
    expect(evento.message).toBe("Reprogramada para 2026-10-09 · segundo intento sin contacto");
    expect(evento.metadata).toMatchObject({ sin_contacto: true, modo: "segundo_intento" });
  });

  it("una reprogramacion con contacto queda como siempre", async () => {
    await reprogramar({ modo: "contesto" });
    const [, , evento] = patchIncident.mock.calls[0];
    expect(evento.message).toBe("Reprogramada para 2026-10-09");
    expect(evento.metadata.sin_contacto).toBeUndefined();
  });
});
