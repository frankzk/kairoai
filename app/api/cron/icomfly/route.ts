import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runIcomflySync } from "@/lib/icomfly-sync";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
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

async function handleGet() {
  return handle();
}

async function handlePost() {
  return handle();
}

export const GET = withCronRun("icomfly", handleGet);
export const POST = withCronRun("icomfly", handlePost);
