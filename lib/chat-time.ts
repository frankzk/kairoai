// Formato de fecha/hora de los mensajes del chat de leads.
//
// La hora viene de iComfly (created_at del mensaje, ya normalizado a epoch ms
// en icomfly-chat.ts) y se muestra en hora local para que coincida con lo que
// la asesora ve en el panel de iComfly y en su propio WhatsApp.
//
// Zona: Costa Rica. Honduras comparte el mismo huso (UTC-6) y ninguno de los
// dos aplica horario de verano, asi que una sola zona sirve a las dos tiendas.
//
// Modulo PURO para poder testear los bordes: mensajes sin fecha utilizable y
// el corte de dia (que no puede calcularse restando 24h sobre el texto ya
// formateado).

export const CHAT_TZ = "America/Costa_Rica";

const timeFormatter = new Intl.DateTimeFormat("es-CR", {
  timeZone: CHAT_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHAT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabelFormatter = new Intl.DateTimeFormat("es-CR", {
  timeZone: CHAT_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const dayLabelWithYearFormatter = new Intl.DateTimeFormat("es-CR", {
  timeZone: CHAT_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * iComfly no siempre trae una fecha parseable; normalizeMessage deja 0 en ese
 * caso. Un 0 formateado seria "31 dic 1969", asi que se trata como "sin hora".
 */
export function hasChatTime(ms: number | null | undefined): boolean {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0;
}

/** Hora del mensaje: "11:54 a.m.". Vacio si no hay fecha utilizable. */
export function formatChatTime(ms: number | null | undefined): string {
  if (!hasChatTime(ms)) return "";
  return (
    timeFormatter
      .format(new Date(ms as number))
      // Intl mete espacios finos/duros antes de "a. m."; se compactan para que
      // quepa dentro de la burbuja.
      .replace(/[  ]/g, " ")
      .replace(/\ba\.\s*m\./i, "a.m.")
      .replace(/\bp\.\s*m\./i, "p.m.")
  );
}

/** Dia calendario en hora local ("2026-08-12"), para agrupar mensajes. */
export function chatDayKey(ms: number | null | undefined): string {
  if (!hasChatTime(ms)) return "";
  return dayKeyFormatter.format(new Date(ms as number));
}

/** Etiqueta del separador de dia: "Hoy", "Ayer" o la fecha. */
export function formatChatDayLabel(ms: number | null | undefined, now: number = Date.now()): string {
  if (!hasChatTime(ms)) return "";
  const key = chatDayKey(ms);
  if (key === chatDayKey(now)) return "Hoy";
  if (key === chatDayKey(now - 86_400_000)) return "Ayer";
  const date = new Date(ms as number);
  const sameYear = key.slice(0, 4) === chatDayKey(now).slice(0, 4);
  const label = sameYear ? dayLabelFormatter.format(date) : dayLabelWithYearFormatter.format(date);
  // "mar, 12 ago" -> "mar 12 ago"; ademas quita el punto de la abreviatura.
  return label.replace(/,/g, "").replace(/\./g, "");
}

/**
 * Si entre dos mensajes consecutivos cambia el dia, va un separador. El primer
 * mensaje con fecha siempre lo lleva; los mensajes sin fecha no lo disparan
 * para no cortar la conversacion con una etiqueta vacia.
 */
export function needsDaySeparator(
  previousMs: number | null | undefined,
  currentMs: number | null | undefined
): boolean {
  if (!hasChatTime(currentMs)) return false;
  if (!hasChatTime(previousMs)) return true;
  return chatDayKey(previousMs) !== chatDayKey(currentMs);
}
