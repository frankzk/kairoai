// Tendencia diaria de novedades. Modulo PURO: recibe las filas ya leidas y
// devuelve la serie. Sin base ni red.
//
// POR QUE EXISTE: este calculo vivia dentro de computeExecutiveStats(), que
// habla con Supabase, asi que no se podia probar. Cuando la tabla mostro
// numeros que no coincidian con la base no habia forma de aislar si el error
// estaba en la consulta o en el conteo. Aca se puede.
//
// LOS DOS RELOJES. La tabla mezclaba dos poblaciones distintas en la misma
// fila y por eso no se entendia:
//
//   Reloj A — la COHORTE del dia: cuantas novedades nacieron ese dia, cuantas
//             de esas ya se entregaron, y cuanto tardo la primera llamada.
//             Son divisibles entre si porque miden la misma gente.
//
//   Reloj B — el TRABAJO del dia: cuantas resoluciones y reprogramaciones se
//             hicieron ese dia, sobre novedades de cualquier fecha.
//
// Un domingo con "1 nueva, 2 resueltas" no es una contradiccion: las 2
// resueltas son paquetes viejos entregados ese domingo. Lo que no se puede es
// dividir una cosa por la otra.

/** Milisegundos de un dia. */
const DAY = 86_400_000;

/** Hora local de Costa Rica / Honduras (UTC-6). */
export const TZ_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Clave YYYY-MM-DD del dia local al que pertenece un instante. */
export function dayKey(ms: number): string {
  return new Date(ms - TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Medianoche local de hoy, en epoch ms. */
export function startOfLocalToday(nowMs: number): number {
  return Math.floor((nowMs - TZ_OFFSET_MS) / DAY) * DAY + TZ_OFFSET_MS;
}

/** Una novedad, en lo minimo que necesita la tendencia. */
export interface TrendIncident {
  created_at: string;
  /** Estado ACTUAL. "resuelta" = el paquete se entrego. */
  status: string;
}

/** Un evento de gestion (resolucion o reprogramacion), por su fecha. */
export interface TrendEvent {
  created_at: string;
}

/** Primera llamada de una novedad: cuando nacio y cuanto tardo el contacto. */
export interface FirstManagement {
  createdMs: number;
  diffMs: number;
}

export interface TrendDay {
  date: string;
  // --- Reloj A: la cohorte de ese dia ---
  /** Novedades que nacieron ese dia. */
  generadas: number;
  /** De esas, cuantas ya estan entregadas hoy. Divisible por `generadas`. */
  resueltas_de_las_nuevas: number;
  /** Horas promedio hasta la primera llamada, de las nacidas ese dia. */
  primera_gestion_horas: number | null;
  // --- Reloj B: el trabajo hecho ese dia, sobre cualquier novedad ---
  /** Entregas confirmadas ese dia. */
  resueltas: number;
  /** Reprogramaciones hechas ese dia. */
  reprogramadas: number;
}

export interface BuildTrendInput {
  created: TrendIncident[];
  resolved: TrendEvent[];
  reprogramadas: TrendEvent[];
  firstMgmt: FirstManagement[];
  nowMs: number;
  /** Cuantos dias hacia atras (incluye hoy). */
  days?: number;
}

/**
 * Serie diaria, del mas viejo al mas nuevo, con un punto por dia AUNQUE no
 * haya habido movimiento (asi la tabla no se descuadra).
 */
export function buildTrend(input: BuildTrendInput): TrendDay[] {
  const days = input.days ?? 30;
  const startToday = startOfLocalToday(input.nowMs);

  const generadasPorDia = new Map<string, number>();
  const resueltasDeLasNuevasPorDia = new Map<string, number>();
  for (const inc of input.created) {
    const t = Date.parse(inc.created_at);
    if (Number.isNaN(t)) continue;
    const k = dayKey(t);
    generadasPorDia.set(k, (generadasPorDia.get(k) ?? 0) + 1);
    if (inc.status === "resuelta") {
      resueltasDeLasNuevasPorDia.set(k, (resueltasDeLasNuevasPorDia.get(k) ?? 0) + 1);
    }
  }

  const porDia = (rows: TrendEvent[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const t = Date.parse(r.created_at);
      if (Number.isNaN(t)) continue;
      const k = dayKey(t);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const resueltasPorDia = porDia(input.resolved);
  const reprogPorDia = porDia(input.reprogramadas);

  // Primera gestion, agrupada por el dia en que NACIO la novedad (no por el dia
  // de la llamada): la pregunta es "las de ese dia, en cuanto se atendieron".
  const gestionPorDia = new Map<string, { sum: number; n: number }>();
  for (const m of input.firstMgmt) {
    const k = dayKey(m.createdMs);
    const e = gestionPorDia.get(k) ?? { sum: 0, n: 0 };
    e.sum += m.diffMs;
    e.n += 1;
    gestionPorDia.set(k, e);
  }

  const serie: TrendDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(startToday - i * DAY);
    const pg = gestionPorDia.get(k);
    serie.push({
      date: k,
      generadas: generadasPorDia.get(k) ?? 0,
      resueltas_de_las_nuevas: resueltasDeLasNuevasPorDia.get(k) ?? 0,
      primera_gestion_horas: pg && pg.n > 0 ? pg.sum / pg.n / 3_600_000 : null,
      resueltas: resueltasPorDia.get(k) ?? 0,
      reprogramadas: reprogPorDia.get(k) ?? 0,
    });
  }
  return serie;
}

/**
 * % de resolucion de una cohorte. Va de 0 a 100 porque numerador y denominador
 * son la MISMA poblacion.
 *
 * NO confundir con `resueltas`, que cuenta eventos sobre todo el acumulado:
 * dividir eso por las nuevas del dia daba cosas como 775%.
 */
export function pctResueltas(resueltasDeLasNuevas: number, generadas: number): number {
  return generadas > 0 ? Math.round((resueltasDeLasNuevas / generadas) * 100) : 0;
}
