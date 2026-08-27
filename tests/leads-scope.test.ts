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

let leads: LeadsModule;
const requests: string[] = [];

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
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
  it("cuenta sobre TODA la poblacion, sin partir por scope", async () => {
    await leads.countLeadStages(1);

    expect(requests).toHaveLength(1);
    const q = query();
    // El conteo no se parte en mitades: ese era el bug (contaba el pedazo
    // que cabia en la pantalla).
    expect(q).not.toContain("status=not.in.(");
    expect(q).not.toContain("has_order=eq.");
    // Y se trae solo lo que decide el bucket, no la fila entera.
    expect(q).toContain("select=status,status_source,shopify_cart_open,has_order");
  });

  it("respeta la misma ventana de antiguedad que la lista", async () => {
    await leads.countLeadStages(1, "2026-08-01T00:00:00.000Z");

    expect(query()).toContain("last_interaction_at.gte.2026-08-01T00:00:00.000Z");
  });
});
