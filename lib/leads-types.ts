// Tipos compartidos del modulo de Leads. Sin imports para que server y client
// (y los tests) los usen sin acoplarse a la capa de datos.

export type LeadCategory = "won" | "hot" | "open" | "lost";
export type StatusSource = "auto" | "manual";

/** Vista normalizada de una conversacion de Icomfly (adaptador /api/chat). */
export interface IcomflyConversation {
  id: string;
  contactId: string | null;
  phone: string | null; // crudo, sin normalizar
  displayName: string;
  platform: string;
  status: string; // estado de la conversacion en Icomfly
  assignedTo: string | null;
  lastMessageText: string;
  lastMessageAt: string | null;
  lastMessageSender: string; // 'contact' | 'agent' | 'bot' | ...
  unreadCount: number;
  priority: string;
  chatbotDisabled: boolean;
  abandonedCartId: string | null;
  abandonedCartCount: number;
  recoveredCartCount: number;
  // Estado de venta que trackea el bot de Icomfly (metadata.sale_state):
  // browsing | product_selected | collecting_data | pending_payment | order_created
  saleStage: string | null;
  saleOrderId: string | null; // id de pedido en Icomfly cuando se creo
  paymentMethod: string | null; // Contraentrega | Sinpe | ...
  warrantyClaimId: string | null; // reclamo de garantia (postventa)
  labels: string[];
  closedAt: string | null;
  closedReason: string | null;
  lastReopenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  waPhoneNumberId: string | null;
  storeCountry: string;
  raw: Record<string, unknown>;
}

/** Mensaje normalizado (alimenta drawer, parsers y enriquecimiento). */
export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  timestamp: number; // epoch ms
  text?: string;
  mediaKind?: "image" | "audio" | "video" | "document" | "sticker";
  mediaUrl?: string;
  caption?: string;
  template?: string;
}

/** Resultado de clasificar una conversacion (estado auto propuesto). */
export interface Classification {
  category: LeadCategory;
  status: string;
  autoReason: string;
  hasCartSignal: boolean;
}

/** Estado actual de un lead relevante para decidir la proxima transicion. */
export interface LeadStateSnapshot {
  category: LeadCategory;
  status: string;
  statusSource: StatusSource;
  hasOrder: boolean;
  hasCartSignal: boolean;
}
