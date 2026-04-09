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
    [key: string]: unknown;
  };
}

/**
 * Creates an outbound phone call via Retell AI.
 * Metadata is passed as dynamic LLM variables to the agent.
 */
export async function createOutboundCall(
  params: OutboundCallParams
): Promise<{ call_id: string }> {
  const client = getRetellClient();
  const call = await client.call.createPhoneCall({
    from_number: process.env.RETELL_PHONE_NUMBER!,
    to_number: params.toPhone,
    override_agent_id: process.env.RETELL_AGENT_ID!,
    retell_llm_dynamic_variables: {
      order_id: params.metadata.order_id,
      shop_domain: params.metadata.shop_domain,
      customer_name: params.metadata.customer_name ?? "",
    },
    metadata: params.metadata,
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
