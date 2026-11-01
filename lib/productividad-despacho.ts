// Productividad de despacho: quien despacha (genera la guia en iComfly) y
// quien confirma cada pedido, por persona y por dia. Ventana "Productividad"
// de Gestion (boton en la tabla de Pedidos).
//
// iComfly manda la atribucion de cada pedido en raw_attribution (sincronizado
// en icomfly_orders): "confirmo" (con hora), "genero_guia" y "envio" (sin
// hora), "cancelo". La hora del despacho es guide_final_at: cuando el pedido
// quedo con guia final. "Despacho solicitado" ya no trae fecha (24/10/2026),
// por eso no se usa.
//
// El bot de iComfly confirma a nombre de "Asistente Logístico" (220 de 384
// confirmaciones en Costa Rica en 7 dias): se marca aparte para no
// confundirlo con una persona.
//
// Puro: se prueba en tests/productividad-despacho.test.ts.

import { localDateKey } from "@/lib/leads-metrics";

export interface AtribucionPedido {
  guide_final_at: string | null;
  confirmed_at: string | null;
  /** Quien genero la guia (raw_attribution.genero_guia.name). */
  guia_por: string | null;
  /** Quien confirmo (raw_attribution.confirmo.name). */
  confirmo_por: string | null;
  /** Estado actual de ese mismo pedido en iComfly. */
  estado_actual?: string | null;
}

/** One completed replacement counts as one upsell, regardless of units sold. */
export interface UpsellCompletado {
  id: string;
  advisor_name: string | null;
  completed_at: string | null;
}

export interface PersonaDespacho {
  nombre: string;
  /** El asistente de IA de iComfly, no una persona. */
  esIa: boolean;
  despachados: number;
  /** Entregados actualmente, entre sus despachos del rango seleccionado. */
  entregados: number;
  /** Devoluciones/no entregados finales; no incluye cancelaciones ni novedades abiertas. */
  no_entregados: number;
  confirmados: number;
  upsells: number;
  /** Despachados por dia local (YYYY-MM-DD). */
  porDia: Record<string, number>;
}

export interface ResumenDespacho {
  personas: PersonaDespacho[];
  /** Los dias locales del rango, en orden. */
  dias: string[];
  despachados: number;
  entregados: number;
  no_entregados: number;
  confirmados: number;
  upsells: number;
}

const IA = /asistente\s+log[ií]stico/i;
export const SIN_NOMBRE = "Sin nombre";

function enRango(valor: string | null, desde: number, hasta: number): boolean {
  if (!valor) return false;
  const t = new Date(valor).getTime();
  return Number.isFinite(t) && t >= desde && t < hasta;
}

/** Los dias locales entre desde (incluido) y hasta (excluido). */
export function diasDelRango(desdeIso: string, hastaIso: string): string[] {
  const primero = localDateKey(desdeIso);
  const ultimo = localDateKey(new Date(new Date(hastaIso).getTime() - 1));
  if (!primero || !ultimo || primero > ultimo) return [];
  const dias: string[] = [];
  for (let t = Date.parse(`${primero}T00:00:00Z`); ; t += 86400_000) {
    const dia = new Date(t).toISOString().slice(0, 10);
    dias.push(dia);
    if (dia >= ultimo) return dias;
  }
}

export function resumenDespacho(filas: AtribucionPedido[], desdeIso: string, hastaIso: string, ventasAdicionales: UpsellCompletado[] = []): ResumenDespacho {
  const desde = new Date(desdeIso).getTime();
  const hasta = new Date(hastaIso).getTime();
  const personas = new Map<string, PersonaDespacho>();
  const persona = (crudo: string | null): PersonaDespacho => {
    const nombre = String(crudo ?? "").trim().replace(/\s+/g, " ") || SIN_NOMBRE;
    const clave = nombre.toLowerCase();
    let p = personas.get(clave);
    if (!p) {
      p = { nombre, esIa: IA.test(nombre), despachados: 0, entregados: 0, no_entregados: 0, confirmados: 0, upsells: 0, porDia: {} };
      personas.set(clave, p);
    }
    return p;
  };

  let despachados = 0;
  let entregados = 0;
  let no_entregados = 0;
  let confirmados = 0;
  let upsells = 0;
  for (const fila of filas) {
    if (enRango(fila.guide_final_at, desde, hasta)) {
      const p = persona(fila.guia_por);
      p.despachados += 1;
      if (String(fila.estado_actual ?? "").trim().toLowerCase() === "entregado") {
        p.entregados += 1;
        entregados += 1;
      } else if (esNoEntregadoCerrado(fila.estado_actual)) {
        p.no_entregados += 1;
        no_entregados += 1;
      }
      const dia = localDateKey(fila.guide_final_at);
      if (dia) p.porDia[dia] = (p.porDia[dia] ?? 0) + 1;
      despachados += 1;
    }
    if (enRango(fila.confirmed_at, desde, hasta)) {
      persona(fila.confirmo_por).confirmados += 1;
      confirmados += 1;
    }
  }

  const contados = new Set<string>();
  for (const venta of ventasAdicionales) {
    if (!venta.id || contados.has(venta.id) || !enRango(venta.completed_at, desde, hasta)) continue;
    contados.add(venta.id);
    persona(venta.advisor_name).upsells += 1;
    upsells += 1;
  }

  // Primero quien mas despacha; la IA y "Sin nombre" al final.
  const orden = (p: PersonaDespacho) => (p.esIa || p.nombre === SIN_NOMBRE ? 1 : 0);
  const lista = Array.from(personas.values()).sort(
    (a, b) => orden(a) - orden(b) || b.despachados - a.despachados || b.confirmados - a.confirmados || b.upsells - a.upsells || a.nombre.localeCompare(b.nombre)
  );
  return { personas: lista, dias: diasDelRango(desdeIso, hastaIso), despachados, entregados, no_entregados, confirmados, upsells };
}

/** Denominator includes all dispatched orders, including those still in transit. */
export function tasaEntregaDespacho(entregados: number, despachados: number): string {
  return despachados > 0 ? `${(100 * entregados / despachados).toLocaleString("es-CR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "–";
}

/** Only explicit final outcomes. A failed attempt or cancellation is not a return. */
export function esNoEntregadoCerrado(estado: string | null | undefined): boolean {
  const value = String(estado ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");
  return ["devolucion", "devuelto", "devuelta", "noentregado", "noentregada"].includes(value);
}

export function tasaEntregaCerrados(entregados: number, noEntregados: number): string {
  return tasaEntregaDespacho(entregados, entregados + noEntregados);
}
