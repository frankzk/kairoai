import { describe, expect, it } from "vitest";
import {
  classifyConversation,
  classifyByLabels,
  detectSinpeText,
  detectOrderInTranscript,
  nextLeadState,
  isProtectedFromPurchase,
  statusCategory,
  statusBoardStage,
  isValidDisposition,
  schedulesFollowup,
  defaultFollowupAt,
  defaultFollowupForStatus,
  DISPOSITION_OPTIONS,
} from "../lib/leads-classify";
import type { ConversationMessage, IcomflyConversation, LeadStateSnapshot } from "../lib/leads-types";

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
    saleStage: null,
    saleOrderId: null,
    paymentMethod: null,
    warrantyClaimId: null,
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

describe("detectOrderInTranscript", () => {
  const msg = (direction: "inbound" | "outbound", text: string): ConversationMessage => ({
    id: Math.random().toString(),
    direction,
    timestamp: 0,
    text,
  });
  it("detecta pedido enviado por la guia (caso William)", () => {
    const t = [
      msg("inbound", "Ok ok"),
      msg("outbound", "Tu numero de guia es 2585274, acabamos de enviar tu pedido de 2x Crucis+"),
    ];
    expect(detectOrderInTranscript(t)).toBe(true);
  });
  it("detecta 'ya confirmamos tu pedido'", () => {
    expect(detectOrderInTranscript([msg("outbound", "Perfecto, ya confirmamos tu pedido")])).toBe(true);
  });
  it("NO trata la apertura 'Hemos recibido tu pedido' como pedido (el cliente puede declinar)", () => {
    const t = [
      msg("outbound", "Hola. Hemos recibido tu pedido de 1x HER LOSS, valor total a pagar CONTRA ENTREGA de ₡19.900. Confirmame por favor"),
    ];
    expect(detectOrderInTranscript(t)).toBe(false);
  });
  it("detecta pedido enviado con guia y Moovin (caso Jordan/William)", () => {
    expect(detectOrderInTranscript([msg("outbound", "Tu numero de guia es 2585274, acabamos de enviar tu pedido con la transportadora Moovin")])).toBe(true);
    expect(detectOrderInTranscript([msg("outbound", "se comunicaron contigo de Moovin para la entrega de tu pedido")])).toBe(true);
  });
  it("detecta recordatorio de pedido y contacto de Moovin", () => {
    expect(detectOrderInTranscript([msg("outbound", "Recordatorio: tu pedido llega pronto")])).toBe(true);
    expect(detectOrderInTranscript([msg("outbound", "se comunicaron contigo de Moovin para la entrega")])).toBe(true);
  });
  it("NO trata 'procesando tu pedido' solo como pedido (el bot lo dice aunque el cliente decline)", () => {
    const t = [msg("outbound", "nos encontramos procesando tu pedido, confirmame si estos datos son correctos para despacharlo")];
    expect(detectOrderInTranscript(t)).toBe(false);
  });
  it("NO confunde el carrito abandonado (aun no confirmado) con un pedido", () => {
    const t = [msg("outbound", "Estamos un poquito tristes, porque aun no has confirmado tu compra. no queremos tener que cancelar tu pedido, ayudanos a evitarlo")];
    expect(detectOrderInTranscript(t)).toBe(false);
  });
  it("NO se dispara con mensajes PRE-pedido (pidiendo datos)", () => {
    const t = [
      msg("outbound", "Para hacer tu pedido, necesito tu nombre y direccion de entrega"),
      msg("inbound", "Juan, Alajuela"),
    ];
    expect(detectOrderInTranscript(t)).toBe(false);
  });
  it("ignora frases que vengan del cliente (inbound)", () => {
    expect(detectOrderInTranscript([msg("inbound", "ya confirmamos tu pedido")])).toBe(false);
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
  it("caso Alfredo: sale_state order_created + etiqueta 'requiere humano' -> GANADO, no por_cerrar", () => {
    const c = classifyConversation(
      makeConv({
        saleStage: "order_created",
        saleOrderId: "234279",
        labels: ["Revisión de dirección", "Revisión humana"],
        lastMessageText: "Gracias",
        lastMessageSender: "customer",
      })
    );
    expect(c.status).toBe("pedido_en_curso");
    expect(c.category).toBe("won");
    expect(statusBoardStage(c.status)).toBe("cerrado");
  });
  it("sale_state order_id presente sin stage explicito -> ganado", () => {
    const c = classifyConversation(makeConv({ saleOrderId: "999" }));
    expect(c.category).toBe("won");
  });
  it("collecting_data -> por_cerrar", () => {
    const c = classifyConversation(makeConv({ saleStage: "collecting_data" }));
    expect(statusBoardStage(c.status)).toBe("por_cerrar");
  });
  it("pending_payment -> por_cerrar", () => {
    const c = classifyConversation(makeConv({ saleStage: "pending_payment" }));
    expect(statusBoardStage(c.status)).toBe("por_cerrar");
  });
  it("product_selected -> tibios (sin trabajar aun)", () => {
    const c = classifyConversation(makeConv({ saleStage: "product_selected" }));
    expect(statusBoardStage(c.status)).toBe("tibios");
  });
  it("conversando/nuevo -> tibios; los estados manuales -> seguimiento", () => {
    expect(statusBoardStage("conversando")).toBe("tibios");
    expect(statusBoardStage("nuevo")).toBe("tibios");
    expect(statusBoardStage("no_responde")).toBe("seguimiento");
    expect(statusBoardStage("volver_a_llamar")).toBe("seguimiento");
  });
  it("warranty claim -> descartado (postventa)", () => {
    const c = classifyConversation(makeConv({ warrantyClaimId: "12" }));
    expect(c.status).toBe("postventa");
    expect(statusBoardStage(c.status)).toBe("descartado");
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

  // Los estados PROTEGIDOS son decisiones de una persona sobre el trato con ese
  // cliente, no una lectura del embudo. Que compre no las deshace: sacarlo de
  // lista negra por un pedido borraria el motivo por el que lo pusieron ahi.
  it.each(["lista_negra", "cancelado_cliente", "cancelado"])(
    "LEY 2: ni una compra real saca a un lead de %s",
    (status) => {
      const protegido: LeadStateSnapshot = {
        category: "lost",
        status,
        statusSource: "manual",
        hasOrder: false,
        hasCartSignal: false,
      };
      const incoming = classifyConversation(makeConv(), { hasShopifyOrder: true });
      expect(nextLeadState(protegido, incoming)).toBeNull();
    }
  );

  it("LEY 2: el resto de los estados manuales SI los gana la compra", () => {
    // Un 'no responde' o un 'volver a llamar' que despues compra es una venta,
    // y hasta ahora se quedaba atascado en el tablero.
    for (const status of ["contactado_dejo_wsp", "volver_a_llamar", "buzon", "sin_stock"]) {
      const snap: LeadStateSnapshot = { ...manualSnap, status };
      const incoming = classifyConversation(makeConv(), { hasShopifyOrder: true });
      expect(nextLeadState(snap, incoming)?.category).toBe("won");
    }
  });

  it("'Ya tiene pedido' es una gestion valida y cierra el lead como GANADO", () => {
    // La marca la asesora cuando al llamar descubre que el cliente ya tiene
    // pedido en curso. Es la unica salida ganada que se pone a mano.
    expect(isValidDisposition("ya_tiene_pedido")).toBe(true);
    expect(statusCategory("ya_tiene_pedido")).toBe("won");
    expect(statusBoardStage("ya_tiene_pedido")).toBe("cerrado");
    expect(DISPOSITION_OPTIONS.some((o) => o.code === "ya_tiene_pedido")).toBe(true);
  });

  it("'Ya tiene pedido' NO agenda recontacto: sale de la Agenda", () => {
    // Viene justo de ahi: si dejara fecha agendada, el lead volveria a la cola
    // aunque ya no haya nada que trabajar.
    expect(schedulesFollowup("ya_tiene_pedido")).toBe(false);
    expect(defaultFollowupForStatus("ya_tiene_pedido", new Date("2026-08-25T10:00:00Z"))).toBeNull();
  });

  it("isProtectedFromPurchase distingue protegidos de manuales comunes", () => {
    expect(isProtectedFromPurchase("lista_negra")).toBe(true);
    expect(isProtectedFromPurchase("cancelado_cliente")).toBe(true);
    expect(isProtectedFromPurchase("cancelado")).toBe(true);
    expect(isProtectedFromPurchase("contactado_dejo_wsp")).toBe(false);
    expect(isProtectedFromPurchase("")).toBe(false);
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

describe("dispositions (resultado de la llamada)", () => {
  it("todas las opciones del desplegable estan en el catalogo de estados", () => {
    for (const opt of DISPOSITION_OPTIONS) {
      expect(["won", "hot", "open", "lost"]).toContain(statusCategory(opt.code));
    }
  });
  it("incluye los estados nuevos del panel de CR", () => {
    const codes = DISPOSITION_OPTIONS.map((o) => o.code);
    expect(codes).toContain("solo_miraba");
    expect(codes).toContain("nr_extranjero");
    expect(codes).toContain("otros_productos");
    expect(codes).toContain("repetido");
    expect(codes).toContain("fuera_de_ciudad");
  });
  it("valida codigos de disposicion", () => {
    expect(isValidDisposition("no_responde")).toBe(true);
    expect(isValidDisposition("inventado")).toBe(false);
  });
  it("solo casi_cierra y volver_a_llamar agendan seguimiento", () => {
    expect(schedulesFollowup("casi_cierra")).toBe(true);
    expect(schedulesFollowup("volver_a_llamar")).toBe(true);
    expect(schedulesFollowup("no_responde")).toBe(false);
  });
});

describe("defaultFollowupAt (hora CR, UTC-6)", () => {
  it("antes de las 16:00 CR -> hoy 18:00 CR (00:00 UTC dia siguiente)", () => {
    // 2026-07-20 10:00 CR = 16:00 UTC
    const now = new Date("2026-07-20T16:00:00Z");
    const iso = defaultFollowupAt(now);
    // 18:00 CR = 00:00 UTC del 21
    expect(iso).toBe("2026-07-21T00:00:00.000Z");
  });
  it("despues de las 16:00 CR -> manana 10:00 CR (16:00 UTC dia siguiente)", () => {
    // 2026-07-20 17:00 CR = 23:00 UTC
    const now = new Date("2026-07-20T23:00:00Z");
    const iso = defaultFollowupAt(now);
    // manana 10:00 CR = 16:00 UTC del 21
    expect(iso).toBe("2026-07-21T16:00:00.000Z");
  });
});

describe("defaultFollowupForStatus (reintento automatico)", () => {
  const now = new Date("2026-07-20T16:00:00Z");
  it("casi_cierra / volver_a_llamar usan la regla del panel", () => {
    expect(defaultFollowupForStatus("casi_cierra", now)).toBe(defaultFollowupAt(now));
    expect(defaultFollowupForStatus("volver_a_llamar", now)).toBe(defaultFollowupAt(now));
  });
  it("no contesto (no_responde/buzon/cuelga) agenda reintento a las 24h", () => {
    expect(defaultFollowupForStatus("no_responde", now)).toBe("2026-07-21T16:00:00.000Z");
    expect(defaultFollowupForStatus("buzon", now)).toBe("2026-07-21T16:00:00.000Z");
    expect(defaultFollowupForStatus("cuelga", now)).toBe("2026-07-21T16:00:00.000Z");
  });
  it("estados terminales o informativos no agendan nada", () => {
    expect(defaultFollowupForStatus("contactado_dejo_wsp", now)).toBeNull();
    expect(defaultFollowupForStatus("sin_stock", now)).toBeNull();
    expect(defaultFollowupForStatus("cancelado", now)).toBeNull();
  });
});
