import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { matchLeadsToNearbyOrders, matchLeadsToShopifyOrders } from "@/lib/leads";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cron (1 vez/hora): cruza el telefono de cada lead contra las ordenes reales
// de Shopify y mueve a Ganados los que ya compraron. Todo el match ocurre en
// el servidor via RPC (una sola sentencia con indice), sin cargar ordenes en
// memoria de la app. Publico, como los demas crons.
//
// Despues, una segunda pasada para quien compro con un telefono casi igual
// (un digito mal escrito en el formulario) o con otro numero pero el mismo
// nombre completo y producto: ver lib/leads-pedido-parecido.ts.
async function handle() {
  try {
    const targets = listConfiguredIcomflyStoreContexts();
    const results = await Promise.all(
      targets.map((target) =>
        matchLeadsToShopifyOrders(target.store.id)
          .then(async (moved) => ({
            store: target.store.code,
            moved,
            parecidos: await matchLeadsToNearbyOrders(target.store.id),
          }))
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

async function handleGet() {
  return handle();
}

async function handlePost() {
  return handle();
}

export const GET = withCronRun("leads-shopify-match", handleGet);
export const POST = withCronRun("leads-shopify-match", handlePost);
