import { NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import {
  avanzarAnunciosWhatsapp,
  type WhatsappAdRunSummary,
} from "@/lib/icomfly-whatsapp-ad-db";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POR QUE EXISTE (27/11/2026): los pedidos de WhatsApp no traen UTM, y
// Marketing no sabía si una venta del bot vino de un anuncio. iComfly sí sabe
// qué anuncio de Meta inició el chat: este cron lo trae, de a poco (≤ 60
// pedidos por tienda por corrida), a icomfly_whatsapp_ad_origins, y lee en
// Meta la campaña de cada anuncio nuevo. Ver lib/icomfly-whatsapp-ad-db.ts.
// Un error de una tienda se cuenta en el resumen; nunca corta la otra.
const TIME_BUDGET_MS = 45_000;

async function handleGet() {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const targets = listConfiguredIcomflyStoreContexts();
  const results: WhatsappAdRunSummary[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const { store } = targets[i];
    // El tiempo se reparte: cada tienda tiene su parte del presupuesto.
    const tope = Date.now() + Math.max(0, deadline - Date.now()) / (targets.length - i);
    results.push(await avanzarAnunciosWhatsapp(store, tope));
  }
  const errores = results.filter((r) => r.error).map((r) => `${r.store}: ${r.error}`);
  return NextResponse.json({
    results,
    ...(errores.length ? { ok: false, error: errores.join("; ") } : {}),
  });
}

export const GET = withCronRun("icomfly-whatsapp-ads", handleGet);
