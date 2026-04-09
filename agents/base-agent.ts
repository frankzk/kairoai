import type { UpsellRule } from "@/lib/upsell-rules";

export interface AgentConfig {
  name: string;
  voice_id: string;
  language: string;
  country: string;
  currency: string;
  currency_symbol: string;
  phone_number: string;
  system_prompt: string;
  upsell_rules: UpsellRule[];
}

export interface RetellCustomLLMRequest {
  interaction_type:
    | "call_details"
    | "ping_pong"
    | "update_only"
    | "response_required"
    | "reminder_required";
  response_id?: number;
  call?: {
    call_id: string;
    agent_id: string;
    call_status: string;
    metadata?: Record<string, unknown>;
    retell_llm_dynamic_variables?: Record<string, unknown>;
  };
  transcript?: Array<{
    role: "agent" | "user";
    content: string;
  }>;
  func_call?: {
    func_call_id: string;
    name: string;
    arguments: string; // JSON-encoded string
  };
}

export interface RetellCustomLLMResponse {
  response_id: number;
  content: string;
  content_complete: boolean;
  end_call: boolean;
  transfer_destination_number?: string;
  actions?: Array<{
    action_type: "function_call_result";
    func_call_id: string;
    result: string;
  }>;
}

/**
 * Tool definitions exposed to Gemini (and described to Retell).
 * These map to the custom functions the agent can invoke.
 */
export const AGENT_TOOLS = [
  {
    name: "get_order_details",
    description:
      "Obtiene los detalles completos de un pedido desde Shopify: nombre del cliente, productos, total, dirección.",
    parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "El ID del pedido en Shopify",
        },
      },
      required: ["order_id"],
    },
  },
  {
    name: "confirm_order",
    description:
      "Marca el pedido como confirmado en Shopify. Llamar cuando el cliente dice SÍ quiere el pedido.",
    parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "El ID del pedido a confirmar",
        },
      },
      required: ["order_id"],
    },
  },
  {
    name: "cancel_order",
    description:
      "Cancela el pedido en Shopify. Llamar cuando el cliente rechaza definitivamente el pedido.",
    parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "El ID del pedido a cancelar",
        },
      },
      required: ["order_id"],
    },
  },
  {
    name: "offer_upsell",
    description:
      "Crea un draft order con el producto de upsell para que el cliente lo apruebe.",
    parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "El ID del pedido original",
        },
        product_sku: {
          type: "string",
          description: "SKU del producto de upsell a ofrecer",
        },
      },
      required: ["order_id", "product_sku"],
    },
  },
  {
    name: "accept_upsell",
    description:
      "Completa el draft order del upsell cuando el cliente acepta.",
    parameters: {
      type: "object",
      properties: {
        draft_order_id: {
          type: "string",
          description: "El ID del draft order creado por offer_upsell",
        },
      },
      required: ["draft_order_id"],
    },
  },
  {
    name: "schedule_retry",
    description:
      "Programa un reintento de llamada si el cliente no puede atender ahora.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Número de teléfono del cliente",
        },
        order_id: {
          type: "string",
          description: "ID del pedido",
        },
        minutes: {
          type: "number",
          description: "Minutos a esperar antes del reintento (ej: 30, 60, 120)",
        },
      },
      required: ["phone", "order_id", "minutes"],
    },
  },
] as const;
