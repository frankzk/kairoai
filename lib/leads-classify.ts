// Logica pura de clasificacion y maquina de estados del modulo de Leads.
// Portado de docs/leads-spec/03-maquina-de-estados.md y adaptado a Costa Rica
// (SINPE en vez de Yape) y a las senales reales que expone Icomfly /api/chat.
//
// Sin efectos secundarios ni acceso a DB -> testeable (tests/leads-classify.test.ts).

import type {
  Classification,
  ConversationMessage,
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
  | "tibios" // escribieron pero nadie los ha trabajado aun
  | "seguimiento" // ya trabajados por la asesora, en seguimiento
  | "frio" // frio, minimo contacto
  | "cerrado" // ya tiene pedido -> fuera de las colas de venta
  | "descartado"; // terminal, sin gestion

export const LEAD_STATUSES: StatusDef[] = [
  // won -> bucket Cerrados: ya hay un pedido, no hay nada que venderle.
  { code: "pedido_generado", label: "Pedido generado", category: "won", source: "auto", callable: false, board: "cerrado" },
  { code: "pedido_en_curso", label: "Pedido en curso", category: "won", source: "auto", callable: false, board: "cerrado" },
  // Lo pone la asesora cuando al llamar descubre que el cliente ya tiene un
  // pedido en curso (tipico en Agenda: se agendo el recontacto y para cuando
  // llega la llamada, el pedido ya existe). Es la unica salida GANADA que se
  // marca a mano; el resto de los won los pone la ingesta.
  { code: "ya_tiene_pedido", label: "Ya tiene pedido", category: "won", source: "manual", callable: false, board: "cerrado" },
  { code: "venta_por_bot", label: "Venta por bot", category: "won", source: "auto", callable: false, board: "cerrado" },
  { code: "carrito_recuperado", label: "Carrito recuperado", category: "won", source: "auto", callable: false, board: "cerrado" },
  // hot (accionable, prioridad alta)
  { code: "sinpe_por_verificar", label: "SINPE por verificar", category: "hot", source: "auto", callable: true, board: "pago_verificar" },
  { code: "por_cerrar", label: "Por cerrar", category: "hot", source: "auto", callable: true, board: "por_cerrar" },
  { code: "casi_cierra", label: "Casi cierra", category: "hot", source: "auto", callable: true, board: "por_cerrar" },
  // open (auto)
  { code: "carrito_abandonado", label: "Carrito abandonado", category: "open", source: "auto", callable: true, board: "carrito" },
  { code: "conversando", label: "Conversando", category: "open", source: "auto", callable: true, board: "tibios" },
  { code: "nuevo", label: "Nuevo", category: "open", source: "auto", callable: true, board: "tibios" },
  { code: "frio", label: "Frio", category: "open", source: "auto", callable: true, board: "frio" },
  // open (manual)
  { code: "contactado_dejo_wsp", label: "Contactado, dejo WhatsApp", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "no_responde", label: "No responde (NR)", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "cuelga", label: "Cuelga", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "buzon", label: "Buzon de voz", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "volver_a_llamar", label: "Volver a llamar", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "en_espera_direccion", label: "En espera de direccion", category: "open", source: "manual", callable: true, board: "por_cerrar" },
  { code: "sin_stock", label: "Sin stock", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "otros_productos", label: "Consulto otros productos", category: "open", source: "manual", callable: true, board: "seguimiento" },
  { code: "repetido", label: "Repetido", category: "open", source: "manual", callable: true, board: "seguimiento" },
  // lost / descartado (terminal)
  { code: "cancelado_cliente", label: "Cancelado por cliente", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "cancelado", label: "Cancelado", category: "lost", source: "auto", callable: false, board: "descartado" },
  { code: "ya_compro_otro_lado", label: "Ya compro en otro lado", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "solo_informacion", label: "Solo queria informacion", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "solo_miraba", label: "Solo miraba", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "fuera_de_ciudad", label: "Fuera de la ciudad", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "lista_negra", label: "Lista negra", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "nr_no_existe", label: "Numero no existe / incorrecto", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "nr_extranjero", label: "Numero extranjero", category: "lost", source: "manual", callable: false, board: "descartado" },
  { code: "duplicado", label: "Duplicado", category: "lost", source: "auto", callable: false, board: "descartado" },
  { code: "postventa", label: "Postventa / garantia", category: "lost", source: "auto", callable: false, board: "descartado" },
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

/**
 * Codigos de estado que caen en este bucket por su status. Lo usa la capa de
 * datos para filtrar EN EL SERVIDOR (Postgres) en vez de traerse la tabla
 * entera y descartar en memoria.
 */
export function statusesForBoard(stage: BoardStage): string[] {
  return LEAD_STATUSES.filter((s) => s.board === stage).map((s) => s.code);
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
  // 'strong' = senal definitiva de won/lost (se evalua antes que sale_state);
  // 'human'  = requiere humano / falta direccion -> por cerrar (despues);
  // 'cart'   = senal de carrito (la cubre cartSignal, no particiona aparte).
  tier: "strong" | "human" | "cart";
}

const LABEL_RULES: LabelRule[] = [
  { pattern: /lista negra/, status: "lista_negra", reason: "etiqueta: lista negra", tier: "strong" },
  { pattern: /carrito .*recuperad|recuperad.* carrito|carrito abandonado recuperado/, status: "carrito_recuperado", reason: "etiqueta: carrito recuperado", tier: "strong" },
  { pattern: /duplicad|ya tiene orden|ya tiene una orden|numero diferente/, status: "duplicado", reason: "etiqueta: duplicado", tier: "strong" },
  { pattern: /venta por bot|pedido shopify/, status: "venta_por_bot", reason: "etiqueta: venta por bot", tier: "strong" },
  { pattern: /sin stock/, status: "sin_stock", reason: "etiqueta: sin stock", tier: "strong" },
  { pattern: /fuera del pais|fuera de pais|esta fuera del pais|fuera de la ciudad|fuera de ciudad/, status: "fuera_de_ciudad", reason: "etiqueta: fuera de la ciudad", tier: "strong" },
  { pattern: /requerimiento humano|revision humana|revisi.n humana/, status: "por_cerrar", reason: "etiqueta: requiere humano", tier: "human" },
  { pattern: /falta (la )?direc|espera de direc|falta subir|subir|falta que envie|falta la ubicacion|revision de direc|revisi.n de direc/, status: "en_espera_direccion", reason: "etiqueta: falta direccion/subir", tier: "human" },
  { pattern: /no tiene dinero|vaa cuadrar|va a cuadrar/, status: "volver_a_llamar", reason: "etiqueta: sin dinero / volver a llamar", tier: "human" },
  { pattern: /carrito abandonado|carrito sin recuperar/, status: "carrito_abandonado", reason: "etiqueta: carrito abandonado", tier: "cart" },
];

function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function matchLabelRules(labels: string[], tiers: LabelRule["tier"][]): { status: string; reason: string } | null {
  const norm = labels.map(normalizeLabel);
  for (const rule of LABEL_RULES) {
    if (!tiers.includes(rule.tier)) continue;
    if (norm.some((l) => rule.pattern.test(l))) {
      return { status: rule.status, reason: rule.reason };
    }
  }
  return null;
}

/** Todas las reglas (compat + uso general). Primera que matchea gana. */
export function classifyByLabels(labels: string[]): { status: string; reason: string } | null {
  return matchLabelRules(labels, ["strong", "human", "cart"]);
}

/** Solo etiquetas definitivas de won/lost (se evaluan antes que sale_state). */
export function classifyByStrongLabels(labels: string[]): { status: string; reason: string } | null {
  return matchLabelRules(labels, ["strong"]);
}

/** Etiquetas de "requiere humano" / falta direccion -> por cerrar. */
export function classifyByHumanLabels(labels: string[]): { status: string; reason: string } | null {
  return matchLabelRules(labels, ["human"]);
}

// ─── Deteccion de pedido YA confirmado, leyendo el transcript ────────────────
// Para conversaciones sin metadata.sale_state (p.ej. pedidos viejos o creados
// por otro flujo), el bot igual deja mensajes inequivocos de que el pedido
// existe/se envio. Solo miramos mensajes SALIENTES (bot/negocio) y frases que
// implican un pedido YA creado/confirmado/enviado (no "para hacer tu pedido...").
// SOLO senales CONFIABLES: el pedido llego a logistica (guia/enviado/Moovin) o
// el bot confirmo explicitamente. Se descartaron a proposito frases de apertura
// como "hemos recibido tu pedido" / "procesando tu pedido" / "para despacharte"
// porque el bot las manda AUNQUE el cliente luego decline (visto en produccion:
// clientes que reciben esas frases y responden "no lo voy a pedir").
const ORDER_CONFIRMED_RES: RegExp[] = [
  /numero de guia|tu guia es|guia es \d|cuando tengamos (la guia|el numero de guia)/,
  /acabamos de enviar tu pedido|enviamos tu pedido|hemos enviado tu pedido|ya enviamos tu pedido/,
  /ya confirmamos tu pedido|pedido (ya )?(esta|quedo) confirmado|pedido confirmado/,
  /recordatorio.*pedido|para la entrega de tu|se comunicaron contigo de moovin/,
];

function normText(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** true si el transcript evidencia un pedido ya confirmado/enviado. */
export function detectOrderInTranscript(messages: ConversationMessage[]): boolean {
  for (const m of messages) {
    if (m.direction !== "outbound" || !m.text) continue;
    const t = normText(m.text);
    if (ORDER_CONFIRMED_RES.some((re) => re.test(t))) return true;
  }
  return false;
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
  const stage = (conv.saleStage ?? "").toLowerCase();

  // 1) Ya es pedido -> GANADO (oculto, sin gestion). Prioridad maxima para que
  //    NO caiga en "por cerrar" aunque tenga etiqueta "requiere humano":
  //    (a) orden de Shopify por telefono, (b) el bot marco la venta creada.
  if (ctx.hasShopifyOrder) return base("pedido_generado", "orden de Shopify enlazada por telefono");
  if (stage === "order_created" || conv.saleOrderId) {
    return base("pedido_en_curso", `pedido creado en Icomfly${conv.saleOrderId ? ` (#${conv.saleOrderId})` : ""}`);
  }

  // 2) Postventa (reclamo de garantia) -> no es gestion de venta.
  if (conv.warrantyClaimId) return base("postventa", "reclamo de garantia (postventa)");

  // 3) Etiquetas fuertes del equipo (won/lost: lista negra, duplicado,
  //    carrito recuperado). Las de "requiere humano"/"falta direccion" se
  //    dejan para despues de las senales de sale_state.
  const strongLabel = classifyByStrongLabels(conv.labels);
  if (strongLabel) return base(strongLabel.status, strongLabel.reason);

  // 4) Conversacion cerrada en Icomfly sin senal previa -> descartado suave.
  if (conv.closedAt) {
    return base("cancelado", `conversacion cerrada en Icomfly${conv.closedReason ? `: ${conv.closedReason}` : ""}`);
  }

  // 5) Pago adelantado (SINPE) detectado en el ultimo mensaje -> verificar.
  if (detectSinpeText(conv.lastMessageText)) {
    return base("sinpe_por_verificar", "SINPE detectado en el ultimo mensaje");
  }

  // 6) Dando datos / esperando pago, o humano gestionando -> POR CERRAR.
  if (stage === "collecting_data") return base("por_cerrar", "cliente dando sus datos (falta cerrar)");
  if (stage === "pending_payment") return base("por_cerrar", "esperando metodo de pago (falta cerrar)");
  const humanLabel = classifyByHumanLabels(conv.labels);
  if (humanLabel) return base(humanLabel.status, humanLabel.reason);
  if (conv.chatbotDisabled) return base("por_cerrar", "chatbot desactivado: humano gestionando");

  // 7) Eligio producto pero aun no da datos -> seguimiento (empujar).
  if (stage === "product_selected") return base("conversando", "eligio producto, falta cerrar");

  // 8) Senal de carrito -> carrito abandonado.
  if (cartSignal) return base("carrito_abandonado", "carrito abandonado (senal de Icomfly)");

  // 9) Conversando: el cliente escribio ultimo o hay no leidos.
  if (isInbound(conv.lastMessageSender) || conv.unreadCount > 0) {
    return base("conversando", "cliente con mensaje sin responder");
  }

  // 10) Solo mirando / sin actividad -> frio; si es reciente, nuevo.
  if (stage === "browsing" && isStale(conv.lastMessageAt)) return base("frio", "solo mirando, sin actividad reciente");
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
//  Ley 2: un estado MANUAL nunca lo pisa la ingesta (salvo compra real nueva,
//         y nunca si el estado esta PROTEGIDO).
//  Ley 3: won es pegajoso; no se degrada solo mientras haya orden activa.
//  Ley 4: reapertura -> un evento nuevo del cliente con carrito puede reabrir
//         un lost/won viejo (se maneja con el flag reopen).
/**
 * Estados que una compra real NO revierte, aunque el cliente termine comprando.
 * Son decisiones explicitas de una persona sobre el trato con ese cliente, no
 * una lectura del embudo: sacar a alguien de lista negra porque hizo un pedido
 * borraria justo el motivo por el que lo pusieron ahi.
 *
 * El resto de los estados manuales SI los gana la compra: alguien marcado
 * "no responde" o "volver a llamar" que despues compra es, sencillamente, una
 * venta.
 *
 * Esta lista la comparten el clasificador (aca) y el cruce por telefono contra
 * Shopify (RPC match_leads_to_shopify_orders, migracion 0030). Si cambia una,
 * tiene que cambiar la otra.
 */
export const PURCHASE_PROOF_STATUSES = ["lista_negra", "cancelado_cliente", "cancelado"] as const;

export function isProtectedFromPurchase(status: string): boolean {
  return (PURCHASE_PROOF_STATUSES as readonly string[]).includes(String(status ?? ""));
}

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

  // Ley 2: estado manual intocable, EXCEPTO una compra real nueva -- y salvo
  // los estados PROTEGIDOS, que son una decision de la persona que ni una
  // compra debe deshacer (ver PURCHASE_PROOF_STATUSES).
  if (current.statusSource === "manual") {
    if (incomingIsPurchase && !current.hasOrder && !isProtectedFromPurchase(current.status)) {
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

// ─── Tabs del tablero ────────────────────────────────────────────────────────
export interface BoardView {
  key: BoardStage;
  label: string;
  hiddenByDefault?: boolean;
}

// Orden de prioridad de los buckets para "a quien contacto ahora" (usado por la cola).
export const BOARD_STAGE_PRIORITY: BoardStage[] = [
  "pago_verificar",
  "por_cerrar",
  "carrito",
  "tibios",
  "seguimiento",
  "frio",
  "cerrado",
  "descartado",
];

// Tabs del tablero en orden de prioridad real (pago_verificar primero).
export const BOARD_VIEWS: BoardView[] = [
  { key: "pago_verificar", label: "Pago por verificar" },
  { key: "por_cerrar", label: "Por cerrar" },
  { key: "carrito", label: "Carritos" },
  { key: "tibios", label: "Tibios" },
  { key: "seguimiento", label: "Seguimiento" },
  { key: "frio", label: "Fríos" },
  // Cerrados va VISIBLE: la asesora necesita ver adonde se fue lo que ya tiene
  // pedido, no que desaparezca. Descartados sigue detras del toggle.
  { key: "cerrado", label: "Cerrados" },
  { key: "descartado", label: "Descartados", hiddenByDefault: true },
];

// ─── Desplegable "Resultado de la llamada" (gestion manual de la asesora) ─────
// Orden y etiquetas segun el panel de ventas. La opcion "(mantener estado)" la
// agrega la UI como valor vacio.
export interface DispositionOption {
  code: string;
  label: string;
}

export const DISPOSITION_OPTIONS: DispositionOption[] = [
  { code: "casi_cierra", label: "Casi cierra (dio datos)" },
  { code: "no_responde", label: "No responde (NR)" },
  { code: "volver_a_llamar", label: "Volver a llamar" },
  { code: "contactado_dejo_wsp", label: "Contactado, dejo WhatsApp" },
  { code: "buzon", label: "Buzon de voz" },
  { code: "sin_stock", label: "Sin stock" },
  { code: "cuelga", label: "Cuelga" },
  { code: "otros_productos", label: "Consulto otros productos" },
  { code: "repetido", label: "Repetido" },
  // Cierre GANADO: va antes del bloque de descartes para que no se pierda
  // entre ellos, que es donde la asesora busca "ya no hay que trabajarlo".
  { code: "ya_tiene_pedido", label: "Ya tiene pedido" },
  { code: "cancelado_cliente", label: "Cancelado por cliente" },
  { code: "cancelado", label: "Cancelado" },
  { code: "ya_compro_otro_lado", label: "Ya compro en otro lado" },
  { code: "solo_informacion", label: "Solo queria informacion" },
  { code: "solo_miraba", label: "Solo miraba" },
  { code: "fuera_de_ciudad", label: "Fuera de la ciudad" },
  { code: "lista_negra", label: "Lista negra" },
  { code: "nr_no_existe", label: "Numero no existe / incorrecto" },
  { code: "nr_extranjero", label: "Numero extranjero" },
];

/** Botones de acceso rapido (fila superior del panel). */
export const DISPOSITION_QUICK: DispositionOption[] = [
  { code: "casi_cierra", label: "Casi cierra" },
  { code: "no_responde", label: "No contesto" },
  { code: "volver_a_llamar", label: "Volver a llamar" },
  { code: "contactado_dejo_wsp", label: "Contactado" },
  { code: "buzon", label: "Buzon" },
  { code: "sin_stock", label: "Sin stock" },
];

const DISPOSITION_CODES = new Set(DISPOSITION_OPTIONS.map((o) => o.code));

export function isValidDisposition(code: string): boolean {
  return DISPOSITION_CODES.has(code);
}

/** Estados que agendan un seguimiento automatico al registrarse. */
export function schedulesFollowup(code: string): boolean {
  return code === "casi_cierra" || code === "volver_a_llamar";
}

/**
 * Estados "no contesto": el cliente no atendio, asi que se agenda un segundo
 * intento automatico 24h despues (regla acordada: reintento a las 24-48h sin
 * que nadie tenga que revisar Seguimiento; el vencido sube solo a la Cola).
 */
const NO_ANSWER_RETRY = new Set(["no_responde", "buzon", "cuelga"]);

export function isNoAnswerStatus(code: string): boolean {
  return NO_ANSWER_RETRY.has(code);
}

export const NO_ANSWER_RETRY_HOURS = 24;

/**
 * Seguimiento automatico segun el estado registrado: casi_cierra /
 * volver_a_llamar usan la regla del panel (hoy 18:00 / manana 10:00); los
 * "no contesto" reintentan a las 24h. El resto no agenda nada.
 */
export function defaultFollowupForStatus(code: string, now: Date): string | null {
  if (schedulesFollowup(code)) return defaultFollowupAt(now);
  if (isNoAnswerStatus(code)) {
    return new Date(now.getTime() + NO_ANSWER_RETRY_HOURS * 3600_000).toISOString();
  }
  return null;
}

/**
 * Proximo seguimiento por defecto (hora local de la tienda). Regla del panel:
 * si es antes de las 16:00 -> hoy 18:00; si no -> manana 10:00.
 * CR y HN son UTC-6 (sin horario de verano), asi que usamos offset fijo -6.
 */
export function defaultFollowupAt(now: Date, offsetHours = -6): string {
  const offsetMs = offsetHours * 3600_000;
  const local = new Date(now.getTime() + offsetMs); // "reloj" local en UTC
  const localHour = local.getUTCHours();
  const target = new Date(local.getTime());
  if (localHour < 16) {
    target.setUTCHours(18, 0, 0, 0);
  } else {
    target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(10, 0, 0, 0);
  }
  // Volver a UTC real restando el offset.
  return new Date(target.getTime() - offsetMs).toISOString();
}
