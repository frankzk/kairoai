// Que consulta sale REALMENTE a Postgres cuando el tablero pide sus leads.
//
// El tablero se parte en dos mitades (trabajo / archivo) y los contadores se
// cuentan aparte sobre toda la poblacion. Si alguno de esos filtros se
// serializa distinto de lo que se penso, no explota nada: la pantalla
// simplemente muestra de menos, que es exactamente el modo de falla que este
// cambio vino a corregir.
//
// No hace falta base ni credenciales: se le da al cliente una URL de mentira y
// se intercepta fetch para leer la URL que armo PostgREST.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

type LeadsModule = typeof import("../lib/leads");
// Solo el tipo: no evalua el modulo antes de que este puesto el fetch de mentira.
type StageTuple = import("../lib/leads").StageTuple;

let leads: LeadsModule;
const requests: string[] = [];
/** Cuerpo JSON de cada peticion (los RPC mandan los argumentos por POST). */
const bodies: unknown[] = [];

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(input));
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    // Una pagina vacia corta la paginacion en la primera vuelta.
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  leads = await import("../lib/leads");
});

beforeEach(() => {
  requests.length = 0;
  bodies.length = 0;
});

/** La query string, ya decodificada, de la peticion numero `index`. */
function query(index = 0): string {
  return decodeURIComponent(new URL(requests[index]).search);
}

describe("listLeads", () => {
  it("scope 'trabajo' excluye por status Y por has_order", async () => {
    await leads.listLeads({ storeId: 1, scope: "trabajo" });

    expect(requests).toHaveLength(1);
    const q = query();
    expect(q).toContain("store_id=eq.1");
    // Los dos lados del corte: sin estado de cierre y sin pedido.
    expect(q).toContain("status=not.in.(");
    expect(q).toContain("has_order=eq.false");
    // Los estados de cierre y de descarte tienen que ir los dos en la lista.
    expect(q).toContain("pedido_generado");
    expect(q).toContain("ya_tiene_pedido");
    expect(q).toContain("lista_negra");
  });

  it("scope 'archivo' pide las dos condiciones en pasadas separadas", async () => {
    await leads.listLeads({ storeId: 1, scope: "archivo" });

    // Una por status de cierre/descarte, otra por has_order; se unen por id.
    expect(requests).toHaveLength(2);
    const todas = [query(0), query(1)].join(" | ");
    expect(todas).toContain("status=in.(");
    expect(todas).toContain("has_order=eq.true");
  });

  it("la ventana de antiguedad no pierde agendados ni marcados", async () => {
    await leads.listLeads({
      storeId: 1,
      scope: "trabajo",
      sinceIso: "2026-08-01T00:00:00.000Z",
    });

    const q = query();
    expect(q).toContain("last_interaction_at.gte.2026-08-01T00:00:00.000Z");
    expect(q).toContain("next_followup_at.not.is.null");
    expect(q).toContain("needs_attention.is.true");
  });

  it("sin scope trae todo (comportamiento de siempre)", async () => {
    await leads.listLeads({ storeId: 1 });

    const q = query();
    expect(q).not.toContain("status=not.in.(");
    expect(q).not.toContain("has_order=");
  });
});

describe("countLeadStages", () => {
  it("cuenta en UN viaje, agregando en Postgres", async () => {
    await leads.countLeadStages(1);

    // Antes eran siete: PostgREST corta en 1.000 filas y en Costa Rica hay
    // 6.212 leads elegibles, asi que el tablero esperaba siete idas y vueltas
    // solo para pintar los contadores.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("/rpc/leads_stage_tuples");
  });

  it("le pasa la tienda y la misma ventana de antiguedad que la lista", async () => {
    await leads.countLeadStages(1, "2026-08-01T00:00:00.000Z");

    expect(bodies[0]).toEqual({
      p_store_id: 1,
      p_since: "2026-08-01T00:00:00.000Z",
      p_always_statuses: ["sinpe_por_verificar"],
    });
  });

  it("sin ventana manda null, para contar toda la poblacion", async () => {
    await leads.countLeadStages(1);

    expect(bodies[0]).toEqual({
      p_store_id: 1,
      p_since: null,
      p_always_statuses: ["sinpe_por_verificar"],
    });
  });

  // La invariante que 0033 dejo anotada: si el conteo y la lista no exceptuan
  // lo MISMO, los contadores dejan de sumar lo que la pantalla muestra.
  it("exceptua de la ventana exactamente lo mismo que la lista", async () => {
    await leads.countLeadStages(1, "2026-08-01T00:00:00.000Z");
    const exentosEnElConteo = (bodies[0] as { p_always_statuses: string[] })
      .p_always_statuses;

    requests.length = 0;
    await leads.listLeads({ storeId: 1, scope: "trabajo", sinceIso: "2026-08-01T00:00:00.000Z" });
    const filtroDeLaLista = query();

    expect(exentosEnElConteo.length).toBeGreaterThan(0);
    for (const status of exentosEnElConteo) {
      expect(filtroDeLaLista).toContain(status);
    }
  });
});

describe("countByStageTuples", () => {
  const tupla = (
    partial: Partial<StageTuple> & { n: number }
  ): StageTuple => ({
    status: "conversando",
    status_source: "auto",
    shopify_cart_open: false,
    has_order: false,
    ...partial,
  });

  it("cada tupla aporta su multiplicidad, no una unidad", () => {
    // Es la diferencia entre contar filas agrupadas y contar filas sueltas: si
    // se ignora `n`, los contadores dirian 3 donde hay 6.212.
    const counts = leads.countByStageTuples([
      tupla({ status: "conversando", n: 900 }),
      tupla({ status: "frio", n: 231 }),
      tupla({ status: "por_cerrar", status_source: "auto", n: 40 }),
    ]);
    expect(counts.total).toBe(1171);
    expect(counts.byStage.tibios).toBe(900);
    expect(counts.byStage.frio).toBe(231);
    expect(counts.byStage.por_cerrar).toBe(40);
  });

  it("aplica las mismas reglas de bucket que la lista", () => {
    // leadBoardStage sigue mandando: un carrito abierto de origen automatico
    // cae en Carrito, y un pedido manda a Cerrado pase lo que pase.
    const counts = leads.countByStageTuples([
      tupla({ status: "conversando", shopify_cart_open: true, n: 5 }),
      tupla({ status: "conversando", has_order: true, n: 3 }),
      // Con estado manual el carrito NO gana: la asesora ya lo movio.
      tupla({ status: "no_responde", status_source: "manual", shopify_cart_open: true, n: 2 }),
    ]);
    expect(counts.byStage.carrito).toBe(5);
    expect(counts.byStage.cerrado).toBe(3);
    expect(counts.byStage.seguimiento).toBe(2);
  });

  it("dos tuplas que caen en el mismo bucket se suman", () => {
    const counts = leads.countByStageTuples([
      tupla({ status: "por_cerrar", n: 7 }),
      tupla({ status: "casi_cierra", n: 4 }),
    ]);
    expect(counts.byStage.por_cerrar).toBe(11);
  });

  it("un conteo que llega como texto no rompe la suma", () => {
    // Segun el driver, `count(*)` puede viajar como string en el JSON.
    const counts = leads.countByStageTuples([
      { ...tupla({ n: 0 }), n: "12" as unknown as number },
    ]);
    expect(counts.total).toBe(12);
    expect(counts.byStage.tibios).toBe(12);
  });

  it("sin tuplas da todo en cero, no undefined", () => {
    const counts = leads.countByStageTuples([]);
    expect(counts.total).toBe(0);
    expect(Object.values(counts.byStage).every((n) => n === 0)).toBe(true);
  });
});

describe("searchLeads", () => {
  it("busca por nombre, ultimo mensaje y telefono, sin ventana ni scope", async () => {
    await leads.searchLeads(1, "Maria");

    expect(requests).toHaveLength(1);
    const q = query();
    expect(q).toContain("name.ilike.%Maria%");
    expect(q).toContain("last_message_text.ilike.%Maria%");
    // La busqueda ve TODA la tabla: es lo que la hace util para encontrar a un
    // cliente viejo o ya cerrado.
    expect(q).not.toContain("last_interaction_at.gte");
    expect(q).not.toContain("status=not.in.(");
    expect(q).not.toContain("has_order=eq.");
    expect(q).toContain("limit=200");
  });

  it("el telefono se busca por digitos: da igual como lo escriban", async () => {
    await leads.searchLeads(1, "+506 8428-8896");

    expect(query()).toContain("phone.ilike.%50684288896%");
  });

  // Una coma partiria el or=(...) en dos condiciones y un parentesis lo
  // cerraria antes de tiempo: la consulta saldria mal formada o, peor,
  // filtrando por otra cosa.
  it("no deja que el texto rompa el filtro", async () => {
    await leads.searchLeads(1, "Ana, (test) *");

    // Se mira el or= entero: lo que importa es que siga siendo UNA condicion
    // por campo, sin parentesis ni comas de mas metidas por el texto.
    // El espacio viaja codificado como "+" en la query string.
    const or = new URL(requests[0]).searchParams.get("or");
    expect(or).toBe("(name.ilike.%Ana test%,last_message_text.ilike.%Ana test%)");
  });

  it("no sale a la base por una sola letra", async () => {
    expect(await leads.searchLeads(1, "a")).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
