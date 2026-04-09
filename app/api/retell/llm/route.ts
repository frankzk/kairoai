import { NextRequest, NextResponse } from "next/server";
import {
  GoogleGenerativeAI,
  FunctionDeclarationSchemaType,
} from "@google/generative-ai";
import { MIREVA_CR_AGENT } from "@/agents/mireva-cr";
import { AGENT_TOOLS, type RetellCustomLLMRequest } from "@/agents/base-agent";
import {
  getOrder,
  confirmOrder,
  cancelOrder,
  createDraftOrder,
  completeDraftOrder,
  formatOrderSummary,
} from "@/lib/shopify";
import { redis, keys } from "@/lib/redis";
import { MIREVA_CR_UPSELL_RULES } from "@/lib/upsell-rules";

export const runtime = "nodejs";
// Retell expects < 1s response — use edge-friendly timeout
export const maxDuration = 25;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

export async function POST(req: NextRequest) {
  let body: RetellCustomLLMRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Ping-pong ─────────────────────────────────────────────────────────────
  if (body.interaction_type === "ping_pong") {
    return NextResponse.json({ response_type: "pong" });
  }

  // ── Call details (first message) ──────────────────────────────────────────
  if (body.interaction_type === "call_details") {
    return NextResponse.json({ response_type: "ack" });
  }

  // ── Update only (no response needed) ─────────────────────────────────────
  if (body.interaction_type === "update_only") {
    return NextResponse.json({ response_type: "ack" });
  }

  // ── Function call result ──────────────────────────────────────────────────
  if (body.func_call) {
    const result = await executeFunctionCall(
      body.func_call.name,
      JSON.parse(body.func_call.arguments || "{}"),
      body.call?.metadata ?? {}
    );

    return NextResponse.json({
      response_id: body.response_id ?? 0,
      content: "",
      content_complete: true,
      end_call: false,
      actions: [
        {
          action_type: "function_call_result",
          func_call_id: body.func_call.func_call_id,
          result: JSON.stringify(result),
        },
      ],
    });
  }

  // ── Response required ─────────────────────────────────────────────────────
  if (
    body.interaction_type === "response_required" ||
    body.interaction_type === "reminder_required"
  ) {
    const transcript = body.transcript ?? [];
    const metadata = body.call?.metadata ?? {};

    const geminiResponse = await callGemini(transcript, metadata);

    return NextResponse.json({
      response_id: body.response_id ?? 0,
      content: geminiResponse.text,
      content_complete: true,
      end_call: geminiResponse.end_call,
      actions: geminiResponse.tool_calls?.map((tc) => ({
        action_type: "function_call_invocation",
        name: tc.name,
        arguments: tc.args,
      })),
    });
  }

  return NextResponse.json({ response_type: "ack" });
}

// ─── Gemini Integration ────────────────────────────────────────────────────

async function callGemini(
  transcript: Array<{ role: string; content: string }>,
  metadata: Record<string, unknown>
) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: buildSystemPrompt(metadata),
    tools: [
      {
        functionDeclarations: AGENT_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: FunctionDeclarationSchemaType.OBJECT,
            properties: Object.entries(
              (tool as { parameters: { properties: Record<string, { type: string; description: string }> } }).parameters.properties
            ).reduce(
              (acc, [key, val]) => ({
                ...acc,
                [key]: {
                  type: val.type.toUpperCase() as FunctionDeclarationSchemaType,
                  description: val.description,
                },
              }),
              {}
            ),
            required: [...(tool as { parameters: { required: readonly string[] } }).parameters.required] as string[],
          },
        })),
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 200,
    },
  });

  // Build conversation history for Gemini
  const history = transcript.slice(0, -1).map((t) => ({
    role: t.role === "agent" ? "model" : "user",
    parts: [{ text: t.content }],
  }));

  const lastMessage =
    transcript[transcript.length - 1]?.content ?? "Hola";

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage);
  const response = result.response;

  // Check for function calls
  const toolCalls = response.functionCalls();
  if (toolCalls && toolCalls.length > 0) {
    return {
      text: "",
      end_call: false,
      tool_calls: toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.args as Record<string, unknown>,
      })),
    };
  }

  const text = response.text();
  const endCall =
    text.toLowerCase().includes("hasta luego") ||
    text.toLowerCase().includes("que tenga un buen") ||
    text.toLowerCase().includes("fue un gusto") ||
    text.toLowerCase().includes("buen día, cuídese");

  return { text, end_call: endCall, tool_calls: undefined };
}

function buildSystemPrompt(metadata: Record<string, unknown>): string {
  const orderContext = metadata.order_id
    ? `\n\n## CONTEXTO DEL PEDIDO ACTUAL\n- ID de pedido: ${metadata.order_id}\n- Cliente: ${metadata.customer_name ?? "desconocido"}\n- Productos: ${metadata.products ?? "ver con get_order_details"}\n- Total: ${metadata.total ?? "ver con get_order_details"}\n- País: ${metadata.country ?? "Costa Rica"}\n- Tipo de evento: ${metadata.event_type ?? "order_confirmation"}`
    : "";

  return MIREVA_CR_AGENT.system_prompt + orderContext;
}

// ─── Function Execution ────────────────────────────────────────────────────

async function executeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<unknown> {
  console.info(`[retell/llm] Executing function: ${name}`, args);

  switch (name) {
    case "get_order_details": {
      const order = await getOrder(String(args.order_id));
      return {
        success: true,
        summary: formatOrderSummary(order),
        order_id: order.id,
        customer_name: order.customer
          ? `${order.customer.first_name} ${order.customer.last_name}`
          : `${order.billing_address?.first_name ?? ""} ${order.billing_address?.last_name ?? ""}`,
        products: order.line_items.map((li) => ({
          title: li.title,
          sku: li.sku,
          quantity: li.quantity,
          price: li.price,
        })),
        total: `${order.total_price} ${order.currency}`,
        address: order.shipping_address
          ? `${order.shipping_address.address1}, ${order.shipping_address.city}`
          : "no disponible",
        tags: order.tags,
      };
    }

    case "confirm_order": {
      await confirmOrder(String(args.order_id));
      return { success: true, message: "Pedido confirmado en Shopify" };
    }

    case "cancel_order": {
      await cancelOrder(String(args.order_id));
      return { success: true, message: "Pedido cancelado en Shopify" };
    }

    case "offer_upsell": {
      const rule = MIREVA_CR_UPSELL_RULES.find(
        (r) => r.upsell_sku === String(args.product_sku)
      );
      if (!rule) {
        return { success: false, message: "SKU de upsell no encontrado" };
      }

      // Get original order for customer info
      const order = await getOrder(String(args.order_id));
      const draft = await createDraftOrder({
        customer_id: order.customer?.id,
        phone:
          order.phone ?? order.billing_address?.phone ?? undefined,
        line_items: [
          {
            sku: rule.upsell_sku,
            title: rule.upsell_name,
            price: String(rule.upsell_price),
            quantity: 1,
          },
        ],
        note: `Upsell de Kairo AI para pedido #${order.order_number}`,
      });

      return {
        success: true,
        draft_order_id: String(draft.id),
        product_name: rule.upsell_name,
        price: rule.upsell_price,
        pitch: rule.pitch,
      };
    }

    case "accept_upsell": {
      const completed = await completeDraftOrder(String(args.draft_order_id));
      return {
        success: true,
        message: "Upsell aceptado y pedido creado",
        new_order_id: completed.order_id,
      };
    }

    case "schedule_retry": {
      const retryAt = Date.now() + Number(args.minutes) * 60 * 1000;
      const retryKey = keys.dedup(String(args.phone), String(args.order_id));
      // Delete dedup key so retry is allowed
      await redis.del(retryKey);
      // Save retry to sorted set (score = timestamp to execute)
      await redis.zadd(keys.retryQueue(), {
        score: retryAt,
        member: JSON.stringify({
          phone: args.phone,
          order_id: args.order_id,
          scheduled_at: new Date(retryAt).toISOString(),
        }),
      });
      return {
        success: true,
        message: `Reintento programado en ${args.minutes} minutos`,
        retry_at: new Date(retryAt).toISOString(),
      };
    }

    default:
      return { success: false, message: `Función desconocida: ${name}` };
  }
}
