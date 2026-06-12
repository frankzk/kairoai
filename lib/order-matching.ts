// Logica de matching pedido <-> liquidacion/guia compartida entre el cliente
// (page de finanzas) y las rutas de importacion. Funciones puras: nada de DB.

export interface MatchableShopifyOrderLike {
  id: string | number;
  name: string;
  order_number?: number | null;
  note?: string | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }>;
}

export interface OrderMatchKeySource {
  order_name?: string | null;
  shopify_order_name?: string | null;
  shopify_order_number?: number | null;
  shopify_note?: string | null;
}

export function normalizeMatchKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "");
}

export function normalizeSearchText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Codigos externos anotados a mano en el pedido: "Pedido 1777526392057".
export function extractExternalOrderCodesFromText(value: string): string[] {
  const codes = new Set<string>();
  const patterns = [
    /\bpedido\s*#?\s*([0-9]{3,})\b/gi,
    /\border\s*#?\s*([0-9]{3,})\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    const text = String(value || "");
    while ((match = pattern.exec(text)) !== null) {
      const code = normalizeSearchText(match[1] ?? "").replace(/[^0-9]/g, "");
      if (code) codes.add(code);
    }
  }
  return Array.from(codes);
}

export function getShopifyNoteText(
  order: Pick<MatchableShopifyOrderLike, "note" | "note_attributes">
): string {
  const attributeText = (order.note_attributes ?? [])
    .flatMap((attribute) => [attribute.name ?? "", attribute.value ?? ""])
    .filter(Boolean)
    .join("\n");
  return [order.note ?? "", attributeText].filter(Boolean).join("\n");
}

// Claves con las que un pedido de Shopify puede ser encontrado. Los numeros de
// orden a secas NO se indexan: un codigo numerico de Boxful solo cruza via
// nota explicita ("Pedido <codigo>"), nunca por coincidencia de numero.
export function getShopifyDirectOrderMatchKeys(order: MatchableShopifyOrderLike): string[] {
  const orderNumber = order.order_number;
  return uniqueMatchKeys([
    normalizeMatchKey(order.name),
    orderNumber ? normalizeMatchKey(`#MCRC${orderNumber}`) : "",
  ]);
}

export function getShopifyOrderMatchKeys(order: MatchableShopifyOrderLike): string[] {
  return uniqueMatchKeys([
    ...extractExternalOrderCodesFromText(getShopifyNoteText(order)).map(normalizeMatchKey),
    ...getShopifyDirectOrderMatchKeys(order),
  ]);
}

// Claves de una fila (Boxful/liquidacion) para buscar su pedido.
export function getOrderMatchKeys(row: OrderMatchKeySource): string[] {
  const orderNumber = row.shopify_order_number;
  const orderNameKey = normalizeMatchKey(row.order_name ?? "");
  // Guias reenviadas ("#MCRC10099-V2") cruzan con su pedido base de Shopify.
  const reshipmentBaseKey = /^mcrc\d+-v\d+$/.test(orderNameKey)
    ? orderNameKey.replace(/-v\d+$/, "")
    : "";
  return uniqueMatchKeys([
    orderNameKey,
    reshipmentBaseKey,
    ...extractExternalOrderCodesFromText(row.shopify_note ?? "").map(normalizeMatchKey),
    normalizeMatchKey(row.shopify_order_name ?? ""),
    orderNumber ? normalizeMatchKey(`#MCRC${orderNumber}`) : "",
  ]);
}

// Indice clave -> pedido. Los codigos de nota se indexan primero para que un
// alias explicito nunca pierda contra una coincidencia accidental de nombre.
export function buildShopifyMatchIndex<T extends MatchableShopifyOrderLike>(
  orders: T[]
): Map<string, T> {
  const byKey = new Map<string, T>();
  for (const order of orders) {
    for (const key of extractExternalOrderCodesFromText(getShopifyNoteText(order)).map(
      normalizeMatchKey
    )) {
      if (!byKey.has(key)) byKey.set(key, order);
    }
  }
  for (const order of orders) {
    for (const key of getShopifyDirectOrderMatchKeys(order)) {
      if (!byKey.has(key)) byKey.set(key, order);
    }
  }
  return byKey;
}

export function findShopifyOrderForRow<T extends MatchableShopifyOrderLike>(
  row: OrderMatchKeySource,
  index: Map<string, T>
): T | undefined {
  for (const key of getOrderMatchKeys(row)) {
    const order = index.get(key);
    if (order) return order;
  }
  return undefined;
}

function uniqueMatchKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}
