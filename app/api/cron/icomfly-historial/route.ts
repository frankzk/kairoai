import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { avanzarHistorial, type ResumenHistorial } from "@/lib/icomfly-historial";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POR QUE EXISTE: el cron de iComfly lee solo los 500 pedidos mas nuevos.
// Este recorre TODAS las paginas (lib/icomfly-historial.ts) para tener el
// pedido completo de la historia y actualizar los viejos que cambian. Reanuda
// donde quedo; al terminar, la pasada siguiente empieza unas horas despues.
const TIME_BUDGET_MS = 200_000;

async function handleGet() {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const targets = listConfiguredIcomflyStoreContexts();
  // El tiempo se reparte: cada tienda tiene su parte del presupuesto.
  const results: ResumenHistorial[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const { store } = targets[i];
    const restantes = targets.length - i;
    const tope = Date.now() + Math.max(0, deadline - Date.now()) / restantes;
    try {
      results.push(await avanzarHistorial(store, tope));
    } catch (err) {
      results.push({
        store: store.code,
        accion: "seguir",
        paginas: 0,
        pedidos: 0,
        error: err instanceof Error ? err.message : "Error",
      });
    }
  }
  const errores = results.filter((r) => r.error).map((r) => `${r.store}: ${r.error}`);
  return NextResponse.json({
    results,
    ...(errores.length ? { ok: false, error: errores.join("; ") } : {}),
  });
}

export const GET = withCronRun("icomfly-historial", handleGet);
