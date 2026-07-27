import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runLeadsSync } from "@/lib/leads-sync";
import { runShopifyDraftCartSync } from "@/lib/shopify-draft-carts";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";

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
    // Los Borradores de Shopify son una fuente independiente de Icomfly.
    // Cada tienda falla de forma aislada para no bloquear las demas ni la
    // ingesta de conversaciones.
    const draftResults = await Promise.all(
      FINANCE_STORES.map((store) =>
        runShopifyDraftCartSync(getStoreConfig(store.code)).catch((err) => ({
          store: store.code,
          error: err instanceof Error ? err.message : String(err),
        }))
      )
    );
    return NextResponse.json({
      stores_synced: results.length,
      results,
      shopify_drafts: draftResults,
    });
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
