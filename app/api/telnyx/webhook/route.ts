import { NextRequest, NextResponse } from "next/server";
import {
  getTelnyxConfig,
  grabarLlamadas,
  leerEventoTelnyx,
  telnyxApiConfig,
  telnyxPublicKey,
  verificarFirmaTelnyx,
} from "@/lib/telnyx";
import { aplicarEventoTelnyx } from "@/lib/telnyx-calls";
import { copiarGrabacion } from "@/lib/grabaciones";
import { enSegundoPlano } from "@/lib/segundo-plano";

export const runtime = "nodejs";
// 30 s: la copia de la grabacion corre despues de responder, dentro de este
// mismo limite (la descarga se corta a los 15 s; lo que no entre, el cron).
export const maxDuration = 30;

/**
 * Eventos de las llamadas de Telnyx (la URL va en la Credential Connection:
 * Webhook URL). Publico, pero solo se acepta lo firmado con la llave de la
 * cuenta (TELNYX_PUBLIC_KEY). Sin llave no se acepta nada: un webhook sin
 * verificar dejaria a cualquiera escribir en el historial de llamadas.
 */
export async function POST(req: NextRequest) {
  const publicKey = telnyxPublicKey();
  if (!publicKey) {
    console.warn("[telnyx] webhook rechazado: falta TELNYX_PUBLIC_KEY");
    return NextResponse.json({ error: "TELNYX_PUBLIC_KEY no configurada" }, { status: 503 });
  }
  // El texto crudo: la firma es sobre el cuerpo tal como llego.
  const cuerpo = await req.text();
  const firma = verificarFirmaTelnyx({
    cuerpo,
    firma: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKey,
  });
  if (!firma.ok) {
    console.warn(`[telnyx] webhook rechazado: ${firma.motivo}`);
    return NextResponse.json({ error: "firma invalida" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: "cuerpo invalido" }, { status: 400 });
  }
  const evento = leerEventoTelnyx(json);
  // Otros eventos (o llamadas que no salieron de Kairo): 200 para que Telnyx
  // no los reintente.
  if (!evento) return NextResponse.json({ ok: true, ignorado: true });

  try {
    const cfg = getTelnyxConfig().config;
    const resultado = await aplicarEventoTelnyx(evento, {
      cfg,
      grabar: grabarLlamadas(),
      // El mp3 se copia a nuestro bucket DESPUES de responder: Telnyx no
      // espera la descarga. Si no alcanza o falla, lo recoge el cron
      // call-recordings con un enlace nuevo (lib/grabaciones.ts).
      copiarGrabacion: (fila, url) =>
        enSegundoPlano(`grabacion ${fila.id}`, () => copiarGrabacion(fila, { url, cfg: telnyxApiConfig(), timeoutMs: 15_000 })),
    });
    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    // 500: Telnyx reintenta, y el evento no se pierde si la base fallo un momento.
    const message = err instanceof Error ? err.message : "error";
    console.error(`[telnyx] webhook ${evento.tipo}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
