import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { FINANCE_STORES, getRequiredStoreFromBody, getRequiredStoreFromSearchParams, storeAllowed } from "@/lib/stores";
import { validarConfigTelefonia } from "@/lib/telefonia";
import { guardarConfigTelefonia, leerConfigTelefonia } from "@/lib/telefonia-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Telefonía por tienda (lib/telefonia.ts).
//   GET ?store=mireva-hn → { principal, respaldo }: lo leen el botón "Llamar"
//     y el teléfono de la página para montar uno u otro.
//   GET (sin store) → todas las tiendas, para Configuración (solo "config").
//   POST { store, principal, respaldo } → guarda (solo "config"; la regla por
//     método está en lib/permisos.ts y se vuelve a comprobar aquí).

export async function GET(req: NextRequest) {
  const yo = identidadActual();
  if (req.nextUrl.searchParams.get("store")) {
    const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
    if (!store) return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400, headers });
    const { principal, respaldo } = await leerConfigTelefonia(store.id);
    return NextResponse.json({ store: store.code, principal, respaldo }, { headers });
  }
  if (yo && !yo.permisos.includes("config")) {
    return NextResponse.json({ error: "Solo un administrador puede ver la telefonía de las tiendas." }, { status: 403, headers });
  }
  const tiendas = await Promise.all(
    FINANCE_STORES.filter((s) => storeAllowed(s.code)).map(async (s) => ({
      code: s.code,
      label: s.label,
      ...(await leerConfigTelefonia(s.id)),
    })),
  );
  return NextResponse.json({ tiendas }, { headers });
}

export async function POST(req: NextRequest) {
  const yo = identidadActual();
  if (yo && !yo.permisos.includes("config")) {
    return NextResponse.json({ error: "Solo un administrador puede cambiar la telefonía." }, { status: 403, headers });
  }
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store || !storeAllowed(store.code)) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400, headers });
  }
  const config = validarConfigTelefonia(body);
  if (!config) {
    return NextResponse.json(
      { error: "Elige el proveedor principal (Zadarma o Telnyx) y, de respaldo, el otro o ninguno." },
      { status: 400, headers },
    );
  }
  try {
    await guardarConfigTelefonia(store.id, config, yo ? `${yo.id}:${yo.nombre}` : "sistema");
    return NextResponse.json({ ok: true, ...(await leerConfigTelefonia(store.id)) }, { headers });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo guardar." }, { status: 500, headers });
  }
}
