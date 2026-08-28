import { describe, expect, it } from "vitest";
import { hasProductLink, summarizeInbound } from "../lib/leads-inbound";
import { leadSegment } from "../lib/leads-segment";
import type { ConversationMessage } from "../lib/leads-types";

function msg(partial: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: String(Math.random()),
    direction: "inbound",
    timestamp: 1_000,
    ...partial,
  };
}

describe("summarizeInbound", () => {
  it("cuenta solo los mensajes del cliente", () => {
    const r = summarizeInbound([
      msg({ direction: "inbound", timestamp: 1, text: "hola" }),
      msg({ direction: "outbound", timestamp: 2, text: "buenas!" }),
      msg({ direction: "inbound", timestamp: 3, text: "cuanto cuesta?" }),
      msg({ direction: "outbound", timestamp: 4, text: "19900" }),
    ]);
    expect(r.inboundCount).toBe(2);
    expect(r.firstInboundText).toBe("hola");
  });

  it("toma el primero por timestamp, no por posicion en el arreglo", () => {
    const r = summarizeInbound([
      msg({ timestamp: 900, text: "segundo" }),
      msg({ timestamp: 100, text: "primero" }),
    ]);
    expect(r.firstInboundText).toBe("primero");
  });

  it("un audio o foto cuenta para el conteo pero no aporta texto", () => {
    const r = summarizeInbound([
      msg({ timestamp: 1, mediaKind: "audio" }),
      msg({ timestamp: 2, text: "ahi te mande un audio" }),
    ]);
    expect(r.inboundCount).toBe(2);
    expect(r.firstInboundText).toBe("ahi te mande un audio");
  });

  it("usa el caption cuando el mensaje es solo media con pie", () => {
    const r = summarizeInbound([msg({ timestamp: 1, mediaKind: "image", caption: "este producto" })]);
    expect(r.firstInboundText).toBe("este producto");
  });

  it("sin mensajes del cliente devuelve cero y null", () => {
    const r = summarizeInbound([msg({ direction: "outbound", text: "hola?" })]);
    expect(r).toEqual({ inboundCount: 0, firstInboundText: null });
  });

  it("recorta el primer mensaje para no guardar novelas", () => {
    const r = summarizeInbound([msg({ text: "x".repeat(900) })]);
    expect(r.firstInboundText).toHaveLength(500);
  });
});

describe("hasProductLink", () => {
  it("reconoce el mensaje prellenado desde la ficha de producto", () => {
    expect(
      hasProductLink("https://mireva.cr/products/collagen-plus?variant=1 Tengo una consulta")
    ).toBe(true);
    expect(hasProductLink("http://tienda.hn/products/x")).toBe(true);
  });

  it("no confunde otros links ni texto suelto", () => {
    expect(hasProductLink("hola")).toBe(false);
    expect(hasProductLink("https://mireva.cr/collections/todo")).toBe(false);
    expect(hasProductLink("mira products/ algo")).toBe(false);
    expect(hasProductLink(null)).toBe(false);
  });
});

describe("el link de producto asciende el lead a Conversó", () => {
  const base = {
    status: "conversando",
    status_source: "auto",
    category: "open",
    cart_item_count: 0,
    shopify_cart_open: false,
    shopify_draft_cart_count: 0,
    has_cart_signal: false,
    district: null,
  };

  it("un unico mensaje con link de producto no es frio", () => {
    expect(
      leadSegment({
        ...base,
        inbound_count: 1,
        first_inbound_text: "https://mireva.cr/products/collagen-plus Tengo una consulta",
      })
    ).toBe("converso");
  });

  it("un unico 'hola' sigue siendo frio", () => {
    expect(leadSegment({ ...base, inbound_count: 1, first_inbound_text: "hola" })).toBe("frio");
  });

  it("el link no inventa una conversacion donde el cliente no escribio", () => {
    expect(
      leadSegment({ ...base, inbound_count: 0, first_inbound_text: "https://x.cr/products/y" })
    ).toBe("frio");
  });
});
