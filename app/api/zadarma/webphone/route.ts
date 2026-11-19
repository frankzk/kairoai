import { NextRequest, NextResponse } from "next/server";
import { isZadarmaConfigured, ZadarmaError } from "@/lib/zadarma";
import { llaveWebrtc } from "@/lib/zadarma-webrtc-db";
import { devolverExtension, extensionesDeTienda, prestarExtension } from "@/lib/zadarma-prestamos";
import { identidadActual, vendedoraEfectiva } from "@/lib/identidad";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Teléfono de Zadarma de quien abre Kairo (components/ZadarmaPhone.tsx).
 *
 * GET ?store=&vendedora_id=: le presta una extensión libre del grupo
 * (lib/zadarma-prestamos.ts) y devuelve su llave WebRTC. El cliente nunca
 * elige la extensión: la decide el servidor.
 * POST { accion: "latido" | "devolver", sip }: la página sigue abierta (renueva
 * el préstamo) o se cerró (la libera). Sin latido 2 min, se libera sola.
 */
export async function GET(req: NextRequest) {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      { error: "Telefonia no configurada: falta ZADARMA_API_KEY / ZADARMA_API_SECRET." },
      { status: 503 }
    );
  }

  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  // Una asesora sin permiso de supervision queda SIEMPRE a su nombre
  // (lib/identidad.ts): el navegador no puede llamar a nombre de otra.
  const vendedoraId = vendedoraEfectiva(req.nextUrl.searchParams.get("vendedora_id"));

  try {
    const sip = await prestarExtension({ userId: yo.id, staffId: vendedoraId, storeId: store.id });
    if (!sip) {
      const total = await extensionesDeTienda(store.id).catch(() => 0);
      return NextResponse.json(
        { error: `Las ${total} extensiones de Zadarma están en uso. Se libera una cuando alguien cierra Kairo.`, code: "sin_extension" },
        { status: 409 },
      );
    }
    const force = req.nextUrl.searchParams.get("force") === "1";
    // Una sola consulta a Zadarma por extensión cada 48 h (lib/zadarma-webrtc-db.ts).
    const key = await llaveWebrtc(sip, force);
    return NextResponse.json({ sip, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al preparar el teléfono";
    const status = err instanceof ZadarmaError ? 502 : 500;
    const friendly = /zadarma_sip|column/.test(message)
      ? "Falta la columna payroll_staff.zadarma_sip: ejecuta supabase/migrations/0029_zadarma_calls.sql."
      : message;
    return NextResponse.json({ error: friendly }, { status });
  }
}

export async function POST(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  // sendBeacon manda texto plano; fetch, JSON. Se aceptan los dos.
  const body = (await req.text().then((t) => JSON.parse(t)).catch(() => null)) as {
    accion?: string;
    sip?: string;
    vendedora_id?: number;
  } | null;
  const sip = String(body?.sip ?? "");
  if (!/^[0-9]+-[0-9]{3}$/.test(sip)) return NextResponse.json({ error: "sip inválido" }, { status: 400 });
  if (body?.accion === "devolver") {
    await devolverExtension(yo.id, sip);
    return NextResponse.json({ ok: true });
  }
  // Latido: renueva el préstamo. Si la extensión ya no es suya (se venció y
  // la tomó otra persona), el teléfono se vuelve a conectar con otra.
  // La tienda va en ?store= para que el middleware compruebe que es de la persona.
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  try {
    const actual = await prestarExtension({ userId: yo.id, staffId: vendedoraEfectiva(body?.vendedora_id), storeId: store.id });
    return NextResponse.json({ ok: actual === sip, sip: actual });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo renovar" }, { status: 500 });
  }
}
