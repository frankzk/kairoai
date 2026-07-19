// Logica pura de clasificacion y maquina de estados del modulo de Leads.
// Portado de docs/leads-spec/03-maquina-de-estados.md y adaptado a Costa Rica
// (SINPE en vez de Yape) y a las senales reales que expone Icomfly /api/chat.
//
// Sin efectos secundarios ni acceso a DB -> testeable (tests/leads-classify.test.ts).

import type {
  Classification,
  IcomflyConversation,
  LeadCategory,
  LeadStateSnapshot,
} from "./leads-types";

// ─── Catalogo de estados ─────────────────────────────────────────────────────
// source 'auto' = solo la ingesta/clasificador lo pone; 'manual' = la vendedora.
// callable = aparece en las colas de trabajo del tablero.
export interface StatusDef {
  code: string;
  label: string;
  category: LeadCategory;
  source: "auto" | "manual";
  callable: boolean;
  /** Bucket del tablero: como se agrupa para priorizar el cierre. */
  board: BoardStage;
}

export type BoardStage =
  | "por_cerrar" // dio datos, falta cerrar
  | "pago_verificar" // SINPE por verificar
  | "carrito" // carrito abandonado
  | "seguimiento" // conversando / tibio / gestion manual pendiente
  | "frio" // frio, minimo contacto
  | "ganado" // ya compro -> oculto, sin gestion
  | "descartado"; // terminal, sin gestion

export const LEAD_STATUSES: StatusDef[] = [
  // won (oculto, sin gestion)
  { code: "pedido_generado", label: "Pedido generado", category: "won", source: "auto", callable: false, board: "ganado" },
  { code: "ya_tiene_pedido", label: "Ya tiene pedido", category: "won", source: "auto", callable: false, board: "ganado" },
  { code: "venta_por_bot", label: "Venta por bot", category: "won", source: "auto", callable: false, board: "ganado" },
  { code: "carrito_recuperado", label: "Carrito recuperado", category: "won", source: "auto", callable: false, board: "ganado" },
  // hot (accionable, prioridad alta)
  { code: "sinpe_por_verificar", label: "SINPE por verificar", category: "hot", source: "auto", callable: true, board: "pago_verificar" },
  { code: "por_cerrar", label: "Por cerrar", category: "hot", source: "auto", callable: true, board: "por_cerrar" },
  { code: "casi_cierra", label: "Casi cierra", category: "hot", source: "auto", callable: true, board: "por_cerrar" },
  // open (auto)
  { code: "carrito_abandonado", label: "Carrito abandonado", category: "open", source: "auto", callable: true, board: "carrito" },
  { code: "conversando", label: "Conversando", category: "open", source: "auto", callable: true, board: "seguimiento" },
  { code: "nuevo", label: "Nuevo", category: "open", source: "auto", callable: true, board: "seguimiento" },
  { code: "frio", label: "Frio", category: "open", source: "auto", callable: true, board: "frio" },
  // open (manual)
  { code: "contactado_dejo_wsp", label: "Contactado / dejo WhatsApp", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "no_responde", label: "No responde", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "cuelga", label: "Cuelga", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "buzon", label: "Buzon", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "volver_a_llamar", label: "Volver a llamar", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "en_espera_direccion", label: "En espera de direccion", category: "open", source: "manual", callable: true, board: "por_cerrar" },
  { code: "sin_stock", label: "Sin stock", category: "open", source: "manual", callable: true, board: "seguimiento" },
  // lost / descartado (terminal)
  { code: "cancelado_cliente", label: "Cancelado por cliente", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "cancelado", label: "Cancelado", category: "lost", source: "auto", callable: false, board: "descartado" },
  { code: "ya_compro_otro_lado", label: "Ya compro en otro lado", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "solo_informacion", label: "Solo informacion", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "fuera_de_pais", label: "Fuera del pais", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "lista_negra", label: "Lista negra", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "nr_no_existe", label: "Numero no existe", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "duplicado", label: "Duplicado", category: "lost", source: "auto", callable: false, board: "descartado" },
];

const STATUS_BY_CODE = new Map(LEAD_STATUSES.map((s) => [s.code, s]));

export function getStatusDef(code: string): StatusDef | undefined {
  return STATUS_BY_CODE.get(code);
}

export function statusCategory(code: string): LeadCategory {
  return STATUS_BY_CODE.get(code)?.category ?? "open";
}

export function statusBoardStage(code: string): BoardStage {
  return STATUS_BY_CODE.get(code)?.board ?? "seguimiento";
}

export function isManualStatus(code: string): boolean {
  return STATUS_BY_CODE.get(code)?.source === "manual";
}

// ─── Mapeo de las etiquetas de Icomfly (93 libres) a senales limpias ─────────
// Se evalua por prioridad (primero que matchea gana). Los patrones son
// substrings normalizados (sin acentos, minusculas).
interface LabelRule {
  pattern: RegExp;
  status: string;
  reason: string;
}

const LABEL_RULES: LabelRule[] = [
  { pattern: /lista negra/, status: "lista_negra", reason: "etiqueta: lista negra" },
  { pattern: /carrito .*recuperad|recuperad.* carrito|carrito abandonado recuperado/, status: "carrito_recuperado", reason: "etiqueta: carrito recuperado" },
  { pattern: /duplicad|ya tiene orden|ya tiene una orden|numero diferente/, status: "duplicado", reason: "etiqueta: duplicado" },
  { pattern: /venta por bot|pedido shopify/, status: "venta_por_bot", reason: "etiqueta: venta por bot" },
  { pattern: /requerimiento humano|revision humana|revisi.n humana/, status: "por_cerrar", reason: "etiqueta: requiere humano" },
  { pattern: /falta (la )?direc|espera de direc|falta subir|subir|falta que envie|falta la ubicacion|revision de direc|revisi.n de direc/, status: "en_espera_direccion", reason: "etiqueta: falta direccion/subir" },
  { pattern: /sin stock/, status: "sin_stock", reason: "etiqueta: sin stock" },
  { pattern: /carrito abandonado|carrito sin recuperar/, status: "carrito_abandonado", reason: "etiqueta: carrito abandonado" },
  { pattern: /no tiene dinero|vaa cuadrar|va a cuadrar/, status: "volver_a_llamar", reason: "etiqueta: sin dinero / volver a llamar" },
  { pattern: /fuera del pais|fuera de pais|esta fuera del pais/, status: "fuera_de_pais", reason: "etiqueta: fuera del pais" },
  { pattern: /reclamo|devoluc|novedad/, status: "conversando", reason: "etiqueta: postventa/novedad" },
];

function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Devuelve la primera regla de etiqueta que matchea, o null. */
export function classifyByLabels(labels: string[]): { status: string; reason: string } | null {
  const norm = labels.map(normalizeLabel);
  for (const rule of LABEL_RULES) {
    if (norm.some((l) => rule.pattern.test(l))) {
      return { status: rule.status, reason: rule.reason };
    }
  }
  return null;
}

// ─── Deteccion de pago adelantado (SINPE) por texto ──────────────────────────
const SINPE_RE = /\b(sinpe|ya (te )?(hice|pase|envie) el sinpe|transferi|transferencia|ya pague|deposit)/i;

export function detectSinpeText(text: string | null | undefined): boolean {
  return Boolean(text && SINPE_RE.test(text));
}

// ─── Clasificacion de una conversacion (senales de la lista, sin abrir chat) ──
// Prioridad (mayor gana): won > lost/descartado > sinpe > por_cerrar >
// carrito > conversando > nuevo/frio. Solo usa campos de la lista para ser
// barato sobre 15k+ conversaciones; la IA sobre el transcript es Fase 4.
export function classifyConversation(
  conv: IcomflyConversation,
  ctx: { hasShopifyOrder?: boolean } = {}
): Classification {
  const cartSignal =
    Boolean(conv.abandonedCartId) || conv.abandonedCartCount > 0 || labelsSayCart(conv.labels);
  const base = (status: string, reason: string): Classification => ({
    category: statusCategory(status),
    status,
    autoReason: reason,
    hasCartSignal: cartSignal,
  });

  // 1) Orden confirmada (Shopify por telefono) -> ganado, oculto.
  if (ctx.hasShopifyOrder) return base("pedido_generado", "orden de Shopify enlazada por telefono");

  // 2) Etiquetas del equipo (won/lost/senales fuertes).
  const byLabel = classifyByLabels(conv.labels);
  if (byLabel) return base(byLabel.status, byLabel.reason);

  // 3) Conversacion cerrada en Icomfly sin senal previa -> descartado suave.
  if (conv.closedAt) {
    return base("cancelado", `conversacion cerrada en Icomfly${conv.closedReason ? `: ${conv.closedReason}` : ""}`);
  }

  // 4) Pago adelantado detectado en el ultimo mensaje.
  if (detectSinpeText(conv.lastMessageText)) {
    return base("sinpe_por_verificar", "SINPE detectado en el ultimo mensaje");
  }

  // 5) Humano tomo el chat (bot desactivado) -> por cerrar.
  if (conv.chatbotDisabled) {
    return base("por_cerrar", "chatbot desactivado: humano gestionando");
  }

  // 6) Senal de carrito -> carrito abandonado.
  if (cartSignal) return base("carrito_abandonado", "carrito abandonado (senal de Icomfly)");

  // 7) Conversando: el cliente escribio ultimo o hay no leidos.
  if (isInbound(conv.lastMessageSender) || conv.unreadCount > 0) {
    return base("conversando", "cliente con mensaje sin responder");
  }

  // 8) Frio si el ultimo contacto es viejo; si es reciente, nuevo.
  if (isStale(conv.lastMessageAt)) return base("frio", "sin actividad reciente");
  return base("nuevo", "conversacion nueva sin gestionar");
}

function labelsSayCart(labels: string[]): boolean {
  return labels.map(normalizeLabel).some((l) => /carrito abandonado|carrito sin recuperar/.test(l) && !/recuperado/.test(l));
}

function isInbound(sender: string): boolean {
  const s = sender.toLowerCase();
  return s === "contact" || s === "customer" || s === "client" || s === "cliente" || s === "inbound";
}

function isStale(lastAt: string | null, now: number = Date.now(), hours = 48): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  if (Number.isNaN(t)) return true;
  return now - t > hours * 3600_000;
}

// ─── Las 4 leyes: proxima transicion al ingerir/actualizar ───────────────────
// Devuelve el nuevo status a aplicar, o null si NO se debe tocar el lead.
//
//  Ley 1: deriveAutoState -> la clasificacion propone un estado auto.
//  Ley 2: un estado MANUAL nunca lo pisa la ingesta (salvo compra real nueva).
//  Ley 3: won es pegajoso; no se degrada solo mientras haya orden activa.
//  Ley 4: reapertura -> un evento nuevo del cliente con carrito puede reabrir
//         un lost/won viejo (se maneja con el flag reopen).
export function nextLeadState(
  current: LeadStateSnapshot | null,
  incoming: Classification,
  opts: { reopen?: boolean } = {}
): { status: string; category: LeadCategory; reason: string } | null {
  // Lead nuevo: aplica la clasificacion tal cual.
  if (!current) {
    return { status: incoming.status, category: incoming.category, reason: incoming.autoReason };
  }

  const incomingIsPurchase = incoming.category === "won";

  // Ley 2: estado manual intocable, EXCEPTO una compra real nueva.
  if (current.statusSource === "manual") {
    if (incomingIsPurchase && !current.hasOrder) {
      return { status: incoming.status, category: incoming.category, reason: `compra real gana sobre estado manual: ${incoming.autoReason}` };
    }
    return null;
  }

  // Ley 3: won pegajoso. No degradar un won auto salvo que llegue otra compra
  // (misma categoria) o una reapertura explicita con carrito.
  if (current.category === "won" && current.hasOrder) {
    if (incomingIsPurchase) {
      return { status: incoming.status, category: incoming.category, reason: incoming.autoReason };
    }
    if (opts.reopen && incoming.hasCartSignal) {
      return { status: incoming.status, category: incoming.category, reason: `reapertura por carrito nuevo: ${incoming.autoReason}` };
    }
    return null;
  }

  // Ley 4: reabrir un lost con carrito ante evento nuevo del cliente.
  if (current.category === "lost" && !incomingIsPurchase) {
    if (opts.reopen && incoming.hasCartSignal) {
      return { status: incoming.status, category: incoming.category, reason: `reapertura de lost por carrito: ${incoming.autoReason}` };
    }
    // No re-clasificar automaticamente un lost salvo compra real.
    return null;
  }

  // Estado auto no terminal: si la clasificacion cambia, actualizar.
  if (incoming.status !== current.status) {
    return { status: incoming.status, category: incoming.category, reason: incoming.autoReason };
  }
  return null;
}

// ─── Tabs del tablero ────────────────────────────────────────────────────────
export interface BoardView {
  key: BoardStage;
  label: string;
  hiddenByDefault?: boolean;
}

export const BOARD_VIEWS: BoardView[] = [
  { key: "por_cerrar", label: "Por cerrar" },
  { key: "pago_verificar", label: "Pago por verificar" },
  { key: "carrito", label: "Carritos" },
  { key: "seguimiento", label: "Seguimiento" },
  { key: "frio", label: "Frios" },
  { key: "ganado", label: "Ganados", hiddenByDefault: true },
  { key: "descartado", label: "Descartados", hiddenByDefault: true },
];

/** Orden de prioridad de los buckets para "a quien contacto ahora". */
export const BOARD_STAGE_PRIORITY: BoardStage[] = [
  "pago_verificar",
  "por_cerrar",
  "carrito",
  "seguimiento",
  "frio",
  "ganado",
  "descartado",
];
