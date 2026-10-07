import { NextRequest, NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runLeadsInboundSync } from "@/lib/leads-inbound-sync";
import { withCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
// Nunca pre-ejecutar en el build: un cron solo corre cuando lo llaman.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HISTORIA. Se apago el 29/08/2026 (#217): Supabase rechazaba conexiones
// (Cloudflare 522) y este era el cron de escritura nuevo de ese dia, asi que
// se saco de vercel.json por las dudas. Nunca se volvio a prender, y nada lo
// avisaba: del 29/08 al 07/10, 4.863 de los 4.872 leads nuevos de Costa Rica
// quedaron sin conteo de mensajes y el tablero los mostraba como "Solo
// saludó" aunque hubieran conversado (de 20 leads leidos al volver, 14 habian
// escrito entre 2 y 8 mensajes).
//
// SE VOLVIO A PRENDER el 07/10 despues de medir la carga, que es chica: la
// consulta de la cola tarda 0,5 s y una corrida escribe como mucho 150 filas
// por tienda (una por lead). Una corrida manual de 20+20 leads tardo 1,4 s.
// Va cada 10 minutos al minuto 7, para no coincidir con `leads` (cada 5) ni
// con `leads-reclassify` (minuto 2). Si se atrasa, la tira de salud lo dice.
//
// Cron: lee el transcript de Icomfly y guarda cuantos mensajes escribio el
// cliente (inbound_count) y cual fue el primero (first_inbound_text). Es lo que
// llena el segmento "Converso" del tablero de leads.
//
// La cola se ordena sola: primero los que nunca se leyeron, y dentro de esos
// los de interaccion mas reciente — que son los que se ven en el tablero. El
// relleno historico va quedando para el final, sin bloquear lo del dia.
//
// El barrido TERMINA: `inbound_synced_at` hace de cursor y un lead solo vuelve
// a la cola si su conversacion crecio. Cuando no queda nada pendiente, la
// corrida no hace ni una llamada a Icomfly.

// Presupuesto por tienda, dejando margen antes del maxDuration de 60s.
const TIME_BUDGET_MS = 22_000;

async function handle(req: NextRequest) {
  const startedAt = Date.now();
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const maxLeads = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  try {
    const targets = listConfiguredIcomflyStoreContexts();
    const results = [];
    // Secuencial y con presupuesto propio por tienda: Icomfly es de un tercero
    // y no conviene abrirle el doble de conexiones en paralelo.
    for (const target of targets) {
      results.push(
        await runLeadsInboundSync({
          store: target.store.code,
          externalStoreId: target.externalStoreId,
          maxLeads,
          timeBudgetMs: TIME_BUDGET_MS,
          startedAt: Date.now(),
        })
      );
    }
    return NextResponse.json({
      ok: true,
      elapsed_ms: Date.now() - startedAt,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error en cron leads-inbound";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleGet(req: NextRequest) {
  return handle(req);
}

async function handlePost(req: NextRequest) {
  return handle(req);
}

export const GET = withCronRun("leads-inbound", handleGet);
export const POST = withCronRun("leads-inbound", handlePost);
