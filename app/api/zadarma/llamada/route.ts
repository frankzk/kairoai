import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { vendedoraEfectiva } from "@/lib/identidad";
import { destinoDeLlamada, type PedidoDeLlamada } from "@/lib/llamada-destino";
import { getAgentById } from "@/lib/zadarma-calls";
import { isZadarmaConfigured } from "@/lib/zadarma";

export const runtime = "nodejs";
export const maxDuration = 15;

interface Body extends PedidoDeLlamada {
  store?: string;
  vendedora_id?: number;
}

/**
 * Prepara una llamada de Zadarma con el teléfono propio de Kairo
 * (components/ZadarmaPhone.tsx): a qué número marcar. El navegador marca
 * directo desde la extensión de la asesora; aquí no se llama a Zadarma.
 *
 * El número sale de lib/llamada-destino.ts (de la base, no de la pantalla),
 * igual que con Telnyx. El CDR lo escribe el webhook (NOTIFY_OUT_*), que
 * reconoce a la asesora por la extensión y al lead por el teléfono.
 *
 * Sin freno de buzón: Zadarma cobra por segundo, así que volver a caer al
 * buzón cuesta segundos y no un minuto entero (ver lib/telnyx-buzon.ts).
 */
export async function POST(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json({ error: "Zadarma no configurado: falta ZADARMA_API_KEY / ZADARMA_API_SECRET." }, { status: 503 });
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
  try {
    const agent = await getAgentById(vendedoraId);
    if (!agent) {
      return NextResponse.json(
        { error: "Esta asesora no tiene extensión de Zadarma: asígnala en Gestión › Gastos › Planilla › Personal." },
        { status: 409 },
      );
    }
    const destino = await destinoDeLlamada(store, body);
    if (!destino.ok) return NextResponse.json({ error: destino.error }, { status: destino.status });
    // Zadarma marca el número internacional sin "+": 50688887777.
    return NextResponse.json({ ok: true, destino: destino.phone.replace(/\D/g, "") });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo preparar la llamada" }, { status: 500 });
  }
}
