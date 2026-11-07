import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { FINANCE_STORES, getRequiredStoreFromBody, storeAllowed } from "@/lib/stores";
import { puedeConfigurarReparto } from "@/lib/leads-assignment";
import {
  listRepartibleAdvisors,
  readAssignmentSettings,
  setAssignmentEnabled,
} from "@/lib/leads-assignment-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Interruptor del reparto automático de leads, por tienda (Configuración).
// Solo quien administra configuración o usuarios. El middleware ya exige uno
// de esos permisos (lib/permisos.ts); se vuelve a comprobar acá.

function sinPermiso() {
  return NextResponse.json(
    { error: "Solo un administrador puede cambiar el reparto de leads." },
    { status: 403, headers }
  );
}

export async function GET() {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!puedeConfigurarReparto(yo.permisos)) return sinPermiso();
  try {
    const stores = await Promise.all(
      FINANCE_STORES.filter((s) => storeAllowed(s.code)).map(async (s) => {
        const [settings, asesoras] = await Promise.all([
          readAssignmentSettings(s.id),
          listRepartibleAdvisors(s.code).catch(() => [] as string[]),
        ]);
        return { code: s.code, label: s.label, ...settings, asesoras };
      })
    );
    return NextResponse.json({ stores }, { headers });
  } catch (err) {
    console.error("[leads assignment-settings GET]", err);
    return NextResponse.json({ error: "No se pudo leer el reparto de leads." }, { status: 500, headers });
  }
}

export async function POST(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!puedeConfigurarReparto(yo.permisos)) return sinPermiso();
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403, headers });
  }
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) return NextResponse.json({ error: "Tienda no permitida." }, { status: 400, headers });
  const enabled = (body as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Falta indicar si se enciende o se apaga." }, { status: 400, headers });
  }
  try {
    const settings = await setAssignmentEnabled(store.id, enabled, yo.nombre || `usuario ${yo.id}`);
    if (!settings.available) {
      return NextResponse.json(
        { error: "Pendiente: aplicar la migración del reparto de leads.", ...settings },
        { status: 409, headers }
      );
    }
    return NextResponse.json({ code: store.code, label: store.label, ...settings }, { headers });
  } catch (err) {
    console.error(`[leads assignment-settings POST] ${store.code}:`, err);
    return NextResponse.json({ error: "No se pudo guardar el reparto de leads." }, { status: 500, headers });
  }
}
