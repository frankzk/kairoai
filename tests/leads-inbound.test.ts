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

// MEDIDO Y REVERTIDO. La spec del CRM de origen cuenta como "converso" a quien
// mando un unico mensaje si ese mensaje ya trae el link de la ficha de producto.
// Se implemento asi y despues se midio en esta base: de 708 leads con ese
// patron, solo el 0,1% llego a "por cerrar" o a tener pedido — el PEOR de todos
// los segmentos, por debajo de los frios (1,0%). Ascenderlos los ponia por
// delante de gente que convierte 400 veces mas.
//
// hasProductLink() se conserva porque identifica un origen real (el boton
// "consultar por WhatsApp" de la ficha), pero ya no decide el segmento.
describe("el link de producto NO asciende el lead", () => {
  const base = {
    status: "conversando",
    status_source: "auto",
    category: "open",
    cart_item_count: 0,
    shopify_cart_open: false,
    shopify_draft_cart_count: 0,
    has_cart_signal: false,
  };

  it("un unico mensaje con link de producto sigue siendo frio", () => {
    expect(leadSegment({ ...base, inbound_count: 1 })).toBe("frio");
  });

  it("lo que manda es cuantos mensajes escribio, no de donde vino", () => {
    expect(leadSegment({ ...base, inbound_count: 2 })).toBe("converso");
    expect(leadSegment({ ...base, inbound_count: 10 })).toBe("enganchado");
  });

  it("hasProductLink sigue reconociendo el patron aunque no ascienda", () => {
    expect(hasProductLink("https://mireva.cr/products/collagen-plus Tengo una consulta")).toBe(true);
  });
});
