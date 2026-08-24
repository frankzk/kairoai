import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody } from "@/lib/stores";
import { normalizePhone, phoneConfigForStore } from "@/lib/phone-cr";
import { getLead } from "@/lib/leads";
import { getAgentById } from "@/lib/zadarma-calls";
import { isZadarmaConfigured, requestCallback, ZadarmaError } from "@/lib/zadarma";

export const runtime = "nodejs";
export const maxDuration = 20;

interface Body {
  store?: string;
  vendedora_id?: number;
  lead_id?: number;
  phone?: string;
}

/**
 * Click-to-call: Zadarma timbra la extension de la asesora (su navegador, por
 * el widget WebRTC) y al contestar marca al cliente.
 *
 * El telefono NO se toma del cuerpo cuando viene lead_id: se lee del lead en
 * la base, para que el navegador no pueda pedir una llamada a un numero
 * arbitrario a costa de la cuenta.
 */
export async function POST(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      { error: "Telefonía no configurada: falta ZADARMA_API_KEY / ZADARMA_API_SECRET." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }

  const vendedoraId = Number(body?.vendedora_id);
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json(
      { error: "Selecciona quién eres (asesora) antes de llamar." },
      { status: 400 }
    );
  }

  try {
    const agent = await getAgentById(vendedoraId);
    if (!agent) {
      return NextResponse.json(
        { error: "Esta asesora no tiene extensión de Zadarma asignada." },
        { status: 409 }
      );
    }

    // Origen del numero: el lead manda; el phone del cuerpo es solo respaldo
    // para pantallas que aun no tienen lead (p.ej. un pedido sin conversacion).
    let rawPhone = String(body?.phone ?? "");
    const leadId = Number(body?.lead_id);
    if (Number.isFinite(leadId) && leadId > 0) {
      const lead = await getLead(store.id, leadId);
      if (!lead) return NextResponse.json({ error: "lead no encontrado" }, { status: 404 });
      rawPhone = lead.phone;
    }

    const phone = normalizePhone(rawPhone, phoneConfigForStore(store.code));
    if (!phone) {
      return NextResponse.json(
        { error: `Teléfono inválido para ${store.shortLabel}: ${rawPhone || "(vacío)"}` },
        { status: 400 }
      );
    }

    const result = await requestCallback({ from: agent.sip, to: phone });
    // El CDR (duracion, estado, grabacion) lo escribe el webhook cuando la
    // centralita reporta la llamada; aqui solo se confirma que quedo pedida.
    return NextResponse.json({
      ok: true,
      status: result.status,
      sip: agent.sip,
      phone,
      vendedora: agent.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al iniciar la llamada";
    const status = err instanceof ZadarmaError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
