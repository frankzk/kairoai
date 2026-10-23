import { NextRequest, NextResponse } from "next/server";
import { FINANCE_STORES, getStoreConfig } from "@/lib/stores";
import { archivarTienda, type ResumenTienda } from "@/lib/shopify-archivo";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POR QUE EXISTE: las tiendas de Shopify se suspenden el 28/10/2026. Este cron
// guarda el objeto completo de cada pedido, cliente y producto, y copia las
// fotos del catalogo (lib/shopify-archivo.ts). Reanudable: cada corrida sigue
// donde quedo la anterior. Despues del 28 Shopify ya no responde y el cron solo
// anota el error; no borra ni toca lo guardado.
const TIME_BUDGET_MS = 200_000;

async function handleGet(req: NextRequest) {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const storeFilter = req.nextUrl.searchParams.get("store");
  const targetStores = storeFilter
    ? FINANCE_STORES.filter((store) => store.code === storeFilter)
    : FINANCE_STORES;

  // El tiempo se reparte: cada tienda tiene su parte del presupuesto, para que
  // una no deje a la otra sin respaldo.
  const results: ResumenTienda[] = [];
  for (let i = 0; i < targetStores.length; i += 1) {
    const store = getStoreConfig(targetStores[i].code);
    const restantes = targetStores.length - i;
    const tope = Date.now() + Math.max(0, deadline - Date.now()) / restantes;
    try {
      results.push(await archivarTienda(store, tope));
    } catch (err) {
      results.push({ store: store.code, recursos: [], error: err instanceof Error ? err.message : "Error" });
    }
  }
  return NextResponse.json({ ok: true, results });
}

export const GET = withCronRun("shopify-archivo", handleGet);
