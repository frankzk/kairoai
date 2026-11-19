import { NextRequest, NextResponse } from "next/server";
import { getAgentById } from "@/lib/zadarma-calls";
import { isZadarmaConfigured, ZadarmaError } from "@/lib/zadarma";
import { llaveWebrtc } from "@/lib/zadarma-webrtc-db";
import { vendedoraEfectiva } from "@/lib/identidad";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Llave del widget WebRTC para la asesora seleccionada. El navegador la usa
 * para registrarse como su extension y poder hablar por la laptop.
 *
 * La llave es temporal (72h del lado de Zadarma) y solo sirve para la
 * extension que se pide, por eso se resuelve en el servidor a partir del id de
 * la asesora: el cliente nunca elige una extension arbitraria.
 */
export async function GET(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      { error: "Telefonia no configurada: falta ZADARMA_API_KEY / ZADARMA_API_SECRET." },
      { status: 503 }
    );
  }

  // Una asesora sin permiso de supervision queda SIEMPRE a su nombre
  // (lib/identidad.ts): el navegador no puede registrar a nombre de otra.
  const vendedoraId = vendedoraEfectiva(req.nextUrl.searchParams.get("vendedora_id")) ?? NaN;
  if (!Number.isFinite(vendedoraId) || vendedoraId <= 0) {
    return NextResponse.json({ error: "vendedora_id requerido" }, { status: 400 });
  }

  try {
    const agent = await getAgentById(vendedoraId);
    if (!agent) {
      return NextResponse.json(
        { error: "Esta asesora no tiene extension de Zadarma asignada." },
        { status: 404 }
      );
    }

    const force = req.nextUrl.searchParams.get("force") === "1";
    // Una sola consulta a Zadarma por extensión cada 48 h (lib/zadarma-webrtc-db.ts).
    const key = await llaveWebrtc(agent.sip, force);
    return NextResponse.json({ sip: agent.sip, key, name: agent.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al preparar el teléfono";
    const status = err instanceof ZadarmaError ? 502 : 500;
    const friendly = /zadarma_sip|column/.test(message)
      ? "Falta la columna payroll_staff.zadarma_sip: ejecuta supabase/migrations/0029_zadarma_calls.sql."
      : message;
    return NextResponse.json({ error: friendly }, { status });
  }
}
