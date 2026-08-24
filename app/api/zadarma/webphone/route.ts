import { NextRequest, NextResponse } from "next/server";
import { getAgentById } from "@/lib/zadarma-calls";
import { getWebrtcKey, isZadarmaConfigured, ZadarmaError } from "@/lib/zadarma";

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

  const vendedoraId = Number(req.nextUrl.searchParams.get("vendedora_id"));
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
    const { key } = await getWebrtcKey(agent.sip, force);
    return NextResponse.json({
      sip: agent.sip,
      key,
      name: agent.name,
      language: process.env.ZADARMA_WIDGET_LANGUAGE || "es",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al preparar el teléfono";
    const status = err instanceof ZadarmaError ? 502 : 500;
    const friendly = /zadarma_sip|column/.test(message)
      ? "Falta la columna payroll_staff.zadarma_sip: ejecuta supabase/migrations/0028_zadarma_calls.sql."
      : message;
    return NextResponse.json({ error: friendly }, { status });
  }
}
