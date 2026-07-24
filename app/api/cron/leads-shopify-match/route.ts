import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { matchLeadsToShopifyOrders } from "@/lib/leads";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cron (1 vez/hora): cruza el telefono de cada lead contra las ordenes reales
// de Shopify y mueve a Ganados los que ya compraron. Todo el match ocurre en
// el servidor via RPC (una sola sentencia con indice), sin cargar ordenes en
// memoria de la app. Publico, como los demas crons.
async function handle() {
  try {
    const targets = listConfiguredIcomflyStoreContexts();
    const results = await Promise.all(
      targets.map((target) =>
        matchLeadsToShopifyOrders(target.store.id)
          .then((moved) => ({ store: target.store.code, moved }))
          .catch((err) => ({
            store: target.store.code,
            error: err instanceof Error ? err.message : String(err),
          }))
      )
    );
    return NextResponse.json({ stores: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron de cruce Shopify";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}
