import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-runs";
import { runLeadAssignment } from "@/lib/leads-assignment-server";
import { FINANCE_STORES } from "@/lib/stores";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron (cada 5 min): reparte los leads abiertos entre las asesoras activas de
// cada tienda que tenga el reparto encendido en Configuración. Apagado (o sin
// la migración) no hace nada y responde ok. Reglas en lib/leads-assignment.ts.
async function handle() {
  const results = await Promise.all(
    FINANCE_STORES.map((store) =>
      runLeadAssignment({ id: store.id, code: store.code }).catch((err) => ({
        store: store.code,
        error: err instanceof Error ? err.message : String(err),
      }))
    )
  );
  const fallidas = results.filter((r) => "error" in r);
  return NextResponse.json(
    {
      ok: fallidas.length === 0,
      ...(fallidas.length ? { error: fallidas.map((r) => `${r.store}: ${(r as { error: string }).error}`).join(" · ") } : {}),
      results,
    },
    { status: fallidas.length ? 500 : 200 }
  );
}

export const GET = withCronRun("leads-assignment", handle);
export const POST = withCronRun("leads-assignment", handle);
