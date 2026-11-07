// A que numero se llama desde el boton "Llamar", para cualquier telefonia
// (Zadarma o Telnyx).
//
// El telefono NO se toma del cuerpo cuando viene lead_id, order_name o
// incident_id: se lee de la base, para que el navegador no pueda pedir una
// llamada a un numero arbitrario a costa de la cuenta.

import { normalizePhone, phoneConfigForStore } from "@/lib/phone-cr";
import { getLead } from "@/lib/leads";
import { getIncident } from "@/lib/incidents";
import { getOrderPhone } from "@/lib/zadarma-calls";
import type { FinanceStoreConfig } from "@/lib/stores";

export interface PedidoDeLlamada {
  lead_id?: number;
  /** Pedido de Shopify (#MCRC20388) o de iComfly (IC-...), para el drawer de Gestion de pedidos. */
  order_name?: string;
  /** Novedad de entrega, para su panel en Novedades. */
  incident_id?: number;
  phone?: string;
}

export type DestinoDeLlamada =
  /**
   * orderName: el pedido por el que se llama (desde Gestion de pedidos, o el
   * de la novedad), para encontrar la llamada y su grabacion desde el pedido.
   */
  | { ok: true; phone: string; leadId: number | null; orderName: string | null }
  | { ok: false; error: string; status: number };

export async function destinoDeLlamada(store: FinanceStoreConfig, body: PedidoDeLlamada | null): Promise<DestinoDeLlamada> {
  // Origen del numero, por orden de confianza: el lead, el pedido, la novedad
  // y, solo como respaldo, lo que mande la pantalla.
  let rawPhone = String(body?.phone ?? "");
  const leadId = Number(body?.lead_id);
  const orderName = String(body?.order_name ?? "").trim();
  const incidentId = Number(body?.incident_id);
  const conLead = Number.isFinite(leadId) && leadId > 0;
  let pedido: string | null = null;
  if (conLead) {
    const lead = await getLead(store.id, leadId);
    if (!lead) return { ok: false, error: "lead no encontrado", status: 404 };
    rawPhone = lead.phone;
  } else if (orderName) {
    const order = await getOrderPhone(store.id, orderName);
    if (!order) {
      return { ok: false, error: `El pedido ${orderName} no tiene teléfono guardado en ${store.shortLabel}.`, status: 404 };
    }
    rawPhone = order.phone;
    pedido = orderName;
  } else if (Number.isFinite(incidentId) && incidentId > 0) {
    const incident = await getIncident(incidentId, store.id);
    if (!incident) return { ok: false, error: "novedad no encontrada", status: 404 };
    if (!incident.customer_phone) {
      return { ok: false, error: "Esta novedad no tiene teléfono del cliente.", status: 404 };
    }
    rawPhone = incident.customer_phone;
    pedido = (incident.order_name ?? "").trim() || null;
  }

  const phone = normalizePhone(rawPhone, phoneConfigForStore(store.code));
  if (!phone) {
    return { ok: false, error: `Teléfono inválido para ${store.shortLabel}: ${rawPhone || "(vacío)"}`, status: 400 };
  }
  return { ok: true, phone, leadId: conLead ? leadId : null, orderName: pedido };
}
