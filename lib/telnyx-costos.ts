// Cuanto costaron las llamadas de Telnyx: hoy y este mes, por tienda y por
// asesora. El costo de cada llamada lo escribe el webhook con el evento
// call.cost (lib/telnyx-calls.ts). Las llamadas anteriores al 03/11/2026, o
// las que Telnyx no pudo calcular, quedan "sin costo": se cuentan aparte para
// no hacer pasar un total parcial por completo.

import { getDB } from "@/lib/db";
import { getFinanceStoreById } from "@/lib/store-config";
import { esLlamadaReal } from "@/lib/telnyx";

const TZ = "America/Costa_Rica";

export interface FilaCosto {
  store_id: number | null;
  vendedora: number | null;
  status: string | null;
  started_at: string | null;
  answered_at: string | null;
  cost: number | string | null;
  cost_currency: string | null;
  billed_seconds: number | null;
}

export interface GrupoCosto {
  clave: string;
  nombre: string;
  llamadas: number;
  contestadas: number;
  /** Llamadas con costo informado por Telnyx. */
  conCosto: number;
  /** Total por moneda (Telnyx cobra en la moneda de la cuenta, USD). */
  total: Record<string, number>;
  minutosCobrados: number;
}

export interface ResumenPeriodo {
  desde: string;
  general: GrupoCosto;
  porTienda: GrupoCosto[];
  porAsesora: GrupoCosto[];
}

/** Medianoche de hoy y del dia 1 del mes en Costa Rica (UTC-6, sin horario de verano). */
export function iniciosDePeriodo(ahora: Date = new Date()): { hoy: string; mes: string } {
  const fecha = ahora.toLocaleDateString("en-CA", { timeZone: TZ }); // AAAA-MM-DD
  return {
    hoy: new Date(`${fecha}T00:00:00-06:00`).toISOString(),
    mes: new Date(`${fecha.slice(0, 8)}01T00:00:00-06:00`).toISOString(),
  };
}

function grupoVacio(clave: string, nombre: string): GrupoCosto {
  return { clave, nombre, llamadas: 0, contestadas: 0, conCosto: 0, total: {}, minutosCobrados: 0 };
}

function sumar(g: GrupoCosto, f: FilaCosto): void {
  g.llamadas++;
  if (f.answered_at) g.contestadas++;
  const costo = f.cost == null ? null : Number(f.cost);
  if (costo != null && Number.isFinite(costo)) {
    g.conCosto++;
    const moneda = (f.cost_currency || "USD").toUpperCase();
    g.total[moneda] = (g.total[moneda] ?? 0) + costo;
    g.minutosCobrados += (f.billed_seconds ?? 0) / 60;
  }
}

/** Agrupa las llamadas del periodo. Puro: se prueba sin base. */
export function resumirCostos(
  filas: FilaCosto[],
  desde: string,
  nombres: Map<number, string>,
  nombreTienda: (id: number) => string
): ResumenPeriodo {
  const general = grupoVacio("todas", "Todas");
  const tiendas = new Map<string, GrupoCosto>();
  const asesoras = new Map<string, GrupoCosto>();
  for (const f of filas) {
    if (!f.started_at || f.started_at < desde || !esLlamadaReal(f)) continue;
    sumar(general, f);
    const t = String(f.store_id ?? "sin");
    if (!tiendas.has(t)) tiendas.set(t, grupoVacio(t, f.store_id != null ? nombreTienda(f.store_id) : "Sin tienda"));
    sumar(tiendas.get(t)!, f);
    const a = String(f.vendedora ?? "sin");
    if (!asesoras.has(a)) {
      asesoras.set(a, grupoVacio(a, f.vendedora != null ? nombres.get(f.vendedora) ?? `Asesora ${f.vendedora}` : "Sin asesora"));
    }
    sumar(asesoras.get(a)!, f);
  }
  const porTotal = (x: GrupoCosto, y: GrupoCosto) =>
    Object.values(y.total).reduce((s, v) => s + v, 0) - Object.values(x.total).reduce((s, v) => s + v, 0) ||
    y.llamadas - x.llamadas;
  return {
    desde,
    general,
    porTienda: Array.from(tiendas.values()).sort(porTotal),
    porAsesora: Array.from(asesoras.values()).sort(porTotal),
  };
}

const PAGINA = 1000;

/** Las llamadas de Telnyx de este mes y el resumen de hoy y del mes. */
export async function costosTelnyx(ahora: Date = new Date()): Promise<{ hoy: ResumenPeriodo; mes: ResumenPeriodo }> {
  const { hoy, mes } = iniciosDePeriodo(ahora);
  const db = getDB();
  const filas: FilaCosto[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await db
      .from("zadarma_calls")
      .select("store_id,vendedora,status,started_at,answered_at,cost,cost_currency,billed_seconds")
      .eq("provider", "telnyx")
      .gte("started_at", mes)
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`costosTelnyx: ${error.message}`);
    const pagina = (data ?? []) as FilaCosto[];
    filas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  const ids = Array.from(new Set(filas.map((f) => f.vendedora).filter((v): v is number => v != null)));
  const nombres = new Map<number, string>();
  if (ids.length) {
    const { data } = await db.from("payroll_staff").select("id,name").in("id", ids);
    for (const s of (data ?? []) as Array<{ id: number; name: string }>) nombres.set(s.id, s.name);
  }
  const nombreTienda = (id: number) => getFinanceStoreById(id)?.label ?? `Tienda ${id}`;
  return {
    hoy: resumirCostos(filas, hoy, nombres, nombreTienda),
    mes: resumirCostos(filas, mes, nombres, nombreTienda),
  };
}
