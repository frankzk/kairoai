// Productividad de Novedades (ventana Productividad de Novedades).
//
// POR QUE ESTE TEST EXISTE: el reporte dice quien trabaja las novedades y
// cuantas, y con eso se mide al equipo. Hasta octubre 2026 incident_events no
// guardaba quien hacia cada accion: si recordIncidentEvent deja de poner la
// persona, el reporte queda vacio sin avisar; si la pone en la deteccion
// automatica, quien aprieta "Detectar novedades" se lleva todas las novedades
// del courier.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumenNovedades, type AccionNovedad } from "../lib/productividad-novedades";
import { exigenciaDe, cumple } from "../lib/permisos";
import type { DetectedIncident } from "../lib/incidents-types";

// Cadena de supabase-js simulada: registra cada llamada y responde `respuesta`.
const llamadas: string[] = [];
const inserts: Array<{ tabla: string; fila: Record<string, unknown> }> = [];
let respuesta: { data: unknown; error: null } = { data: [], error: null };
vi.mock("@/lib/db", () => {
  let tabla = "";
  const cadena: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(respuesta).then(ok);
        return (...args: unknown[]) => {
          if (prop === "from") tabla = String(args[0]);
          if (prop === "insert") inserts.push({ tabla, fila: args[0] as Record<string, unknown> });
          llamadas.push(`${String(prop)}:${args.map((a) => (typeof a === "object" && a ? JSON.stringify(a) : String(a))).join("|")}`);
          return cadena;
        };
      },
    }
  );
  return { getDB: () => cadena };
});

let yo: { id: number; nombre: string; staffId: number | null } | null = null;
vi.mock("@/lib/identidad", () => ({
  identidadActual: () => (yo ? { ...yo, permisos: ["novedades"], tiendas: ["mireva-cr"] } : null),
}));

beforeEach(() => {
  llamadas.length = 0;
  inserts.length = 0;
  respuesta = { data: [], error: null };
  yo = null;
});

const accion = (over: Partial<AccionNovedad> = {}): AccionNovedad => ({
  incident_id: 1,
  kind: "llamada",
  created_at: "2026-10-23T15:00:00Z",
  actor: "Jeanny Linares",
  ...over,
});

// "Ayer" 23/10 en Costa Rica: de 23/10 06:00Z a 24/10 06:00Z.
const DESDE = "2026-10-23T06:00:00.000Z";
const HASTA = "2026-10-24T06:00:00.000Z";

describe("quién trabaja las novedades", () => {
  it("cuenta novedades distintas por persona y separa cada tipo de acción", () => {
    const r = resumenNovedades(
      [
        accion({ incident_id: 1, kind: "llamada" }),
        accion({ incident_id: 1, kind: "reprogramada" }),
        accion({ incident_id: 2, kind: "nota" }),
        accion({ incident_id: 3, kind: "accion_rts" }),
        accion({ incident_id: 1, kind: "llamada", actor: "Leny Aniuska" }),
        accion({ incident_id: 9, created_at: "2026-10-24T07:00:00Z" }), // 24/10 local: afuera
      ],
      DESDE,
      HASTA
    );
    expect(r.personas.map((p) => [p.nombre, p.novedades, p.acciones, p.llamadas, p.reprogramadas, p.notas, p.otras])).toEqual([
      ["Jeanny Linares", 3, 4, 1, 1, 1, 1],
      ["Leny Aniuska", 1, 1, 1, 0, 0, 0],
    ]);
    // La novedad 1 la trabajaron dos personas: en el total cuenta una vez.
    expect(r).toMatchObject({ novedades: 3, acciones: 5 });
  });

  it("lo que hizo el sistema (sin persona) no cuenta", () => {
    const r = resumenNovedades([accion({ actor: null, kind: "detectada" }), accion({ actor: "  " })], DESDE, HASTA);
    expect(r.personas).toEqual([]);
    expect(r).toMatchObject({ novedades: 0, acciones: 0 });
  });

  it("el día es el de la tienda, y por día cuenta novedades distintas", () => {
    const r = resumenNovedades(
      [
        accion({ incident_id: 1, created_at: "2026-10-24T05:30:00Z" }), // 23/10 23:30 local
        accion({ incident_id: 1, created_at: "2026-10-23T15:00:00Z", kind: "nota" }),
        accion({ incident_id: 2, created_at: "2026-10-22T15:00:00Z" }),
      ],
      "2026-10-17T06:00:00.000Z",
      "2026-10-24T06:00:00.000Z"
    );
    expect(r.personas[0].porDia).toEqual({ "2026-10-23": 1, "2026-10-22": 1 });
  });

  it("mismo nombre con otras mayúsculas o espacios es la misma persona; primero quien más novedades trabaja", () => {
    const r = resumenNovedades(
      [
        accion({ incident_id: 1, actor: "Leny Aniuska" }),
        accion({ incident_id: 2, actor: "Jeanny Linares" }),
        accion({ incident_id: 3, actor: " jeanny  linares " }),
      ],
      DESDE,
      HASTA
    );
    expect(r.personas.map((p) => [p.nombre, p.novedades])).toEqual([
      ["Jeanny Linares", 2],
      ["Leny Aniuska", 1],
    ]);
  });
});

describe("quién hizo cada acción queda guardado", () => {
  it("una acción de alguien con sesión guarda la persona, sin perder el resto de la metadata", async () => {
    yo = { id: 4, nombre: "Jeanny Linares", staffId: 12 };
    const { recordIncidentEvent } = await import("../lib/incidents");
    await recordIncidentEvent(7, { kind: "llamada", message: "No contesta", metadata: { intento: 2 } });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].tabla).toBe("incident_events");
    expect(inserts[0].fila.metadata).toEqual({ intento: 2, actor: { id: 4, nombre: "Jeanny Linares", staff_id: 12 } });
  });

  it("un proceso sin sesión (cron) no inventa persona", async () => {
    const { recordIncidentEvent } = await import("../lib/incidents");
    await recordIncidentEvent(7, { kind: "nota", message: "x" });
    expect(inserts[0].fila.metadata).toEqual({});
  });

  it("la detección automática va sin persona aunque la lance alguien con el botón", async () => {
    yo = { id: 4, nombre: "Jeanny Linares", staffId: 12 };
    respuesta = { data: { id: 77 }, error: null };
    const { upsertDetectedIncident } = await import("../lib/incidents");
    const candidata: DetectedIncident = {
      store_id: 1,
      incident_key: "guia-123",
      source: "moovin",
      order_name: "MV1234",
      guide_number: "123",
      shopify_order_id: "",
      customer_name: "Ana",
      customer_phone: "88888888",
      courier: "Moovin",
      cod_amount: 15000,
      category: "cliente_no_responde",
      detail: "",
      last_tracking_status: "Cliente ausente",
      last_tracking_group: "failed",
      last_failure_at: "2026-10-23T15:00:00Z",
    };
    const { outcome } = await upsertDetectedIncident(candidata, { existing: null });
    expect(outcome).toBe("created");
    const evento = inserts.find((i) => i.tabla === "incident_events");
    expect(evento?.fila.kind).toBe("detectada");
    expect(evento?.fila.metadata).not.toHaveProperty("actor");
  });
});

describe("lo que se lee de la base", () => {
  it("solo la tienda pedida, en el rango, y solo acciones con persona", async () => {
    const { listAccionesNovedades } = await import("../lib/incidents");
    await listAccionesNovedades(2, DESDE, HASTA);
    expect(llamadas).toContain("from:incident_events");
    expect(llamadas).toEqual(
      expect.arrayContaining([
        "eq:incidents.store_id|2",
        `gte:created_at|${DESDE}`,
        `lt:created_at|${HASTA}`,
        "not:metadata->actor->>nombre|is|null",
        "range:0|999",
      ])
    );
    expect(llamadas.some((l) => l.startsWith("select:") && l.includes("incidents!inner(store_id)"))).toBe(true);
  });
});

describe("quién lo puede ver", () => {
  it("lo mismo que Novedades; una asesora de leads no", () => {
    const exige = exigenciaDe("/api/incidents/productividad");
    expect(cumple(exige, ["novedades"])).toBe(true);
    expect(cumple(exige, ["leads"])).toBe(false);
  });
});
