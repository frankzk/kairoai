// Las gestiones de Kairo se copian a la nota interna del pedido en iComfly.
//
// POR QUE ESTE TEST EXISTE: las asesoras dejaron de escribir en los dos lados.
// Si la copia falla, la gestion igual tiene que quedar en Kairo (y avisar); si
// el texto sale sin la asesora o sin la marca, iComfly mostraria la firma del
// conector y Kairo volveria a mostrar la nota como si fuera de iComfly (eco).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { esNotaDeKairo, leerComentariosIcomfly } from "../lib/icomfly-comentarios";

let filaPedido: Record<string, unknown> | null = null;
const updates: Array<{ fila: Record<string, unknown>; id: unknown }> = [];
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (tabla: string) => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (col: string, v: unknown) => {
          if (tabla === "order_events" && col === "id" && pendiente) updates.push({ fila: pendiente, id: v });
          return api;
        },
        or: () => api,
        limit: () => Promise.resolve({ data: filaPedido ? [filaPedido] : [], error: null }),
        update: (fila: Record<string, unknown>) => ((pendiente = fila), api),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      let pendiente: Record<string, unknown> | null = null;
      return api;
    },
  }),
}));

const evento = {
  id: 77,
  kind: "contacto" as const,
  outcome: "no_contesta" as const,
  message: "se dejó audio",
  staff_name: "Jeanny Linares",
  canal: "whatsapp" as const,
  fecha_pactada: null,
  metadata: {},
};

describe("texto que se escribe en iComfly", () => {
  it("lleva la marca, la asesora, el resultado, el canal y el mensaje", async () => {
    const { textoNotaParaIcomfly } = await import("../lib/icomfly-nota-kairo");
    expect(textoNotaParaIcomfly(evento)).toBe("Kairo · Jeanny Linares: No contestó · Llamada WhatsApp — se dejó audio");
    expect(
      textoNotaParaIcomfly({ ...evento, outcome: "reagendar", canal: "llamada", message: "", fecha_pactada: "2026-11-05" })
    ).toBe("Kairo · Jeanny Linares: Volver a contactar · Llamada · para el 05/11");
    expect(textoNotaParaIcomfly({ ...evento, kind: "nota", outcome: "", canal: "", message: "pide entrega en la tarde" })).toBe(
      "Kairo · Jeanny Linares: Nota — pide entrega en la tarde"
    );
  });

  it("al volver de iComfly (con fecha y firma) se reconoce como de Kairo", async () => {
    const { textoNotaParaIcomfly } = await import("../lib/icomfly-nota-kairo");
    const nota = `[2026-11-03 10:00 · Mireva Costa Rica] ${textoNotaParaIcomfly(evento)}\n[2026-11-03 10:05 · Rosa Tipiani] llamar mañana`;
    const comentarios = leerComentariosIcomfly(nota);
    expect(comentarios.map((c) => esNotaDeKairo(c.texto))).toEqual([true, false]);
  });
});

describe("copiar la gestión", () => {
  beforeEach(() => {
    filaPedido = { icomfly_order_id: "84457" };
    updates.length = 0;
  });

  it("escribe la nota en el pedido de iComfly y anota que se copió", async () => {
    const { copiarGestionAIcomfly } = await import("../lib/icomfly-nota-kairo");
    const llamar = vi.fn(async () => ({ ok: true }));
    const r = await copiarGestionAIcomfly({ id: 1, code: "mireva-cr" }, "IC-84457", evento, {
      llamar,
      ahora: () => new Date("2026-11-03T16:00:00Z"),
    });
    expect(r).toEqual({ estado: "copiado" });
    expect(llamar).toHaveBeenCalledWith(
      "mireva-cr",
      "agregar_nota_pedido",
      { order_id: 84457, nota: "Kairo · Jeanny Linares: No contestó · Llamada WhatsApp — se dejó audio" },
      { timeoutMs: 8000 }
    );
    expect(updates).toEqual([
      { id: 77, fila: { metadata: { icomfly_nota: { estado: "copiado", at: "2026-11-03T16:00:00.000Z" } } } },
    ]);
  });

  it("si iComfly falla, no lanza: devuelve el error y lo anota", async () => {
    const { copiarGestionAIcomfly } = await import("../lib/icomfly-nota-kairo");
    const r = await copiarGestionAIcomfly({ id: 1, code: "mireva-cr" }, "IC-84457", evento, {
      llamar: async () => {
        throw new Error("iComfly 502: caído");
      },
    });
    expect(r).toEqual({ estado: "error", error: "iComfly 502: caído" });
    expect(updates[0].fila.metadata).toMatchObject({ icomfly_nota: { estado: "error" } });
  });

  it("un pedido que no está en iComfly no se intenta copiar", async () => {
    filaPedido = null;
    const { copiarGestionAIcomfly } = await import("../lib/icomfly-nota-kairo");
    const llamar = vi.fn();
    expect(await copiarGestionAIcomfly({ id: 1, code: "mireva-cr" }, "#MCRC20388", evento, { llamar })).toEqual({
      estado: "sin_pedido",
    });
    expect(llamar).not.toHaveBeenCalled();
  });
});
