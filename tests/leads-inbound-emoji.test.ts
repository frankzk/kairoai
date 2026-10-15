// Un emoji partido no puede trancar el conteo de mensajes.
//
// EL CASO REAL (07/10/2026): al volver a prender leads-inbound, a las 23:57 UTC
// el cron empezo a morir en cada corrida con "runLeadsInboundSync: Empty or
// invalid json". El primer mensaje se recortaba con slice(0, 500), que cuenta
// unidades UTF-16: un emoji en la posicion 500 quedaba partido (\ud83d sola) y
// Supabase rechazaba el UPDATE. Como ese lead encabezaba la cola, TODAS las
// corridas siguientes morian en el mismo lead, y los 250 que venian detras no
// se leian nunca.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { summarizeInbound, textoGuardable } from "../lib/leads-inbound";
import type { ConversationMessage } from "../lib/leads-types";

/** true si no queda ninguna mitad de emoji suelta. */
function bienFormado(s: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

function inbound(text: string, timestamp = 1): ConversationMessage {
  return { direction: "inbound", timestamp, text } as ConversationMessage;
}

describe("textoGuardable", () => {
  it("el caso real: un emoji justo en el corte de 500 no queda partido", () => {
    const texto = "a".repeat(499) + "😀" + "b";
    // Lo que hacia el codigo viejo:
    expect(bienFormado(texto.slice(0, 500))).toBe(false);
    const r = textoGuardable(texto, 500);
    expect(bienFormado(r)).toBe(true);
    expect(Array.from(r)).toHaveLength(500);
    expect(r.endsWith("😀")).toBe(true);
  });

  it("una mitad suelta que ya venia del chat se reemplaza, no se manda", () => {
    const r = textoGuardable("hola \uD83D chau", 500);
    expect(bienFormado(r)).toBe(true);
    expect(r).toBe("hola � chau");
  });

  it("saca el caracter nulo, que Postgres no admite en un text", () => {
    expect(textoGuardable("ho\u0000la", 500)).toBe("hola");
  });

  it("un texto corto y normal queda igual", () => {
    expect(textoGuardable("Hola, quiero el Snap Smile 😁", 500)).toBe("Hola, quiero el Snap Smile 😁");
  });
});

describe("summarizeInbound usa el recorte seguro", () => {
  it("el primer mensaje guardado nunca trae medio emoji", () => {
    const r = summarizeInbound([inbound("x".repeat(499) + "🔥🔥")]);
    expect(r.inboundCount).toBe(1);
    expect(bienFormado(r.firstInboundText!)).toBe(true);
    expect(JSON.stringify(r.firstInboundText)).not.toMatch(/\\ud[89ab]/i);
  });
});

// ── La corrida no se cae por un lead ─────────────────────────────────────────

const updates: Array<{ id: number; first: string | null }> = [];
let rechazarTextoDe = new Set<number>();
let rechazarTodoDe = new Set<number>();

vi.mock("../lib/db", () => ({
  getDB: () => ({
    rpc: async (name: string) =>
      name === "leads_pending_inbound"
        ? {
            data: [
              { id: 1, crm_conversation_id: "c1", inbound_count: null, first_inbound_text: null },
              { id: 2, crm_conversation_id: "c2", inbound_count: null, first_inbound_text: null },
              { id: 3, crm_conversation_id: "c3", inbound_count: null, first_inbound_text: null },
            ],
            error: null,
          }
        : { data: 0, error: null },
    from: () => ({
      update: (row: { first_inbound_text: string | null }) => ({
        eq: (_c: string, id: number) => ({
          eq: async () => {
            const malo =
              rechazarTodoDe.has(id) || (rechazarTextoDe.has(id) && row.first_inbound_text != null);
            if (malo) return { error: { message: "Empty or invalid json" } };
            updates.push({ id, first: row.first_inbound_text });
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));
vi.mock("../lib/icomfly-chat", () => ({
  fetchConversationTranscript: async () => [inbound("hola"), inbound("quiero el producto", 2)],
}));
vi.mock("../lib/icomfly", () => ({
  resolveIcomflyStoreContext: () => ({ store: { id: 1, code: "mireva-cr" }, externalStoreId: 99 }),
}));

describe("runLeadsInboundSync", () => {
  beforeEach(() => {
    updates.length = 0;
    rechazarTextoDe = new Set();
    rechazarTodoDe = new Set();
  });

  it("si la base rechaza el texto de un lead, guarda el conteo sin el texto y sigue", async () => {
    rechazarTextoDe = new Set([1]);
    const { runLeadsInboundSync } = await import("../lib/leads-inbound-sync");
    const r = await runLeadsInboundSync({ storeId: 1, timeBudgetMs: 10_000 });
    expect(r.failed).toBe(0);
    expect(r.checked).toBe(3);
    expect(updates.find((u) => u.id === 1)).toEqual({ id: 1, first: null });
    expect(updates.map((u) => u.id).sort()).toEqual([1, 2, 3]);
  });

  it("si un lead no entra de ninguna forma, se cuenta como fallido y los demas se guardan", async () => {
    rechazarTodoDe = new Set([1]);
    const { runLeadsInboundSync } = await import("../lib/leads-inbound-sync");
    const r = await runLeadsInboundSync({ storeId: 1, timeBudgetMs: 10_000 });
    expect(r.failed).toBe(1);
    expect(r.checked).toBe(2);
    expect(updates.map((u) => u.id).sort()).toEqual([2, 3]);
  });
});
