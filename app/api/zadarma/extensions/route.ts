import { NextResponse } from "next/server";
import { getDB } from "@/lib/db";
import { getPbxExtensions, isZadarmaConfigured, ZadarmaError } from "@/lib/zadarma";

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
      listAssignments(),
    ]);

    return NextResponse.json({
      pbx_id: pbxId,
      extensions: extensions.map((extension) => ({
        ...extension,
        assigned_to: assigned.get(extension.sip) ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer las extensiones";
    const status = err instanceof ZadarmaError ? 502 : 500;
    return NextResponse.json({ extensions: [], error: message }, { status });
  }
}

/** sip -> nombre de la persona que ya lo tiene. */
async function listAssignments(): Promise<Map<string, string>> {
  const { data, error } = await getDB()
    .from("payroll_staff")
    .select("name, zadarma_sip")
    .not("zadarma_sip", "is", null);
  if (error) {
    // Sin la migracion 0028 no hay asignaciones todavia; la lista de la
    // centralita sigue siendo util.
    console.warn(`[zadarma/extensions] sin asignaciones: ${error.message}`);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ name: string; zadarma_sip: string | null }>) {
    if (row.zadarma_sip) map.set(row.zadarma_sip, row.name);
  }
  return map;
}
