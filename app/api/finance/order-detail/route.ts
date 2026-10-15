import { NextRequest, NextResponse } from "next/server";
import { toFriendlyErrorMessage } from "@/lib/api-errors";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { emptyCustomerOrders, loadCustomerOrdersByPhone } from "@/lib/customer-orders-db";
import { findChatLeadForCustomer } from "@/lib/leads";
import { createOrderEvent, leerConfigConfirmacion, listOrderEvents } from "@/lib/order-events-db";
import {
  isValidCanal,
  isValidOrderEvent,
  type OrderEventKind,
  type OrderEventOutcome,
} from "@/lib/order-events";
import { configDeTienda, problemaFechaPactada, recordatorioPara, requiereFechaPactada, tzDeTienda } from "@/lib/confirmacion";
import { identidadActual, vendedoraEfectiva } from "@/lib/identidad";
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
    const [history, events, chatLead, confirmacionConfig] = await Promise.all([
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
      // Con esto la ficha calcula la cola igual que la tabla (lib/confirmacion.ts).
      leerConfigConfirmacion(store.id, store.code).catch(() => configDeTienda(store.code, null)),
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
      confirmacion_config: confirmacionConfig,
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
      canal?: string;
      fecha_pactada?: string;
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

    // Cola de confirmacion: canal del intento, fecha pactada y recordatorio.
    const ahora = new Date();
    const tz = tzDeTienda(store.code);
    const canal = kind === "contacto" ? (body.canal ?? "llamada").trim() : "";
    if (!isValidCanal(canal)) {
      return NextResponse.json({ error: `Canal invalido: "${canal}"` }, { status: 400 });
    }
    let fechaPactada: string | null = null;
    if (requiereFechaPactada(outcome)) {
      const problema = problemaFechaPactada(body.fecha_pactada, ahora, tz);
      if (problema) return NextResponse.json({ error: problema }, { status: 400 });
      fechaPactada = String(body.fecha_pactada);
    }

    // Una asesora sin supervision queda SIEMPRE a su nombre (lib/identidad.ts).
    const pedida = body.staff_id ?? null;
    const staffId = vendedoraEfectiva(pedida);
    const staffName = staffId !== null && staffId !== pedida ? identidadActual()?.nombre ?? "" : body.staff_name ?? "";

    const event = await createOrderEvent({
      storeId: store.id,
      orderName,
      guideNumber: body.guide_number ?? "",
      kind: kind as OrderEventKind,
      outcome: outcome as OrderEventOutcome,
      message: body.message ?? "",
      staffId,
      staffName,
      canal,
      fechaPactada,
      recordatorioAt: recordatorioPara(outcome, ahora, tz),
    });

    return NextResponse.json({ event });
  } catch (err) {
    const message = toFriendlyErrorMessage(err, "Error al registrar la gestion");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
