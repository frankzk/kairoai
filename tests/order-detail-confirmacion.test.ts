// Registrar un intento en la ficha del pedido: canal, fecha pactada y
// recordatorio (cola de confirmacion, lib/confirmacion.ts).
//
// POR QUE ESTE TEST EXISTE: la cola se arma SOLO con lo que se guarda aca. Un
// "Volver a contactar" sin fecha no puede caer en ningun plazo, un recordatorio
// mal calculado esconde el pedido, y una asesora no puede registrar a nombre de
// otra.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const creados: Array<Record<string, unknown>> = [];
let yo: { staffId: number | null; permisos: string[]; nombre: string } | null = null;

vi.mock("@/lib/order-events-db", () => ({
  createOrderEvent: async (input: Record<string, unknown>) => {
    creados.push(input);
    return { id: 1, ...input };
  },
  listOrderEvents: async () => [],
  leerConfigConfirmacion: async () => ({ activacion: "2026-09-15", cicloDias: 3, tz: "America/Costa_Rica" }),
}));
vi.mock("@/lib/identidad", () => ({
  identidadActual: () => (yo ? { id: 9, ...yo, tiendas: ["mireva-cr"] } : null),
  vendedoraEfectiva: (pedida: unknown) => {
    if (yo?.staffId && !yo.permisos.includes("leads_equipo")) return yo.staffId;
    const n = Number(pedida);
    return Number.isFinite(n) && n > 0 ? n : null;
  },
  tiendasPermitidas: () => null,
}));

async function registrar(body: Record<string, unknown>) {
  const { POST } = await import("../app/api/finance/order-detail/route");
  return POST(
    new NextRequest("http://localhost/api/finance/order-detail?store=mireva-cr", {
      method: "POST",
      body: JSON.stringify({ order_name: "#MCRC25946", kind: "contacto", staff_id: 3, staff_name: "Susan", ...body }),
    })
  );
}

beforeEach(() => {
  creados.length = 0;
  yo = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T16:00:00Z")); // 10:00 en Costa Rica
});

describe("registrar un intento", () => {
  it("No contestó deja el recordatorio a 2 horas hábiles y el canal elegido", async () => {
    const res = await registrar({ outcome: "no_contesta", canal: "whatsapp" });
    expect(res.status).toBe(200);
    expect(creados[0]).toMatchObject({ canal: "whatsapp", recordatorioAt: "2026-10-15T18:00:00.000Z", fechaPactada: null });
  });

  it("sin canal, un contacto es una llamada", async () => {
    await registrar({ outcome: "contesto" });
    expect(creados[0]).toMatchObject({ canal: "llamada", recordatorioAt: null });
  });

  it("Volver a contactar y Pendiente de abono exigen la fecha pactada, no anterior a hoy", async () => {
    expect((await registrar({ outcome: "reagendar" })).status).toBe(400);
    expect((await registrar({ outcome: "pendiente_abono", fecha_pactada: "2026-10-14" })).status).toBe(400);
    expect(creados).toHaveLength(0);

    const res = await registrar({ outcome: "pendiente_abono", fecha_pactada: "2026-10-17" });
    expect(res.status).toBe(200);
    expect(creados[0]).toMatchObject({ fechaPactada: "2026-10-17", recordatorioAt: null });
  });

  it("rechaza un canal que no existe", async () => {
    expect((await registrar({ outcome: "contesto", canal: "paloma" })).status).toBe(400);
  });

  it("una decisión o una nota no llevan canal", async () => {
    await registrar({ kind: "decision", outcome: "ultimo_intento", canal: "llamada" });
    expect(creados[0]).toMatchObject({ outcome: "ultimo_intento", canal: "" });
  });

  it("una asesora sin supervisión queda a su nombre aunque mande otro", async () => {
    yo = { staffId: 2, permisos: ["leads", "pedidos"], nombre: "Leny Aniuska" };
    await registrar({ outcome: "contesto", staff_id: 3, staff_name: "Susan" });
    expect(creados[0]).toMatchObject({ staffId: 2, staffName: "Leny Aniuska" });
  });
});
