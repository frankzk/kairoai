// Tipos y formato de las respuestas rapidas. Modulo PURO (sin acceso a la BD)
// para que los componentes cliente lo importen sin arrastrar el cliente de
// Supabase al bundle del navegador. El acceso a datos vive en quick-replies.ts.

export interface QuickReply {
  id: number;
  title: string;
  body: string;
  usage_count: number;
}

export const QUICK_REPLY_MAX_TITLE = 40;
export const QUICK_REPLY_MAX_BODY = 4000;

/**
 * Rellena las variables de una plantilla.
 *   {nombre} -> primer nombre del lead (vacio si no hay)
 *   {tienda} -> nombre corto de la tienda
 * Si {nombre} queda vacio se limpian los espacios dobles y la puntuacion que
 * quedaria colgando ("Hola , ..." -> "Hola, ...").
 */
export function renderQuickReply(
  body: string,
  vars: { nombre?: string | null; tienda?: string | null }
): string {
  // Solo el primer nombre: los contactos de WhatsApp suelen traer nombre
  // completo y "Hola Maria" suena mejor que "Hola Maria Fernanda Rojas".
  const firstName = (vars.nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return body
    .replace(/\{nombre\}/gi, firstName)
    .replace(/\{tienda\}/gi, (vars.tienda ?? "").trim())
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}
