// Comentarios y etiquetas de iComfly en la ficha del pedido de Kairo.
//
// POR QUE ESTE TEST EXISTE: las asesoras comentan los pedidos en iComfly; si
// Kairo no los muestra, tienen que escribir lo mismo dos veces. El formato de
// iComfly es "[fecha · nombre] texto" por linea: si se lee mal, la ficha
// mostraria comentarios pegados, sin autor o en otro orden.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fechaComentarioIso, leerComentariosIcomfly, leerEtiquetasIcomfly } from "../lib/icomfly-comentarios";

let fila: Record<string, unknown> | null = null;
const filtrosUsados: string[] = [];
vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: () => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        or: (f: string) => (filtrosUsados.push(f), api),
        limit: () => Promise.resolve({ data: fila ? [fila] : [], error: null }),
      };
      return api;
    },
  }),
}));

describe("leer la nota interna de iComfly", () => {
  it("un comentario por encabezado, con fecha y autor", () => {
    const nota =
      "[2026-10-30 16:58 · Jeanny Linares] se llamo 3 veces y no respondio se dejo mensaje\n" +
      "[2026-11-02 10:44 · Rosa Tipiani] se llamo 3 veces no responde";
    expect(leerComentariosIcomfly(nota)).toEqual([
      { fecha: "2026-10-30 16:58", autor: "Jeanny Linares", texto: "se llamo 3 veces y no respondio se dejo mensaje" },
      { fecha: "2026-11-02 10:44", autor: "Rosa Tipiani", texto: "se llamo 3 veces no responde" },
    ]);
  });

  it("una linea sin encabezado sigue al comentario anterior; texto suelto queda sin autor", () => {
    expect(leerComentariosIcomfly("[2026-11-02 18:12 · Leny Aniuska] 9-11\nllamar despues de las 5")).toEqual([
      { fecha: "2026-11-02 18:12", autor: "Leny Aniuska", texto: "9-11\nllamar despues de las 5" },
    ]);
    expect(leerComentariosIcomfly("cliente pide entrega en la tarde")).toEqual([
      { fecha: null, autor: null, texto: "cliente pide entrega en la tarde" },
    ]);
    expect(leerComentariosIcomfly(null)).toEqual([]);
    expect(leerComentariosIcomfly("  \n ")).toEqual([]);
  });

  it("etiquetas: los nombres, sin repetidos", () => {
    expect(
      leerEtiquetasIcomfly([{ id: 1, name: "Sinpe al recibir" }, { id: 2, name: "Contra Entrega " }, { id: 3, name: "Sinpe al recibir" }])
    ).toEqual(["Sinpe al recibir", "Contra Entrega"]);
    expect(leerEtiquetasIcomfly(null)).toEqual([]);
  });

  it("la hora del comentario es la de la tienda (Costa Rica, UTC-6)", () => {
    expect(fechaComentarioIso("2026-11-02 15:39", "America/Costa_Rica")).toBe("2026-11-02T21:39:00.000Z");
    expect(fechaComentarioIso(null, "America/Costa_Rica")).toBeNull();
  });
});

describe("notas de un pedido", () => {
  beforeEach(() => {
    fila = { icomfly_order_id: "84457", internal_note: "[2026-11-02 09:00 · Leny Aniuska] viejo", labels: [] };
    filtrosUsados.length = 0;
  });

  it("lee el pedido en vivo de iComfly", async () => {
    const { notasIcomflyDelPedido } = await import("../lib/icomfly-comentarios-db");
    const vivo = vi.fn(async () => ({
      id: 84457,
      internal_note: "[2026-11-02 09:00 · Leny Aniuska] viejo\n[2026-11-02 11:00 · Leny Aniuska] nuevo",
      labels: [{ id: 9, name: "Posible duplicado" }],
    }));
    const r = await notasIcomflyDelPedido({ id: 1, code: "mireva-cr" }, "IC-84457", vivo);
    expect(vivo).toHaveBeenCalledWith("mireva-cr", "84457");
    expect(r).toMatchObject({ origen: "vivo", etiquetas: ["Posible duplicado"] });
    expect(r?.comentarios.map((c) => c.texto)).toEqual(["viejo", "nuevo"]);
    expect(filtrosUsados[0]).toContain("icomfly_order_id.eq.84457");
  });

  it("si iComfly no responde, muestra lo de la ultima sincronizacion", async () => {
    const { notasIcomflyDelPedido } = await import("../lib/icomfly-comentarios-db");
    const r = await notasIcomflyDelPedido({ id: 1, code: "mireva-cr" }, "IC-84457", async () => {
      throw new Error("timeout");
    });
    expect(r).toMatchObject({ origen: "sincronizado", comentarios: [{ texto: "viejo" }] });
  });

  it("un pedido que no esta en iComfly no da notas", async () => {
    fila = null;
    const { notasIcomflyDelPedido } = await import("../lib/icomfly-comentarios-db");
    expect(await notasIcomflyDelPedido({ id: 1, code: "mireva-cr" }, "#MCRC20388", vi.fn())).toBeNull();
    expect(await notasIcomflyDelPedido({ id: 1, code: "mireva-cr" }, "nombre raro ' or 1=1", vi.fn())).toBeNull();
  });
});
