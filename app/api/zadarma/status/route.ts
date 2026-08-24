import { NextRequest, NextResponse } from "next/server";
import { listExtensionAssignments } from "@/lib/zadarma-calls";
import {
  configureCallInfo,
  getBalance,
  getCallInfoSettings,
  getPbxExtensions,
  getPbxTimezone,
  getWebrtcIntegration,
  isZadarmaConfigured,
  isExtensionOnline,
  REQUIRED_NOTIFICATIONS,
  ZadarmaError,
} from "@/lib/zadarma";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Diagnóstico de la telefonía: responde por qué "no timbra" sin tener que
 * entrar a Zadarma. Cada pieza se consulta por separado y un fallo no tumba
 * el resto del informe.
 */
export async function GET(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error: "Falta ZADARMA_API_KEY / ZADARMA_API_SECRET en las variables de entorno.",
      },
      { status: 200 }
    );
  }

  const webhookUrl = expectedWebhookUrl(req);
  const [balance, timezone, widget, callInfo, extensions, assigned] = await Promise.all([
    getBalance().catch(errorOf),
    getPbxTimezone().catch(errorOf),
    getWebrtcIntegration().catch(errorOf),
    getCallInfoSettings().catch(errorOf),
    getPbxExtensions().catch(errorOf),
    listExtensionAssignments().catch(() => new Map<string, string>()),
  ]);

  // Estado real de cada extension: quien la tiene y si hay un telefono
  // registrado. Es la fila que contesta "por que no me timbra", asi que va
  // aqui y no enterrada en el catalogo de personal.
  const extensionRows =
    extensions && !("error" in extensions)
      ? await Promise.all(
          extensions.extensions.map(async (extension) => ({
            sip: extension.sip,
            assigned_to: assigned.get(extension.sip) ?? null,
            online: await isExtensionOnline(extension.sip),
          }))
        )
      : [];

  const missingNotifications =
    callInfo && !("error" in callInfo)
      ? REQUIRED_NOTIFICATIONS.filter((event) => !callInfo.notifications[event])
      : [];

  return NextResponse.json({
    configured: true,
    balance,
    timezone: timezone && !("error" in timezone)
      ? {
          ...timezone,
          // Si el offset de la centralita no coincide con el configurado, las
          // horas del CDR quedan corridas y nadie lo nota hasta auditar.
          env_offset: process.env.ZADARMA_TIMEZONE_OFFSET ?? null,
          matches: (process.env.ZADARMA_TIMEZONE_OFFSET ?? "") === (timezone.offset ?? ""),
        }
      : timezone,
    widget:
      widget && !("error" in widget)
        ? {
            ...widget,
            // El widget solo carga si el dominio (o su dominio padre) esta
            // autorizado; sin esto no hay teléfono aunque todo lo demas este bien.
            domain_authorized: widget.domains.some((domain) =>
              sameHost(domain, req.nextUrl.host)
            ),
            expected_host: req.nextUrl.host,
          }
        : widget,
    webhook:
      callInfo && !("error" in callInfo)
        ? {
            ...callInfo,
            expected_url: webhookUrl,
            url_matches: normalizeUrl(callInfo.url) === normalizeUrl(webhookUrl),
            missing_notifications: missingNotifications,
          }
        : callInfo,
    extensions:
      extensions && !("error" in extensions)
        ? {
            total: extensions.extensions.length,
            assigned: extensionRows.filter((row) => row.assigned_to).length,
            rows: extensionRows,
          }
        : extensions,
  });
}

/**
 * Apunta las notificaciones de la centralita a este deploy y enciende los
 * eventos que Kairo necesita. Zadarma valida la URL con `zd_echo`, así que
 * solo funciona sobre el dominio ya publicado.
 */
export async function POST(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      { error: "Falta ZADARMA_API_KEY / ZADARMA_API_SECRET." },
      { status: 503 }
    );
  }

  try {
    const url = expectedWebhookUrl(req);
    const result = await configureCallInfo(url);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al configurar el webhook";
    const status = err instanceof ZadarmaError ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * URL pública del webhook. Se prefiere NEXT_PUBLIC_APP_URL porque Zadarma
 * debe apuntar al dominio estable, no a la URL de un preview de Vercel.
 */
function expectedWebhookUrl(req: NextRequest): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").trim() || req.nextUrl.origin;
  return `${base.replace(/\/+$/, "")}/api/zadarma/webhook`;
}

function normalizeUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

/** Zadarma autoriza el dominio y sus subdominios. */
function sameHost(domain: string, host: string): boolean {
  const registered = String(domain || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  const current = host.toLowerCase();
  if (!registered) return false;
  return current === registered || current.endsWith(`.${registered}`);
}

function errorOf(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}

