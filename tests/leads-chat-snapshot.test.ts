// Copia de los chats de los carritos para poder analizarlos fuera de Icomfly.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { autorDe, compactarChat, MAX_MENSAJES } from "../lib/leads-chat-snapshot";
import type { ConversationMessage } from "../lib/leads-types";

function msg(over: Partial<ConversationMessage>): ConversationMessage {
  return { id: "m", direction: "outbound", timestamp: Date.UTC(2026, 9, 8, 15), ...over };
}

describe("autorDe", () => {
  it("separa cliente, bot y asesora; lo que Icomfly no dice queda como nosotros", () => {
    expect(autorDe(msg({ direction: "inbound" }))).toBe("cliente");
    expect(autorDe(msg({ sender: "bot" }))).toBe("bot");
    expect(autorDe(msg({ sender: "admin" }))).toBe("asesora");
    expect(autorDe(msg({}))).toBe("nosotros");
  });
});

describe("compactarChat", () => {
  it("deja fecha, autor y texto, en orden", () => {
    const r = compactarChat([
      msg({ id: "2", direction: "inbound", text: "sí, mándemelo", timestamp: Date.UTC(2026, 9, 8, 16) }),
      msg({ id: "1", sender: "bot", text: "¿Confirmamos tu pedido?", timestamp: Date.UTC(2026, 9, 8, 15) }),
    ]);
    expect(r).toEqual([
      { t: "2026-10-08T15:00:00.000Z", de: "bot", texto: "¿Confirmamos tu pedido?" },
      { t: "2026-10-08T16:00:00.000Z", de: "cliente", texto: "sí, mándemelo" },
    ]);
  });

  it("un audio o una foto sin texto quedan como [audio] / [imagen], no se pierden", () => {
    const r = compactarChat([
      msg({ direction: "inbound", mediaKind: "audio" }),
      msg({ direction: "inbound", mediaKind: "image", caption: "este modelo" }),
    ]);
    expect(r.map((m) => m.texto)).toEqual(["[audio]", "este modelo"]);
  });

  it("se queda con los ULTIMOS mensajes: son los que dicen como quedo la venta", () => {
    const muchos = Array.from({ length: MAX_MENSAJES + 20 }, (_, i) =>
      msg({ id: String(i), text: `m${i}`, timestamp: Date.UTC(2026, 9, 1) + i * 60_000 })
    );
    const r = compactarChat(muchos);
    expect(r).toHaveLength(MAX_MENSAJES);
    expect(r[r.length - 1].texto).toBe(`m${MAX_MENSAJES + 19}`);
  });

  it("no guarda medio emoji (mismo recorte seguro que el conteo de mensajes)", () => {
    const r = compactarChat([msg({ direction: "inbound", text: "a".repeat(999) + "😀😀" })]);
    expect(JSON.stringify(r)).not.toMatch(/\\ud[89ab][0-9a-f]{2}"/i);
  });
});

// ── La ruta ──────────────────────────────────────────────────────────────────

type Resultado = { data: unknown; error: null | { message: string } };
let leadsDeLaBase: unknown[] = [];
let snapsExistentes: unknown[] = [];
const upserts: Array<Record<string, unknown>> = [];

/** Builder encadenable: cualquier metodo devuelve el mismo objeto; al await, resuelve. */
function consulta(resultado: () => Resultado) {
  const q: Record<string, unknown> = {};
  const self = new Proxy(q, {
    get(_t, prop) {
      if (prop === "then") return (ok: (r: Resultado) => unknown) => Promise.resolve(resultado()).then(ok);
      if (prop === "upsert")
        return (fila: Record<string, unknown>) => {
          upserts.push(fila);
          return Promise.resolve({ error: null });
        };
      return () => self;
    },
  });
  return self;
}

vi.mock("@/lib/db", () => ({
  getDB: () => ({
    from: (tabla: string) =>
      consulta(() =>
        tabla === "leads"
          ? { data: leadsDeLaBase, error: null }
          : { data: snapsExistentes, error: null }
      ),
  }),
}));
vi.mock("@/lib/icomfly", () => ({
  resolveIcomflyStoreContext: () => ({ store: { id: 1, code: "mireva-cr" }, externalStoreId: 99 }),
}));
vi.mock("@/lib/icomfly-chat", () => ({
  fetchConversationTranscript: async () => [
    { id: "1", direction: "inbound", timestamp: Date.UTC(2026, 9, 8, 15), text: "¿cuánto es el envío?" },
  ],
}));

function lead(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    crm_conversation_id: `c${id}`,
    last_interaction_at: "2026-10-08T15:00:00.000Z",
    status: "carrito_abandonado",
    status_source: "auto",
    category: "open",
    cart_item_count: 1,
    shopify_cart_open: false,
    shopify_draft_cart_count: 0,
    has_cart_signal: true,
    inbound_count: 1,
    ...over,
  };
}

async function abrir() {
  const { GET } = await import("../app/api/leads/chat-snapshots/route");
  return GET(new NextRequest("http://localhost/api/leads/chat-snapshots?store=mireva-cr"));
}

describe("/api/leads/chat-snapshots", () => {
  beforeEach(() => {
    upserts.length = 0;
    snapsExistentes = [];
  });

  it("copia el chat de cada carrito en cola y deja el texto legible", async () => {
    leadsDeLaBase = [lead(1), lead(2)];
    const json = await (await abrir()).json();
    expect(json).toMatchObject({ ok: true, carritos: 2, guardados: 2, fallidos: 0 });
    expect(upserts.map((u) => u.lead_id).sort()).toEqual([1, 2]);
    expect(upserts[0].messages).toEqual([{ t: "2026-10-08T15:00:00.000Z", de: "cliente", texto: "¿cuánto es el envío?" }]);
  });

  it("deja afuera lo que no esta en la cola: un SINPE por verificar es otro trabajo", async () => {
    // (Los ganados y perdidos ni llegan: la consulta ya filtra category open/hot.)
    leadsDeLaBase = [lead(1), lead(2, { status: "sinpe_por_verificar", category: "hot" })];
    const json = await (await abrir()).json();
    expect(json.carritos).toBe(1);
    expect(upserts.map((u) => u.lead_id)).toEqual([1]);
  });

  it("es reanudable: no vuelve a bajar un chat que no cambio desde la ultima copia", async () => {
    leadsDeLaBase = [lead(1), lead(2)];
    snapsExistentes = [{ lead_id: 1, fetched_at: "2026-10-08T16:00:00.000Z" }];
    const json = await (await abrir()).json();
    expect(json).toMatchObject({ carritos: 2, ya_copiados: 1, guardados: 1 });
    expect(upserts.map((u) => u.lead_id)).toEqual([2]);
  });
});
