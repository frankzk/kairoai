import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-runs";
import { copiarGrabacionesPendientes } from "@/lib/grabaciones";
import { telnyxApiConfig } from "@/lib/telnyx";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Grabaciones por corrida, de a una. */
const LIMITE_POR_CORRIDA = 40;
/** Despues de esto no se empieza otra copia: 30 s + una descarga de 15 s + la subida caben en 60 s. */
const PRESUPUESTO_MS = 30_000;
const TIMEOUT_DESCARGA_MS = 15_000;

// Cron: copia a nuestro bucket las grabaciones que el webhook de Telnyx no
// alcanzo a guardar (con un enlace nuevo pedido con el recording_id) y, con lo
// que quede, las viejas de Zadarma cuyo enlace todavia sirva. Ver
// lib/grabaciones.ts. Sin TELNYX_API_KEY solo intenta las de Zadarma.
async function handle() {
  try {
    const resumen = await copiarGrabacionesPendientes({
      cfg: telnyxApiConfig(),
      limite: LIMITE_POR_CORRIDA,
      hastaMs: Date.now() + PRESUPUESTO_MS,
      timeoutMs: TIMEOUT_DESCARGA_MS,
    });
    return NextResponse.json(resumen, { status: resumen.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    return NextResponse.json({ ok: false, error: `Error en el cron de grabaciones: ${message}`.slice(0, 300) }, { status: 500 });
  }
}

export const GET = withCronRun("call-recordings", handle);
