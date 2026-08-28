import { NextRequest, NextResponse } from "next/server";
import { listConfiguredIcomflyStoreContexts } from "@/lib/icomfly";
import { runLeadsInboundSync } from "@/lib/leads-inbound-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
