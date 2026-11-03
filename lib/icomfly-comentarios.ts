// Los comentarios y etiquetas que las asesoras ponen al pedido EN iComfly, para
// verlos en la ficha del pedido de Kairo (03/11/2026). Antes habia que escribir
// lo mismo en los dos lados.
//
// iComfly guarda los comentarios en la nota interna del pedido (internal_note),
// uno por linea con quien y cuando:
//   "[2026-11-02 15:39 · Jeanny Linares] se llamo 3 veces y no respondio"
// Una linea sin ese encabezado sigue al comentario anterior. Las etiquetas son
// payload.labels: [{ id, name }].
//
// Solo se muestra: no se copia a la bitacora de Kairo, asi no hay dos verdades.
// La lectura (en vivo o sincronizada) esta en lib/icomfly-comentarios-db.ts;
// esto es puro para que lo use tambien la ficha del pedido en el navegador.
// Se prueba en tests/icomfly-comentarios.test.ts.

export interface ComentarioIcomfly {
  /** Fecha y hora como la escribio iComfly ("2026-11-02 15:39"), o null. */
  fecha: string | null;
  autor: string | null;
  texto: string;
}

export interface NotasIcomfly {
  comentarios: ComentarioIcomfly[];
  etiquetas: string[];
  /** "vivo": leido de iComfly ahora; "sincronizado": de la ultima sincronizacion. */
  origen: "vivo" | "sincronizado";
}

const ENCABEZADO = /^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})(?::\d{2})?\s*[·•|-]\s*([^\]]+?)\s*\]\s*(.*)$/;

/** Separa la nota interna en comentarios, en el orden en que se escribieron. */
export function leerComentariosIcomfly(nota: unknown): ComentarioIcomfly[] {
  if (typeof nota !== "string" || !nota.trim()) return [];
  const comentarios: ComentarioIcomfly[] = [];
  for (const crudo of nota.split(/\r?\n/)) {
    const linea = crudo.trim();
    if (!linea) continue;
    const m = ENCABEZADO.exec(linea);
    if (m) {
      comentarios.push({ fecha: m[1].replace("T", " "), autor: m[2].trim() || null, texto: m[3].trim() });
    } else if (comentarios.length) {
      const ultimo = comentarios[comentarios.length - 1];
      ultimo.texto = ultimo.texto ? `${ultimo.texto}\n${linea}` : linea;
    } else {
      comentarios.push({ fecha: null, autor: null, texto: linea });
    }
  }
  return comentarios.filter((c) => c.texto);
}

/** Los nombres de las etiquetas del pedido, sin repetidos. */
export function leerEtiquetasIcomfly(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const nombres = labels
    .map((l) => (l && typeof l === "object" ? (l as { name?: unknown }).name : l))
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim());
  return Array.from(new Set(nombres));
}

/**
 * "2026-11-02 15:39" escrito en la hora de la tienda -> ISO, para ordenarlo
 * con el resto de la bitacora. null si no tiene fecha.
 */
export function fechaComentarioIso(fecha: string | null, tz: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(String(fecha ?? "").trim());
  if (!m) return null;
  const comoUtc = Date.parse(`${m[1]}T${m[2]}:00Z`);
  if (!Number.isFinite(comoUtc)) return null;
  // Desfase de la zona en ese momento (Costa Rica y Honduras: -6 h, sin horario de verano).
  const enZona = Date.parse(new Date(comoUtc).toLocaleString("en-US", { timeZone: tz }) + " UTC");
  const desfase = Number.isFinite(enZona) ? enZona - comoUtc : 0;
  return new Date(comoUtc - desfase).toISOString();
}

// ─── Lo que Kairo escribe en iComfly ─────────────────────────────────────────
//
// Cada gestion de la ficha del pedido (intento, decision o nota) se copia como
// nota interna del pedido en iComfly (lib/icomfly-nota-kairo.ts), con esta
// marca al principio. iComfly le agrega fecha y firma (la del conector), por
// eso el nombre de la asesora va en el texto. Al volver a Kairo, lo que lleva
// la marca no se muestra: ya esta en la bitacora como gestion.

export const MARCA_KAIRO = "Kairo ·";

/** true si el comentario lo escribio Kairo (no se muestra dos veces). */
export function esNotaDeKairo(texto: string | null | undefined): boolean {
  return String(texto ?? "").trimStart().startsWith(MARCA_KAIRO);
}
