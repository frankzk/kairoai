import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { emptyCustomerOrders, loadCustomerOrdersByPhone } from "@/lib/customer-orders-db";
import { findChatLeadForCustomer } from "@/lib/leads";
import { createOrderEvent, listOrderEvents } from "@/lib/order-events-db";
import {
  isValidOrderEvent,
  type OrderEventKind,
  type OrderEventOutcome,
} from "@/lib/order-events";
import { orderAlerts, riskInputFromHistory } from "@/lib/order-risk";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: todo lo que el drawer de gestion necesita de un pedido, en una llamada:
// historial del cliente, alertas previas al despacho, bitacora y la
// conversacion de WhatsApp (la misma que usa Novedades).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(sp);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  const orderName = (sp.get("order") ?? "").trim();
  if (!orderName) {
    return NextResponse.json({ error: "order requerido" }, { status: 400 });
  }
  const phone = (sp.get("phone") ?? "").trim();
  const guide = (sp.get("guide") ?? "").trim();
  const createdAt = sp.get("created_at");

  try {
    // Cada pieza es best-effort: que falle el chat no puede dejar sin alertas
    // a la asesora, que es lo que de verdad necesita para decidir.
    const [history, events, chatLead] = await Promise.all([
      phone
        ? loadCustomerOrdersByPhone({
            storeId: store.id,
            phone,
            currency: store.currency,
            logisticsProvider: store.logisticsProvider,
          }).catch(() => emptyCustomerOrders(store.currency))
        : Promise.resolve(emptyCustomerOrders(store.currency)),
      listOrderEvents({ storeId: store.id, orderName }).catch(() => []),
      findChatLeadForCustomer({
        storeId: store.id,
        storeCode: store.code,
        phone,
        orderName,
      }).catch(() => null),
    ]);

    const alerts = orderAlerts(
      riskInputFromHistory({
        orderName,
        createdAt,
        dispatched: Boolean(guide),
        phone,
        history: history.orders,
      })
    );

    return NextResponse.json({
      orders: history.orders,
      summary: history.summary,
      last_address: history.last_address,
      alerts,
      events,
      chat_lead: chatLead,
    });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al abrir el pedido");
    return NextResponse.json({ error: message, alerts: [], events: [] }, { status: 500 });
  }
}

// POST: registra un intento de contacto, una nota o una decision.
export async function POST(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }

  try {
    const body = (await req.json()) as {
      order_name?: string;
      guide_number?: string;
      kind?: string;
      outcome?: string;
      message?: string;
      staff_id?: number | null;
      staff_name?: string;
    };

    const orderName = (body.order_name ?? "").trim();
    if (!orderName) {
      return NextResponse.json({ error: "order_name requerido" }, { status: 400 });
    }
    const kind = (body.kind ?? "").trim();
    const outcome = (body.outcome ?? "").trim();
    if (!isValidOrderEvent(kind, outcome)) {
      return NextResponse.json(
        { error: `Combinacion invalida: kind="${kind}" outcome="${outcome}"` },
        { status: 400 }
      );
    }
    // Una nota sin texto no aporta nada a la bitacora.
    if (kind === "nota" && !(body.message ?? "").trim()) {
      return NextResponse.json({ error: "La nota necesita texto" }, { status: 400 });
    }

    const event = await createOrderEvent({
      storeId: store.id,
      orderName,
      guideNumber: body.guide_number ?? "",
      kind: kind as OrderEventKind,
      outcome: outcome as OrderEventOutcome,
      message: body.message ?? "",
      staffId: body.staff_id ?? null,
      staffName: body.staff_name ?? "",
    });

    return NextResponse.json({ event });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al registrar la gestion");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
