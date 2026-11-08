import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { vendedoraEfectiva } from "@/lib/identidad";
import { destinoDeLlamada, type PedidoDeLlamada } from "@/lib/llamada-destino";
import { callerIdDeTienda, codificarEstadoCliente, getTelnyxConfig, variableCallerId } from "@/lib/telnyx";
import { crearLlamadaTelnyx } from "@/lib/telnyx-calls";

export const runtime = "nodejs";
export const maxDuration = 15;

interface Body extends PedidoDeLlamada {
  store?: string;
  vendedora_id?: number;
}

/**
 * Prepara una llamada de Telnyx: a que numero, con que caller ID y el
 * client_state que identifica la llamada en el webhook. Marca el NAVEGADOR
 * (@telnyx/webrtc) con estos datos; aqui no se llama a Telnyx.
 *
 * El numero sale de lib/llamada-destino.ts (de la base, no de la pantalla),
 * igual que con Zadarma.
 */
export async function POST(req: NextRequest) {
  const { config, faltan } = getTelnyxConfig();
  if (!config) {
    return NextResponse.json({ error: `Telnyx no configurado: falta ${faltan.join(" y ")}.` }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const vendedoraId = vendedoraEfectiva(body?.vendedora_id) ?? NaN;
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "Selecciona quién eres (asesora) antes de llamar." }, { status: 400 });
  }
  const callerNumber = callerIdDeTienda(store.countryCode);
  if (!callerNumber) {
    return NextResponse.json(
      { error: `Falta el número de ${store.shortLabel} para llamar (${variableCallerId(store.countryCode)} en Vercel).` },
      { status: 503 }
    );
  }

  try {
    const destino = await destinoDeLlamada(store, body);
    if (!destino.ok) return NextResponse.json({ error: destino.error }, { status: destino.status });
    const llamadaId = await crearLlamadaTelnyx({
      storeId: store.id,
      leadId: destino.leadId,
      vendedoraId,
      phone: destino.phone,
      orderName: destino.orderName,
    });
    return NextResponse.json({
      ok: true,
      destino: `+${destino.phone}`,
      caller_number: callerNumber,
      client_state: codificarEstadoCliente(llamadaId),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo preparar la llamada";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
