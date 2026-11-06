// Ventanas compartidas por el API y la interfaz: calendario y hora de la tienda.
// "yesterday" = ayer completo (dia cerrado); "custom" = rango elegido por el
// usuario (start/end YYYY-MM-DD, ambos inclusivos).
export type KpiRange =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "month"
  | "all"
  | "custom";

export interface KpiCustomRange {
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD
}

export interface KpiWindow {
  curStart: number;
  curEnd: number;
  prevStart: number | null;
  prevEnd: number | null;
  rangeLabel: string;
  compareLabel: string;
  maturing: boolean;
  cutoffLabel?: string;
  comparisonDetail?: string;
}

// Dias en la hora de la TIENDA (04/11/2026). Antes se usaba la hora del
// proceso: en Vercel es UTC, asi que "Ayer" iba de las 6 p. m. del dia
// anterior a las 6 p. m. de ayer en Costa Rica y Honduras, y no cuadraba con
// iComfly. Sin zona (navegador, tests viejos) se usa la hora local.

/** Desfase de la zona en ese instante, en ms (Costa Rica: -6 h). */
function zoneOffsetMs(time: number, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(time));
  const get = (type: string) => Number(p.find((x) => x.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

/** Año, mes (0-11) y dia de `date` en la zona (o en la hora local). */
function calendarParts(
  date: Date,
  timeZone?: string,
): { y: number; m: number; d: number } {
  if (!timeZone)
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
  const local = new Date(
    date.getTime() + zoneOffsetMs(date.getTime(), timeZone),
  );
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth(),
    d: local.getUTCDate(),
  };
}

/** Medianoche de ese dia (mes 0-11; acepta desbordes como mes -1) en la zona, en ms. */
function midnightMs(
  y: number,
  m: number,
  d: number,
  timeZone?: string,
): number {
  if (!timeZone) return new Date(y, m, d).getTime();
  const guess = Date.UTC(y, m, d);
  const first = guess - zoneOffsetMs(guess, timeZone);
  const second = guess - zoneOffsetMs(first, timeZone);
  // El primer instante de ese dia en la zona. Si la medianoche no existe
  // (salto de horario de verano a las 00:00), el dia arranca a la 01:00.
  const target = new Date(guess).toISOString().slice(0, 10);
  const sameDay = [first, second].filter(
    (t) =>
      new Date(t + zoneOffsetMs(t, timeZone)).toISOString().slice(0, 10) ===
      target,
  );
  return sameDay.length ? Math.min(...sameDay) : second;
}

// Fecha YYYY-MM-DD -> medianoche de ese dia en ms (en la zona de la tienda si
// se indica), o null si no parsea. Se usa para el rango custom de KPIs.
function parseDateKeyMs(
  value: string | undefined,
  timeZone?: string,
): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const time = midnightMs(y, m - 1, d, timeZone);
  return Number.isNaN(time) ? null : time;
}

function formatDateKeyLabel(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

/** Fecha normalizada por calendario, sin depender de dias de 23/25 horas. */
function shiftDate(y: number, m: number, d: number, days = 0) {
  const date = new Date(Date.UTC(y, m, d + days, 12));
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth(),
    d: date.getUTCDate(),
  };
}

/** Misma hora de pared en otra fecha. null si esa hora no existe por DST. */
function sameClockOn(
  now: Date,
  date: { y: number; m: number; d: number },
  timeZone?: string,
): number | null {
  if (!timeZone) {
    const value = new Date(
      date.y,
      date.m,
      date.d,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds(),
    );
    return value.getHours() === now.getHours() ? value.getTime() : null;
  }
  const wall = new Date(now.getTime() + zoneOffsetMs(now.getTime(), timeZone));
  const guess = Date.UTC(
    date.y,
    date.m,
    date.d,
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
  );
  const offsets = new Set(
    [guess - 12 * 3600000, guess, guess + 12 * 3600000].map((t) =>
      zoneOffsetMs(t, timeZone),
    ),
  );
  const matches = Array.from(offsets)
    .map((offset) => guess - offset)
    .filter((t) => t + zoneOffsetMs(t, timeZone) === guess);
  return matches.length ? Math.min(...matches) : null;
}

function describeWindow(
  window: KpiWindow,
  timeZone?: string,
  partial = false,
): KpiWindow {
  const format = new Intl.DateTimeFormat("es", {
    ...(timeZone ? { timeZone } : {}),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const clock = new Intl.DateTimeFormat("es", {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return {
    ...window,
    ...(partial
      ? { cutoffLabel: `Hasta las ${clock.format(new Date(window.curEnd))}` }
      : {}),
    comparisonDetail: `Actual: ${window.curStart ? format.format(window.curStart) : "inicio del historial"} a ${format.format(window.curEnd)}. ${window.prevStart != null && window.prevEnd != null ? `Anterior: ${format.format(window.prevStart)} a ${format.format(window.prevEnd)}.` : window.compareLabel + "."} Hora: ${timeZone ?? "local"}.`,
  };
}

// Cada periodo parcial compara contra el mismo tramo de calendario y hora.
// Las tasas siguen siendo estados actuales de cohortes de distinta antiguedad.
export function getKpiWindows(
  range: KpiRange,
  now: Date,
  custom?: KpiCustomRange,
  timeZone?: string,
): KpiWindow {
  const end = now.getTime();
  const DAY = 24 * 60 * 60 * 1000;
  // Medianoche de hoy + n dias por calendario (no n * 24 h): en zonas con
  // horario de verano hay dias de 23 o 25 h.
  const today = calendarParts(now, timeZone);
  const dayStartPlus = (n: number) =>
    midnightMs(today.y, today.m, today.d + n, timeZone);
  const dayStart = dayStartPlus(0);
  if (range === "all") {
    return describeWindow(
      {
        curStart: 0,
        curEnd: end,
        prevStart: null,
        prevEnd: null,
        rangeLabel: "Todo el histórico",
        compareLabel: "sin comparativo",
        maturing: false,
      },
      timeZone,
    );
  }
  if (range === "custom") {
    const startMs = parseDateKeyMs(custom?.start, timeZone);
    const endDayMs = parseDateKeyMs(custom?.end, timeZone);
    // Rango invalido o incompleto: cae a "Todo" para no romper la vista (la UI
    // no consulta hasta tener ambas fechas; esto es solo red de seguridad).
    if (startMs == null || endDayMs == null || startMs > endDayMs) {
      return getKpiWindows("all", now, undefined, timeZone);
    }
    const [ey, em, ed] = custom!.end!.split("-").map(Number);
    const [sy, sm, sd] = custom!.start!.split("-").map(Number);
    const declaredEnd = midnightMs(ey, em - 1, ed + 1, timeZone);
    const days =
      Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / DAY) +
      1;
    const previous = shiftDate(sy, sm - 1, sd, -days);
    const future = startMs > end;
    const partial = !future && end < declaredEnd;
    const curEnd = future ? startMs : Math.min(end, declaredEnd);
    const prevStart = future
      ? null
      : midnightMs(previous.y, previous.m, previous.d, timeZone);
    const prevEnd = future
      ? null
      : partial
        ? sameClockOn(
            now,
            shiftDate(today.y, today.m, today.d, -days),
            timeZone,
          )
        : startMs;
    return describeWindow(
      {
        curStart: startMs,
        curEnd,
        prevStart: prevEnd == null ? null : prevStart,
        prevEnd,
        rangeLabel: `${formatDateKeyLabel(custom!.start!)} – ${formatDateKeyLabel(custom!.end!)}`,
        compareLabel: future
          ? "rango aún no iniciado"
          : prevEnd == null
            ? "sin hora equivalente por cambio horario"
            : partial
              ? "vs. periodo previo a la misma hora"
              : "vs. periodo previo (días completos)",
        // Rangos que terminan hace poco aun no maduran (lag logistico del COD).
        maturing: curEnd > end - 7 * DAY,
      },
      timeZone,
      partial,
    );
  }
  if (range === "today") {
    const prevEnd = sameClockOn(
      now,
      shiftDate(today.y, today.m, today.d, -1),
      timeZone,
    );
    return describeWindow(
      {
        curStart: dayStart,
        curEnd: end,
        prevStart: prevEnd == null ? null : dayStartPlus(-1),
        prevEnd,
        rangeLabel: "Hoy",
        compareLabel:
          prevEnd == null
            ? "sin hora equivalente por cambio horario"
            : "vs. ayer a la misma hora",
        maturing: true,
      },
      timeZone,
      true,
    );
  }
  if (range === "yesterday") {
    return describeWindow(
      {
        curStart: dayStartPlus(-1),
        curEnd: dayStart,
        prevStart: dayStartPlus(-2),
        prevEnd: dayStartPlus(-1),
        rangeLabel: "Ayer",
        compareLabel: "vs. anteayer (días completos)",
        maturing: true,
      },
      timeZone,
    );
  }
  if (range === "month") {
    const { y, m } = calendarParts(now, timeZone);
    const curStart = midnightMs(y, m, 1, timeZone);
    const prevStart = midnightMs(y, m - 1, 1, timeZone);
    const hasSameDay = today.d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    const prevEnd = hasSameDay
      ? sameClockOn(now, shiftDate(y, m - 1, today.d), timeZone)
      : null;
    return describeWindow(
      {
        curStart,
        curEnd: end,
        prevStart: prevEnd == null ? null : prevStart,
        prevEnd,
        rangeLabel: "Mes actual",
        compareLabel: !hasSameDay
          ? "mes anterior sin día equivalente"
          : prevEnd == null
            ? "sin hora equivalente por cambio horario"
            : "vs. mes anterior, mismo día y hora",
        maturing: true,
      },
      timeZone,
      true,
    );
  }
  const days = range === "7d" ? 7 : 30;
  const curStart = dayStartPlus(-(days - 1));
  const prevEnd = sameClockOn(
    now,
    shiftDate(today.y, today.m, today.d, -days),
    timeZone,
  );
  return describeWindow(
    {
      curStart,
      curEnd: end,
      prevStart: prevEnd == null ? null : dayStartPlus(-(2 * days - 1)),
      prevEnd,
      rangeLabel: `Últimos ${days} días`,
      compareLabel:
        prevEnd == null
          ? "sin hora equivalente por cambio horario"
          : `vs. ${days} días previos, misma hora`,
      maturing: range === "7d",
    },
    timeZone,
    true,
  );
}
