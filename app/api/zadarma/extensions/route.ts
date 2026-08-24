import { NextResponse } from "next/server";
import { listExtensionAssignments } from "@/lib/zadarma-calls";
import {
  getPbxExtensions,
  isExtensionOnline,
  isZadarmaConfigured,
  ZadarmaError,
} from "@/lib/zadarma";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Extensiones de la centralita y a quién está asignada cada una. Alimenta el
 * selector del catálogo de personal, para no tener que escribir el login a
 * mano ni adivinar cuáles existen.
 */
export async function GET() {
  if (!isZadarmaConfigured()) {
    return NextResponse.json(
      { extensions: [], error: "Telefonía no configurada: falta ZADARMA_API_KEY / ZADARMA_API_SECRET." },
      { status: 503 }
    );
  }

  try {
    const [{ pbxId, extensions }, assigned] = await Promise.all([
      getPbxExtensions(),
      listExtensionAssignments(),
    ]);

    // El estado de registro es lo que distingue "el widget se ve" de "el
    // telefono existe": sin registro la centralita no puede timbrar.
    const online = await Promise.all(extensions.map((e) => isExtensionOnline(e.sip)));

    return NextResponse.json({
      pbx_id: pbxId,
      extensions: extensions.map((extension, index) => ({
        ...extension,
        assigned_to: assigned.get(extension.sip) ?? null,
        online: online[index],
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer las extensiones";
    const status = err instanceof ZadarmaError ? 502 : 500;
    return NextResponse.json({ extensions: [], error: message }, { status });
  }
}

