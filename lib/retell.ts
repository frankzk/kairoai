import Retell from "retell-sdk";

// Lazy singleton — only created at runtime (not build time)
let _client: Retell | null = null;

function getRetellClient(): Retell {
  if (!_client) {
    if (!process.env.RETELL_API_KEY) {
      throw new Error("RETELL_API_KEY environment variable is not set");
    }
    _client = new Retell({ apiKey: process.env.RETELL_API_KEY });
  }
  return _client;
}

export interface OutboundCallParams {
  toPhone: string;
  metadata: {
    order_id: string;
    shop_domain: string;
    customer_name?: string;
    products?: string;
    total?: string;
    country?: string;
    shipping_address?: string;
    address_complete?: boolean;
    event_type?: string;
    // Upsell (pre-loaded at call creation time for Single Prompt agents)
    upsell_product_name?: string;
    upsell_product_price?: string;
    upsell_pitch?: string;
    [key: string]: unknown;
  };
}

/**
 * Creates an outbound phone call via Retell AI.
 * Passes all order data as dynamic variables so Retell Single Prompt Agent
 * can substitute {{nombre}}, {{tienda}}, {{producto}}, {{monto}}, etc.
 */
export async function createOutboundCall(
  params: OutboundCallParams
): Promise<{ call_id: string }> {
  const client = getRetellClient();
  const m = params.metadata;

  // Store name: prefer STORE_NAME env, fallback to domain prefix
  const storeName =
    process.env.STORE_NAME ??
    (m.shop_domain ? String(m.shop_domain).split(".")[0] : "la tienda");

  // direccion_completa as Sí/No for Spanish prompt templates
  const direccionCompleta = m.address_complete ? "Sí" : "No";

  const call = await client.call.createPhoneCall({
    from_number: process.env.RETELL_PHONE_NUMBER!,
    to_number: params.toPhone,
    override_agent_id: process.env.RETELL_AGENT_ID!,
    retell_llm_dynamic_variables: {
      // English keys (used by Custom LLM)
      order_id: m.order_id,
      shop_domain: m.shop_domain,
      customer_name: m.customer_name ?? "",
      products: m.products ?? "",
      total: m.total ?? "",
      shipping_address: m.shipping_address ?? "",
      address_complete: direccionCompleta,
      event_type: m.event_type ?? "order_confirmation",
      // Spanish keys (used by Retell Single Prompt Agent templates)
      nombre: m.customer_name ?? "",
      tienda: storeName,
      producto: m.products ?? "",
      monto: m.total ?? "",
      direccion: m.shipping_address ?? "no disponible",
      direccion_completa: direccionCompleta,
      // Upsell variables
      producto_upsell: m.upsell_product_name ?? "",
      precio_upsell: m.upsell_product_price ?? "",
      pitch_upsell: m.upsell_pitch ?? "",
    },
    metadata: m,
  });

  return { call_id: call.call_id };
}

/**
 * Validates a Retell webhook signature.
 * Retell signs payloads with HMAC-SHA256 using your API key.
 */
export function validateRetellSignature(
  rawBody: string,
  signature: string
): boolean {
  const crypto = require("crypto") as typeof import("crypto");
  const expected = crypto
    .createHmac("sha256", process.env.RETELL_API_KEY!)
    .update(rawBody)
    .digest("hex");
  return signature === expected;
}
