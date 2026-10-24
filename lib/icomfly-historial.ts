// Pasada completa de iComfly (migracion 0051; el POR QUE esta ahi).
//
// Cada corrida sigue desde `next_page` y llama al mismo sync de siempre
// (runIcomflySync) en tramos de PAGINAS_POR_TRAMO: guarda el despacho y el
// pedido completo de cada pagina. Al llegar al final queda `completo` y la
// pasada siguiente empieza HORAS_ENTRE_PASADAS despues, para que un pedido
// viejo que se cancela o se entrega tambien se actualice.
//
// Volver a sincronizar un pedido viejo es seguro: la guia final y la
// confirmacion salen de las fechas del pedido, no del reloj.
//
// Lo de decidir es puro (decidirPasada, despuesDelTramo) y se prueba en
// tests/icomfly-historial.test.ts.

import { getDB } from "@/lib/db";
import { runIcomflySync, type SyncResult } from "@/lib/icomfly-sync";
import type { FinanceStoreCode } from "@/lib/store-config";

export const PAGINAS_POR_TRAMO = 20;
export const HORAS_ENTRE_PASADAS = 12;

const TABLA = "icomfly_historial_estado";

export interface EstadoHistorial {
  store_id: number;
  next_page: number;
  completo: boolean;
  pasadas: number;
  pedidos: number;
  pasada_iniciada_at: string | null;
  completado_at: string | null;
  ultimo_error: string | null;
}

export function estadoInicial(storeId: number): EstadoHistorial {
  return {
    store_id: storeId,
    next_page: 1,
    completo: false,
    pasadas: 0,
    pedidos: 0,
    pasada_iniciada_at: null,
    completado_at: null,
    ultimo_error: null,
  };
}

export type Decision = { accion: "esperar" } | { accion: "seguir"; estado: EstadoHistorial };

/** Que hace esta corrida: seguir la pasada, empezar otra o esperar. */
export function decidirPasada(estado: EstadoHistorial, now: Date): Decision {
  if (!estado.completo) {
    return {
      accion: "seguir",
      estado: { ...estado, pasada_iniciada_at: estado.pasada_iniciada_at ?? now.toISOString() },
    };
  }
  const terminada = estado.completado_at ? Date.parse(estado.completado_at) : 0;
  if (now.getTime() - terminada < HORAS_ENTRE_PASADAS * 3_600_000) return { accion: "esperar" };
  return {
    accion: "seguir",
    estado: {
      ...estado,
      next_page: 1,
      completo: false,
      pedidos: 0,
      pasada_iniciada_at: now.toISOString(),
      ultimo_error: null,
    },
  };
}

/**
 * El estado despues de un tramo. Si la pagina vino entera de otra tienda (el
 * caso de Honduras), no avanza: recorrer el resto seria leer otra tienda.
 */
export function despuesDelTramo(estado: EstadoHistorial, res: SyncResult, now: Date): EstadoHistorial {
  const ajena =
    res.otra_tienda > 0 ? `iComfly devolvió ${res.otra_tienda} pedidos de la tienda ${res.tiendas_ajenas.join(", ")}` : null;
  if (ajena && res.synced === 0) return { ...estado, ultimo_error: ajena };
  const pedidos = estado.pedidos + res.synced;
  if (res.next_page == null) {
    return {
      ...estado,
      pedidos,
      next_page: 1,
      completo: true,
      pasadas: estado.pasadas + 1,
      completado_at: now.toISOString(),
      ultimo_error: ajena,
    };
  }
  return { ...estado, pedidos, next_page: res.next_page, ultimo_error: ajena };
}

// ─── Base ────────────────────────────────────────────────────────────────────

async function leerEstado(storeId: number): Promise<EstadoHistorial> {
  const { data, error } = await getDB()
    .from(TABLA)
    .select("store_id,next_page,completo,pasadas,pedidos,pasada_iniciada_at,completado_at,ultimo_error")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw new Error(`leerEstado(historial iComfly): ${error.message}`);
  return (data as EstadoHistorial | null) ?? estadoInicial(storeId);
}

async function guardarEstado(estado: EstadoHistorial): Promise<void> {
  const { error } = await getDB()
    .from(TABLA)
    .upsert({ ...estado, actualizado_at: new Date().toISOString() }, { onConflict: "store_id" });
  if (error) throw new Error(`guardarEstado(historial iComfly): ${error.message}`);
}

// ─── Corrida ─────────────────────────────────────────────────────────────────

export interface ResumenHistorial {
  store: string;
  accion: Decision["accion"];
  paginas: number;
  pedidos: number;
  next_page?: number;
  completo?: boolean;
  error?: string;
}

/** Una corrida para una tienda: tramos de paginas hasta el `deadline`. */
export async function avanzarHistorial(
  store: { id: number; code: FinanceStoreCode },
  deadline: number,
  now: () => Date = () => new Date()
): Promise<ResumenHistorial> {
  const decision = decidirPasada(await leerEstado(store.id), now());
  if (decision.accion === "esperar") return { store: store.code, accion: "esperar", paginas: 0, pedidos: 0 };

  let estado = decision.estado;
  await guardarEstado(estado);
  let paginas = 0;
  let pedidos = 0;
  while (Date.now() < deadline && !estado.completo) {
    let res: SyncResult;
    try {
      res = await runIcomflySync({ store: store.code, startPage: estado.next_page, maxPages: PAGINAS_POR_TRAMO });
    } catch (err) {
      // iComfly caido o la base: queda anotado y la corrida siguiente retoma
      // desde la misma pagina.
      estado = { ...estado, ultimo_error: err instanceof Error ? err.message : String(err) };
      await guardarEstado(estado);
      break;
    }
    paginas += res.pages_fetched;
    pedidos += res.synced;
    const siguiente = despuesDelTramo(estado, res, now());
    await guardarEstado(siguiente);
    const avanzo = siguiente.completo || siguiente.next_page !== estado.next_page;
    estado = siguiente;
    if (!avanzo) break;
  }
  return {
    store: store.code,
    accion: "seguir",
    paginas,
    pedidos,
    next_page: estado.next_page,
    completo: estado.completo,
    ...(estado.ultimo_error ? { error: estado.ultimo_error } : {}),
  };
}
