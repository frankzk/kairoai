import { describe, expect, it } from "vitest";
import {
  classifyConversation,
  classifyByLabels,
  detectSinpeText,
  nextLeadState,
  statusCategory,
  statusBoardStage,
} from "../lib/leads-classify";
import type { IcomflyConversation, LeadStateSnapshot } from "../lib/leads-types";

function makeConv(partial: Partial<IcomflyConversation> = {}): IcomflyConversation {
  return {
    id: "1",
    contactId: "10",
    phone: "50661234567",
    displayName: "Cliente",
    platform: "whatsapp",
    status: "open",
    assignedTo: null,
    lastMessageText: "",
    lastMessageAt: new Date().toISOString(),
    lastMessageSender: "agent",
    unreadCount: 0,
    priority: "normal",
    chatbotDisabled: false,
    abandonedCartId: null,
    abandonedCartCount: 0,
    recoveredCartCount: 0,
    labels: [],
    closedAt: null,
    closedReason: null,
    lastReopenAt: null,
    createdAt: null,
    updatedAt: null,
    waPhoneNumberId: null,
    storeCountry: "CR",
    raw: {},
    ...partial,
  };
}

describe("classifyByLabels", () => {
  it("maps messy Icomfly labels to clean statuses", () => {
    expect(classifyByLabels(["Carrito Abandonado"])?.status).toBe("carrito_abandonado");
    expect(classifyByLabels(["Carrito abandonado recuperado"])?.status).toBe("carrito_recuperado");
    expect(classifyByLabels(["lista negra"])?.status).toBe("lista_negra");
    expect(classifyByLabels(["REQUERIMIENTO HUMANO"])?.status).toBe("por_cerrar");
    expect(classifyByLabels(["falta la dirección para poder enviar"])?.status).toBe("en_espera_direccion");
    expect(classifyByLabels(["sin stock"])?.status).toBe("sin_stock");
    expect(classifyByLabels(["Pedido Shopify - número diferente"])?.status).toBe("duplicado");
  });
  it("returns null when nothing matches", () => {
    expect(classifyByLabels(["etiqueta random 10-07"])).toBeNull();
  });
});

describe("detectSinpeText", () => {
  it("detects SINPE payment phrases", () => {
    expect(detectSinpeText("ya le hice el sinpe")).toBe(true);
    expect(detectSinpeText("acabo de transferir")).toBe(true);
    expect(detectSinpeText("hola, cuanto cuesta?")).toBe(false);
  });
});

describe("classifyConversation priority", () => {
  it("shopify order beats everything -> ganado/pedido_generado", () => {
    const c = classifyConversation(makeConv({ labels: ["Carrito Abandonado"] }), { hasShopifyOrder: true });
    expect(c.status).toBe("pedido_generado");
    expect(c.category).toBe("won");
  });
  it("SINPE in last message -> pago_verificar", () => {
    const c = classifyConversation(makeConv({ lastMessageText: "ya te hice el sinpe" }));
    expect(c.status).toBe("sinpe_por_verificar");
    expect(statusBoardStage(c.status)).toBe("pago_verificar");
  });
  it("chatbot disabled (human took over) -> por_cerrar", () => {
    const c = classifyConversation(makeConv({ chatbotDisabled: true }));
    expect(c.status).toBe("por_cerrar");
    expect(c.category).toBe("hot");
  });
  it("abandoned cart signal -> carrito", () => {
    const c = classifyConversation(makeConv({ abandonedCartId: "55" }));
    expect(c.status).toBe("carrito_abandonado");
    expect(c.hasCartSignal).toBe(true);
  });
  it("inbound pending message -> conversando", () => {
    const c = classifyConversation(makeConv({ lastMessageSender: "contact", unreadCount: 2 }));
    expect(c.status).toBe("conversando");
  });
  it("closed conversation with no prior signal -> descartado (cancelado)", () => {
    const c = classifyConversation(makeConv({ closedAt: new Date().toISOString() }));
    expect(statusBoardStage(c.status)).toBe("descartado");
  });
});

describe("nextLeadState — las 4 leyes", () => {
  const manualSnap: LeadStateSnapshot = {
    category: "open",
    status: "no_responde",
    statusSource: "manual",
    hasOrder: false,
    hasCartSignal: false,
  };

  it("LEY 2: un estado manual NUNCA lo sobreescribe la ingesta", () => {
    const incoming = classifyConversation(makeConv({ chatbotDisabled: true })); // por_cerrar (auto)
    expect(nextLeadState(manualSnap, incoming)).toBeNull();
  });

  it("LEY 2 excepcion: una compra real SI gana sobre el estado manual", () => {
    const incoming = classifyConversation(makeConv(), { hasShopifyOrder: true }); // won
    const res = nextLeadState(manualSnap, incoming);
    expect(res).not.toBeNull();
    expect(res?.category).toBe("won");
  });

  it("LEY 3: won con orden es pegajoso, no se degrada solo", () => {
    const wonSnap: LeadStateSnapshot = {
      category: "won",
      status: "pedido_generado",
      statusSource: "auto",
      hasOrder: true,
      hasCartSignal: false,
    };
    const incoming = classifyConversation(makeConv({ lastMessageSender: "contact", unreadCount: 1 }));
    expect(nextLeadState(wonSnap, incoming)).toBeNull();
  });

  it("LEY 4: un lost con carrito nuevo se reabre solo con reopen explicito", () => {
    const lostSnap: LeadStateSnapshot = {
      category: "lost",
      status: "cancelado",
      statusSource: "auto",
      hasOrder: false,
      hasCartSignal: false,
    };
    const incoming = classifyConversation(makeConv({ abandonedCartId: "99" }));
    expect(nextLeadState(lostSnap, incoming)).toBeNull();
    const reopened = nextLeadState(lostSnap, incoming, { reopen: true });
    expect(reopened?.status).toBe("carrito_abandonado");
  });

  it("nuevo lead: aplica la clasificacion tal cual", () => {
    const incoming = classifyConversation(makeConv({ abandonedCartId: "1" }));
    const res = nextLeadState(null, incoming);
    expect(res?.status).toBe("carrito_abandonado");
  });

  it("estado auto no terminal se actualiza si cambia la clasificacion", () => {
    const autoSnap: LeadStateSnapshot = {
      category: "open",
      status: "nuevo",
      statusSource: "auto",
      hasOrder: false,
      hasCartSignal: false,
    };
    const incoming = classifyConversation(makeConv({ chatbotDisabled: true }));
    expect(nextLeadState(autoSnap, incoming)?.status).toBe("por_cerrar");
  });
});

describe("statusCategory", () => {
  it("resolves category from the catalog", () => {
    expect(statusCategory("sinpe_por_verificar")).toBe("hot");
    expect(statusCategory("pedido_generado")).toBe("won");
    expect(statusCategory("lista_negra")).toBe("lost");
  });
});
