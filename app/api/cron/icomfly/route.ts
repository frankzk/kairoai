import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { errorDeTienda, runIcomflySync } from "@/lib/icomfly-sync";
import { withCronRun } from "@/lib/cron-runs";
import { getFinanceStore } from "@/lib/store-config";
import { refreshFinanceDatasetCache } from "@/app/api/finance/_shared/orders-dataset";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const error = errorDeTienda(results.map((result, i) => ({ store: targets[i].store.code, result })));
    // La tabla de Gestion se rearma aca y no solo en finance-index (cada hora):
    // un pedido nuevo de iComfly se ve en 30 minutos. Una tienda tras otra, y
    // un fallo de la tabla no tumba la sincronizacion.
    const tablas: Record<string, string> = {};
    for (const target of targets) {
      tablas[target.store.code] = await refreshFinanceDatasetCache(getFinanceStore(target.store.code))
        .then((filas) => `${filas} filas`)
        .catch((err) => `error: ${err instanceof Error ? err.message : err}`);
    }
    return NextResponse.json({
      stores_synced: results.length,
      results,
      tablas,
      ...(error ? { ok: false, error } : {}),
    });
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
