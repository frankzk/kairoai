import { NextRequest, NextResponse } from "next/server";
import {
  getRecordLink,
  isZadarmaNotifyIp,
  signatureStringForEvent,
  verifyNotifySignature,
} from "@/lib/zadarma";
import { eventTimes, resolveCallContext, upsertZadarmaCall } from "@/lib/zadarma-calls";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Notificaciones de la centralita Zadarma (ruta publica, ver middleware.ts).
 *
 * Es el unico lugar donde se escribe el CDR: la llamada la puede iniciar el
 * boton de Kairo, el widget marcando a mano o el cliente llamando al numero de
 * la tienda, y en los tres casos el ciclo de vida llega por aqui.
 *
 * Autenticidad: cada evento trae el header `Signature` firmado con el secreto
 * de la API. Un evento sin firma valida se descarta. La IP de origen
 * (185.45.152.40/30) se registra como senal adicional, pero no se usa como
 * unica defensa porque depende de la cadena de proxies.
 */

// Zadarma valida la URL pidiendo que se le devuelva `zd_echo` tal cual.
function echoResponse(value: string): NextResponse {
  return new NextResponse(value, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const echo = req.nextUrl.searchParams.get("zd_echo");
  if (echo) return echoResponse(echo);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const echo = req.nextUrl.searchParams.get("zd_echo");
  if (echo) return echoResponse(echo);

  const body = await readBody(req);
  if (body.zd_echo) return echoResponse(body.zd_echo);

  const event = String(body.event ?? "");
  if (!event) return NextResponse.json({ error: "event requerido" }, { status: 400 });

  const signatureString = signatureStringForEvent(event, body);
  if (signatureString === null) {
    // Evento que no manejamos (SPEECH_RECOGNITION, DOCUMENT, eventos nuevos).
    // Se responde 200 para que Zadarma no reintente en bucle.
    return NextResponse.json({ ok: true, ignored: event });
  }

  const signature = req.headers.get("signature") ?? req.headers.get("Signature");
  if (!verifyNotifySignature(signatureString, signature)) {
    console.warn(
      `[zadarma/webhook] firma invalida event=${event} ip=${req.headers.get("x-forwarded-for") ?? "?"}`
    );
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  if (!isZadarmaNotifyIp(req.headers.get("x-forwarded-for"))) {
    console.warn(
      `[zadarma/webhook] firma valida desde IP fuera del rango: ${req.headers.get("x-forwarded-for") ?? "?"}`
    );
  }

  try {
    await handleEvent(event, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[zadarma/webhook] ${event}: ${message}`);
    // 200 a proposito: reintentar no arregla un fallo de escritura y Zadarma
    // no reenvia el resto del ciclo de vida si se le responde error.
    return NextResponse.json({ ok: false, error: message });
  }

  return NextResponse.json({ ok: true });
}

async function readBody(req: NextRequest): Promise<Record<string, string | undefined>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json).map(([key, value]) => [key, value == null ? undefined : String(value)])
    );
  }
  // urlencoded y multipart: FormData cubre ambos.
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  const out: Record<string, string | undefined> = {};
  form.forEach((value, key) => {
    out[key] = typeof value === "string" ? value : undefined;
  });
  return out;
}

async function handleEvent(
  event: string,
  body: Record<string, string | undefined>
): Promise<void> {
  const pbxCallId = String(body.pbx_call_id ?? "");
  if (!pbxCallId) return;

  const { startedAt, endedAt } = eventTimes(body);
  const duration = Number(body.duration ?? 0);

  switch (event) {
    // ─── Saliente: la asesora marca al cliente ──────────────────────────────
    case "NOTIFY_OUT_START": {
      const context = await resolveCallContext({
        rawPhone: body.destination,
        internal: body.internal,
      });
      await upsertZadarmaCall({
        pbxCallId,
        direction: "outgoing",
        internal: body.internal ?? null,
        rawPhone: body.destination ?? null,
        startedAt,
        status: "calling",
        ...context,
      });
      return;
    }
    case "NOTIFY_OUT_END": {
      const context = await resolveCallContext({
        rawPhone: body.destination,
        internal: body.internal,
      });
      await upsertZadarmaCall({
        pbxCallId,
        direction: "outgoing",
        internal: body.internal ?? null,
        rawPhone: body.destination ?? null,
        status: body.disposition ?? null,
        durationSeconds: Number.isFinite(duration) ? duration : 0,
        // Solo se marca en positivo: NOTIFY_RECORD puede llegar antes que el
        // fin de la llamada y un `false` tardio borraria la grabacion ya vista.
        isRecorded: body.is_recorded === "1" ? true : undefined,
        callIdWithRec: body.call_id_with_rec ?? null,
        startedAt,
        endedAt,
        ...context,
      });
      return;
    }

    // ─── Entrante: el cliente llama a la tienda ─────────────────────────────
    case "NOTIFY_START": {
      const context = await resolveCallContext({ rawPhone: body.caller_id, internal: null });
      await upsertZadarmaCall({
        pbxCallId,
        direction: "incoming",
        rawPhone: body.caller_id ?? null,
        startedAt,
        status: "ringing",
        ...context,
      });
      return;
    }
    case "NOTIFY_INTERNAL": {
      // La centralita decidio a que extension timbrar: ya se sabe la asesora.
      const context = await resolveCallContext({
        rawPhone: body.caller_id,
        internal: body.internal,
      });
      await upsertZadarmaCall({
        pbxCallId,
        direction: "incoming",
        internal: body.internal ?? null,
        rawPhone: body.caller_id ?? null,
        ...context,
      });
      return;
    }
    case "NOTIFY_END": {
      const internal = body.last_internal ?? body.internal ?? null;
      const context = await resolveCallContext({ rawPhone: body.caller_id, internal });
      await upsertZadarmaCall({
        pbxCallId,
        direction: "incoming",
        internal,
        rawPhone: body.caller_id ?? null,
        status: body.disposition ?? null,
        durationSeconds: Number.isFinite(duration) ? duration : 0,
        // Solo se marca en positivo: NOTIFY_RECORD puede llegar antes que el
        // fin de la llamada y un `false` tardio borraria la grabacion ya vista.
        isRecorded: body.is_recorded === "1" ? true : undefined,
        callIdWithRec: body.call_id_with_rec ?? null,
        startedAt,
        endedAt,
        ...context,
      });
      return;
    }

    // ─── Grabacion lista ────────────────────────────────────────────────────
    case "NOTIFY_RECORD": {
      const callIdWithRec = body.call_id_with_rec ?? null;
      let recordUrl: string | null = null;
      if (callIdWithRec) {
        recordUrl = await getRecordLink(callIdWithRec).catch((err) => {
          console.warn(`[zadarma/webhook] sin enlace de grabacion: ${String(err)}`);
          return null;
        });
      }
      await upsertZadarmaCall({
        pbxCallId,
        isRecorded: true,
        callIdWithRec,
        recordUrl,
      });
      return;
    }

    default:
      return;
  }
}
