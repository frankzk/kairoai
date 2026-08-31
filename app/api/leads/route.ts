import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import {
  countLeadStages,
  leadBoardStage,
  listLeads,
  searchLeads,
  searchLeadsByPhoneSimilar,
  type LeadScope,
} from "@/lib/leads";
import { runLeadsSync, reclassifyStage } from "@/lib/leads-sync";
import { BOARD_VIEWS } from "@/lib/leads-classify";
import { isInCallQueue, leadSegment, leadWorkState } from "@/lib/leads-segment";
import { daysAgoIso } from "@/lib/leads-metrics";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET: tablero de leads de la tienda (agrupado por bucket + conteos).
export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    // Busqueda: se resuelve en Postgres sobre toda la tabla de la tienda, sin
    // ventana ni scope. El tablero antes se bajaba el archivo entero (~3.800
    // leads en Costa Rica) solo para filtrarlo en memoria.
    const q = req.nextUrl.searchParams.get("q") ?? "";
    if (q.trim()) {
      let encontrados = await searchLeads(store.id, q);
      // Plan B para telefonos: la busqueda exacta pide la secuencia completa,
      // asi que un digito mal tecleado da cero resultados y ninguna pista. Si
      // no hubo nada, se ofrecen los parecidos en vez de un "sin resultados"
      // que hace dar por perdido un lead que si existe.
      let aproximado = false;
      if (encontrados.length === 0) {
        const parecidos = await searchLeadsByPhoneSimilar(store.id, q).catch(() => []);
        if (parecidos.length > 0) {
          encontrados = parecidos;
          aproximado = true;
        }
      }
      return NextResponse.json({
        store: store.code,
        views: BOARD_VIEWS,
        scope: "busqueda",
        // El tablero lo usa para avisar que no son coincidencias exactas.
        aproximado,
        counts: null,
        // Los resultados de busqueda tambien llevan los dos ejes: el filtro por
        // segmento sigue funcionando dentro de una busqueda.
        leads: encontrados.map((lead) => ({
          ...lead,
          board_stage: leadBoardStage(lead),
          work_state: leadWorkState(lead),
          segment: leadSegment(lead),
          in_call_queue: isInCallQueue(lead),
        })),
      });
    }

    // Por defecto ocultamos leads con mas de 30 dias sin interaccion; ?all=1
    // los incluye.
    const includeAll = req.nextUrl.searchParams.get("all") === "1";
    const sinceIso = includeAll ? undefined : daysAgoIso(new Date(), 30);
    // El tablero pide primero lo que hay que trabajar; Cerrados y Descartados
    // se piden aparte (?scope=archivo) solo cuando alguien los abre o busca.
    // Antes venia todo junto con un tope de 2.000 filas y el archivo -- que es
    // mas de la mitad de la tabla -- dejaba fuera de la pantalla a los leads
    // que si hay que llamar.
    const scope: LeadScope =
      req.nextUrl.searchParams.get("scope") === "archivo" ? "archivo" : "trabajo";
    const leads = await listLeads({ storeId: store.id, sinceIso, scope, limit: 20000 });
    // Los dos ejes viajan por separado: board_stage sigue alimentando el orden
    // y las etiquetas de estado, mientras work_state/segment son las facetas
    // independientes del tablero (ver lib/leads-segment.ts).
    const withStage = leads.map((lead) => ({
      ...lead,
      board_stage: leadBoardStage(lead),
      work_state: leadWorkState(lead),
      segment: leadSegment(lead),
      in_call_queue: isInCallQueue(lead),
    }));
    // Los contadores se cuentan SIEMPRE contra toda la poblacion elegible, no
    // contra la mitad que se acaba de traer: son el numero que el equipo usa
    // para decidir a que etapa entrarle.
    //
    // Y si fallan, NO se llevan puesta la lista. Los contadores son un adorno
    // util; los leads son el trabajo del dia. Cuando esto iba dentro del try
    // general, un error de los contadores devolvia `leads: []` con 500 y la
    // asesora se quedaba sin tablero: paso de verdad al agregarle un parametro
    // al RPC, que dejo dos sobrecargas vivas un minuto. Se avisa el error, se
    // muestra la lista.
    let counts: Awaited<ReturnType<typeof countLeadStages>> | null = null;
    let countsError: string | undefined;
    if (scope === "trabajo") {
      try {
        counts = await countLeadStages(store.id, sinceIso);
      } catch (err) {
        countsError = err instanceof Error ? err.message : "Error contando etapas";
        console.error(`[leads counts] ${store.code}: ${countsError}`);
      }
    }
    return NextResponse.json({
      store: store.code,
      views: BOARD_VIEWS,
      scope,
      counts,
      counts_error: countsError,
      leads: withStage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer leads";
    // Se registra ANTES de responder. Sin esto, un 500 aqui no deja rastro en
    // el servidor: el motivo viaja en el cuerpo de la respuesta, que solo ve
    // el navegador de quien lo sufrio. Paso de verdad — 12 errores 500 en dos
    // horas y el panel de errores de Vercel decia "no runtime errors", porque
    // nadie los escribia. Se apuntan los parametros que deciden la consulta,
    // que es lo unico que permite reproducirla.
    console.error(
      `[leads GET] ${store.code} scope=${req.nextUrl.searchParams.get("scope") ?? "trabajo"} ` +
        `q=${req.nextUrl.searchParams.get("q") ? "si" : "no"} ` +
        `all=${req.nextUrl.searchParams.get("all") ?? "0"}: ${message}`
    );
    return NextResponse.json({ leads: [], counts: null, error: message }, { status: 500 });
  }
}

// POST: dispara la sincronizacion/clasificacion manual desde el tablero.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const store = getRequiredStoreFromBody(body);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa mireva-cr o mireva-hn" },
      { status: 400 }
    );
  }
  try {
    const payload = (body ?? {}) as Record<string, unknown>;
    // Barrido fino: lee el chat de los leads de "por cerrar" y mueve a Ganados
    // los que ya son pedido confirmado.
    if (payload.reclassify) {
      const result = await reclassifyStage({ store: store.code });
      return NextResponse.json(result);
    }
    const result = await runLeadsSync({
      store: store.code,
      deep: payload.deep === true || payload.deep === "1",
      maxPages: payload.max_pages != null ? Number(payload.max_pages) : undefined,
      startPage: payload.page != null ? Number(payload.page) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error sincronizando leads";
    console.error(`[leads POST] ${store.code}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
