// Productividad de Novedades: quien trabaja las novedades (llamadas,
// reprogramaciones, notas, descartes, RTS, cambios de estado), por persona y
// por dia. Ventana "Productividad" de Novedades.
//
// Cada accion queda en incident_events con la persona que la hizo en
// metadata.actor (recordIncidentEvent, desde fines de octubre de 2026; antes no se
// guardaba quien). Los eventos del sistema (deteccion, cambios del courier)
// van sin persona y no cuentan.
//
// Puro: se prueba en tests/productividad-novedades.test.ts.

import { localDateKey } from "@/lib/leads-metrics";
import { diasDelRango } from "@/lib/productividad-despacho";

export interface AccionNovedad {
  incident_id: number | string;
  kind: string;
  created_at: string;
  /** metadata.actor.nombre: quien hizo la accion. */
  actor: string | null;
}

export interface PersonaNovedades {
  nombre: string;
  /** Novedades distintas que trabajo. */
  novedades: number;
  acciones: number;
  llamadas: number;
  reprogramadas: number;
  notas: number;
  /** Descartes, RTS, cancelaciones, cambios de estado o de causa, no llamar. */
  otras: number;
  /** Novedades distintas trabajadas por dia local (YYYY-MM-DD). */
  porDia: Record<string, number>;
}

export interface ResumenNovedades {
  personas: PersonaNovedades[];
  dias: string[];
  /** Novedades distintas trabajadas por alguien en el periodo. */
  novedades: number;
  acciones: number;
}

export function resumenNovedades(acciones: AccionNovedad[], desdeIso: string, hastaIso: string): ResumenNovedades {
  const desde = new Date(desdeIso).getTime();
  const hasta = new Date(hastaIso).getTime();
  const personas = new Map<string, PersonaNovedades & { _novedades: Set<string>; _porDia: Map<string, Set<string>> }>();
  const todas = new Set<string>();
  let total = 0;

  for (const a of acciones) {
    const nombre = String(a.actor ?? "").trim().replace(/\s+/g, " ");
    const t = new Date(a.created_at).getTime();
    if (!nombre || !Number.isFinite(t) || t < desde || t >= hasta) continue;
    const clave = nombre.toLowerCase();
    let p = personas.get(clave);
    if (!p) {
      p = {
        nombre,
        novedades: 0,
        acciones: 0,
        llamadas: 0,
        reprogramadas: 0,
        notas: 0,
        otras: 0,
        porDia: {},
        _novedades: new Set(),
        _porDia: new Map(),
      };
      personas.set(clave, p);
    }
    const id = String(a.incident_id);
    p.acciones += 1;
    if (a.kind === "llamada") p.llamadas += 1;
    else if (a.kind === "reprogramada") p.reprogramadas += 1;
    else if (a.kind === "nota") p.notas += 1;
    else p.otras += 1;
    p._novedades.add(id);
    const dia = localDateKey(a.created_at);
    if (dia) {
      const delDia = p._porDia.get(dia) ?? new Set<string>();
      delDia.add(id);
      p._porDia.set(dia, delDia);
    }
    todas.add(id);
    total += 1;
  }

  const lista: PersonaNovedades[] = Array.from(personas.values()).map(({ _novedades, _porDia, ...p }) => ({
    ...p,
    novedades: _novedades.size,
    porDia: Object.fromEntries(Array.from(_porDia.entries()).map(([dia, ids]) => [dia, ids.size])),
  }));
  lista.sort((a, b) => b.novedades - a.novedades || b.acciones - a.acciones || a.nombre.localeCompare(b.nombre));
  return { personas: lista, dias: diasDelRango(desdeIso, hastaIso), novedades: todas.size, acciones: total };
}
