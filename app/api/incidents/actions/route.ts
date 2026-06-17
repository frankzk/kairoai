import { NextRequest, NextResponse } from "next/server";
import { getIncident, patchIncident, recordIncidentEvent } from "@/lib/incidents";
import type { Incident } from "@/lib/incidents-types";
import { addOrderTag, cancelOrder } from "@/lib/shopify";
import { FINANCE_STORES, getShopifyCredentials, getStoreConfig } from "@/lib/stores";

export const runtime = "nodejs";

const ACTIONS = new Set([
  "registrar_llamada", "reprogramar", "no_llamar", "rts", "cancelar_shopify", "descartar",
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id || !body?.action) {
    return NextResponse.json({ error: "id y action requeridos" }, { status: 400 });
  }
  if (!ACTIONS.has(body.action)) {
    return NextResponse.json({ error: "Accion invalida" }, { status: 400 });
  }
  const id = Number(body.id);

  try {
    const incident = await getIncident(id);
    if (!incident) return NextResponse.json({ error: "Novedad no encontrada" }, { status: 404 });

    // Credenciales Shopify de la tienda dueña de la novedad (multi-tienda).
    const storeCode = FINANCE_STORES.find((s) => s.id === incident.store_id)?.code;
    const shopifyCreds = getShopifyCredentials(getStoreConfig(storeCode));

    switch (body.action) {
      case "registrar_llamada": {
        const resultado = body.resultado === "contesto" ? "contesto" : "no_contesto";
        const patch: Partial<Incident> = {
          intentos_llamada: (incident.intentos_llamada ?? 0) + 1,
          ultimo_intento_at: new Date().toISOString(),
        };
        if (resultado === "no_contesto") patch.status = "sin_contestar";
        const updated = await patchIncident(id, patch, {
          kind: "llamada",
          from_status: incident.status,
          to_status: patch.status ?? incident.status,
          message: resultado === "contesto" ? "Llamada: el cliente contesto" : "Llamada: no contesto",
          result: "info",
          metadata: { resultado, nota: body.nota ?? "" },
        });
        return NextResponse.json({ incident: updated });
      }

      case "reprogramar": {
        const fecha = String(body.fecha ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
          return NextResponse.json({ error: "Fecha invalida (use YYYY-MM-DD)" }, { status: 400 });
        }
        const updated = await patchIncident(
          id,
          { status: "reprogramada", reprogramada_para: fecha },
          {
            kind: "reprogramada",
            from_status: incident.status,
            to_status: "reprogramada",
            message: `Reprogramada para ${fecha}${body.nota ? ` - ${body.nota}` : ""}`,
            metadata: { reprogramada_para: fecha, nota: body.nota ?? "" },
          }
        );
        return NextResponse.json({ incident: updated });
      }

      case "no_llamar": {
        const updated = await patchIncident(
          id,
          { status: "no_llamar" },
          {
            kind: "no_llamar",
            from_status: incident.status,
            to_status: "no_llamar",
            message: body.nota ? `No volver a llamar - ${body.nota}` : "Marcada como no volver a llamar",
          }
        );
        return NextResponse.json({ incident: updated });
      }

      case "rts": {
        let result: "ok" | "info" = "ok";
        let message = "Marcada para devolucion al origen (RTS)";
        if (incident.shopify_order_id) {
          try {
            await addOrderTag(incident.shopify_order_id, "rts-kairo", shopifyCreds);
          } catch {
            result = "info";
            message += " (no se pudo etiquetar en Shopify)";
          }
        }
        const updated = await patchIncident(
          id,
          { status: "perdida" },
          { kind: "accion_rts", from_status: incident.status, to_status: "perdida", message, result }
        );
        return NextResponse.json({ incident: updated });
      }

      case "cancelar_shopify": {
        if (!incident.shopify_order_id) {
          return NextResponse.json(
            { error: "La novedad no tiene pedido de Shopify vinculado" },
            { status: 400 }
          );
        }
        if (shopifyCreds.missing.length) {
          return NextResponse.json(
            { error: `Faltan credenciales de Shopify de esta tienda: ${shopifyCreds.missing.join(", ")}` },
            { status: 400 }
          );
        }
        try {
          await cancelOrder(incident.shopify_order_id, body.reason ?? "other", shopifyCreds);
        } catch (e) {
          const m = e instanceof Error ? e.message : "Error";
          await recordIncidentEvent(id, {
            kind: "accion_cancelar_shopify",
            message: `Error al cancelar en Shopify: ${m}`,
            result: "error",
          });
          return NextResponse.json({ error: `No se pudo cancelar en Shopify: ${m}` }, { status: 500 });
        }
        const updated = await patchIncident(
          id,
          { status: "perdida" },
          {
            kind: "accion_cancelar_shopify",
            from_status: incident.status,
            to_status: "perdida",
            message: "Pedido cancelado en Shopify",
            result: "ok",
          }
        );
        return NextResponse.json({ incident: updated });
      }

      case "descartar": {
        const updated = await patchIncident(
          id,
          { status: "descartada" },
          {
            kind: "descartada",
            from_status: incident.status,
            to_status: "descartada",
            message: body.nota ? `Descartada - ${body.nota}` : "Descartada (no aplica)",
          }
        );
        return NextResponse.json({ incident: updated });
      }

      default:
        return NextResponse.json({ error: "Accion invalida" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al ejecutar la accion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
