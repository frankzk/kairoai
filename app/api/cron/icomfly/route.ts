import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runIcomflySync } from "@/lib/icomfly-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cron: refresca el estado de despacho desde iComfly. Publico (sin cookie),
// igual que el resto de crons del proyecto.
async function handle() {
  try {
    const stores = listConfiguredIcomflyStoreContexts();
    const targets = stores.length
      ? stores
      : [{ store: { code: "mireva-cr" as const }, externalStoreId: undefined }];
    const results = await Promise.all(
      targets.map((target) =>
        runIcomflySync({
          store: target.store.code,
          externalStoreId: target.externalStoreId,
        })
      )
    );
    return NextResponse.json({ stores_synced: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron iComfly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
