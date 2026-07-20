import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { reclassifyStage } from "@/lib/leads-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron: afina el bucket "Por cerrar" leyendo el chat, en LOTES. Cada corrida
// revisa un tope de conversaciones y avanza el cursor, para no exceder el
// tiempo y ir actualizando progresivamente. Publico, como los demas crons.
async function handle() {
  try {
    const stores = listConfiguredIcomflyStoreContexts();
    const targets = stores.length
      ? stores
      : [{ store: { code: "mireva-cr" as const }, externalStoreId: undefined }];
    const results = await Promise.all(
      targets.map((target) =>
        reclassifyStage({
          store: target.store.code,
          externalStoreId: target.externalStoreId,
          maxLeads: 100,
        }).catch((err) => ({
          store: target.store.code,
          error: err instanceof Error ? err.message : String(err),
        }))
      )
    );
    return NextResponse.json({ stores: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron de reclasificacion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
