// Productividad de despacho (pestaña Productividad de Gestion).
//
// POR QUE ESTE TEST EXISTE: el reporte dice cuantos pedidos despacha cada
// asesora, y con eso se mide y se paga. Un pedido contado en el dia equivocado
// (la hora de iComfly viene en UTC, el dia es el de la tienda, UTC-6) o el bot
// de iComfly contado como una persona dan otro reporte.

import { describe, expect, it, vi } from "vitest";
import { diasDelRango, resumenDespacho, SIN_NOMBRE, type AtribucionPedido } from "../lib/productividad-despacho";
import { exigenciaDe, cumple } from "../lib/permisos";

// Cadena de supabase-js simulada: registra cada llamada y responde vacio.
const llamadas: string[] = [];
vi.mock("@/lib/db", () => {
  const cadena: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        return (...args: unknown[]) => {
          llamadas.push(`${String(prop)}:${args.map(String).join("|")}`);
          return cadena;
        };
      },
    }
  );
  return { getDB: () => cadena };
});

const fila = (over: Partial<AtribucionPedido> = {}): AtribucionPedido => ({
  guide_final_at: null,
  confirmed_at: null,
  guia_por: null,
  confirmo_por: null,
  ...over,
});

// "Ayer" 23/10 en Costa Rica: de 23/10 06:00Z a 24/10 06:00Z.
const DESDE = "2026-10-23T06:00:00.000Z";
const HASTA = "2026-10-24T06:00:00.000Z";

describe("quién despacha y quién confirma", () => {
  it("cuenta por persona lo que cae en el rango, y lo de afuera no", () => {
    const r = resumenDespacho(
      [
        fila({ guide_final_at: "2026-10-23T15:00:00Z", guia_por: "Jeanny Linares" }),
        fila({ guide_final_at: "2026-10-23T20:00:00Z", guia_por: "Jeanny Linares", confirmed_at: "2026-10-23T19:00:00Z", confirmo_por: "Leny Aniuska" }),
        fila({ guide_final_at: "2026-10-23T16:00:00Z", guia_por: "Leny Aniuska" }),
        fila({ guide_final_at: "2026-10-24T07:00:00Z", guia_por: "Jeanny Linares" }), // 24/10 local: afuera
      ],
      DESDE,
      HASTA
    );
    expect(r.personas.map((p) => [p.nombre, p.despachados, p.confirmados])).toEqual([
      ["Jeanny Linares", 2, 0],
      ["Leny Aniuska", 1, 1],
    ]);
    expect(r).toMatchObject({ despachados: 3, confirmados: 1 });
  });

  it("el día es el de la tienda: 05:30 UTC del 24 es el 23 a las 23:30", () => {
    const r = resumenDespacho(
      [fila({ guide_final_at: "2026-10-24T05:30:00Z", guia_por: "Thalia Guerrero" })],
      "2026-10-17T06:00:00.000Z",
      "2026-10-24T06:00:00.000Z"
    );
    expect(r.personas[0].porDia).toEqual({ "2026-10-23": 1 });
  });

  it("el bot de iComfly va aparte y al final, aunque confirme más", () => {
    const r = resumenDespacho(
      [
        ...Array.from({ length: 5 }, () => fila({ confirmed_at: "2026-10-23T15:00:00Z", confirmo_por: "Asistente Logístico" })),
        fila({ guide_final_at: "2026-10-23T15:00:00Z", guia_por: "Leonor Valle" }),
      ],
      DESDE,
      HASTA
    );
    expect(r.personas.map((p) => [p.nombre, p.esIa])).toEqual([
      ["Leonor Valle", false],
      ["Asistente Logístico", true],
    ]);
  });

  it("mismo nombre con otras mayúsculas o espacios es la misma persona; sin nombre va aparte", () => {
    const r = resumenDespacho(
      [
        fila({ guide_final_at: "2026-10-23T15:00:00Z", guia_por: "Jeanny Linares" }),
        fila({ guide_final_at: "2026-10-23T16:00:00Z", guia_por: " jeanny  linares " }),
        fila({ guide_final_at: "2026-10-23T17:00:00Z", guia_por: "" }),
      ],
      DESDE,
      HASTA
    );
    expect(r.personas.map((p) => [p.nombre, p.despachados])).toEqual([
      ["Jeanny Linares", 2],
      [SIN_NOMBRE, 1],
    ]);
  });
});

describe("los días del rango", () => {
  it("ayer es un día; 7 días son 8 fechas (hoy incluido, hasta ahora)", () => {
    expect(diasDelRango(DESDE, HASTA)).toEqual(["2026-10-23"]);
    expect(diasDelRango("2026-10-17T20:00:00.000Z", "2026-10-24T20:00:00.000Z")).toEqual([
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
  });
});

describe("lo que se lee de la base", () => {
  it("solo la tienda pedida, con guía o confirmación en el rango", async () => {
    const { listAtribucionDespacho } = await import("../lib/finance");
    await listAtribucionDespacho(2, DESDE, HASTA);
    expect(llamadas).toContain("from:icomfly_orders");
    expect(llamadas).toContain("eq:store_id|2");
    // Una consulta por fecha de guia y otra por fecha de confirmacion.
    expect(llamadas).toEqual(
      expect.arrayContaining([
        `gte:guide_final_at|${DESDE}`,
        `lt:guide_final_at|${HASTA}`,
        `gte:confirmed_at|${DESDE}`,
        `lt:confirmed_at|${HASTA}`,
      ])
    );
    expect(llamadas.filter((l) => l === "eq:store_id|2")).toHaveLength(2);
    expect(llamadas.some((l) => l.startsWith("range:0|999"))).toBe(true);
  });
});

describe("quién lo puede ver", () => {
  it("lo mismo que Gestión: pedidos o finanzas; una asesora no", () => {
    const exige = exigenciaDe("/api/finance/productividad");
    expect(cumple(exige, ["pedidos"])).toBe(true);
    expect(cumple(exige, ["finanzas"])).toBe(true);
    expect(cumple(exige, ["leads"])).toBe(false);
  });
});
