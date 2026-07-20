import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runLeadsSync } from "@/lib/leads-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron: ingiere y clasifica conversaciones de WhatsApp desde Icomfly.
// Publico (sin cookie), igual que el resto de crons del proyecto.
async function handle() {
  try {
    const stores = listConfiguredIcomflyStoreContexts();
    const targets = stores.length
      ? stores
      : [{ store: { code: "mireva-cr" as const }, externalStoreId: undefined }];
    const results = await Promise.all(
      targets.map((target) =>
        runLeadsSync({
          store: target.store.code,
          externalStoreId: target.externalStoreId,
        }).catch((err) => ({
          store: target.store.code,
          error: err instanceof Error ? err.message : String(err),
        }))
      )
    );
    return NextResponse.json({ stores_synced: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron de leads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
