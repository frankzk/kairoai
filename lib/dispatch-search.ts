// Reglas de la busqueda del tablero de despacho: como se interpreta lo que
// escribe la persona (guia, celular o numero de pedido) y como se etiqueta un
// resultado. La consulta a la BD vive en dispatch-search-db.ts.
//
// Modulo PURO (sin acceso a BD) para poder testearlo y para que el componente
// cliente lo importe sin arrastrar Supabase al bundle.

import { normalizePhone, type PhoneCountryConfig } from "./phone-cr";
import type { IcomflyOrderRecord } from "./finance-types";

/** Que dato hizo match; la UI lo muestra como etiqueta en el resultado. */
export type DispatchMatchField = "pedido" | "guia" | "telefono";

export interface DispatchSearchTerms {
  /** Texto saneado (mayusculas, solo alfanumerico + '#' y '-') para guia/pedido. */
  text: string;
  /** Telefono E.164 sin '+' si el texto se puede leer como telefono completo. */
  phone: string | null;
  /** Numero nacional (8 digitos en CR/HN); es lo que buscamos en Shopify. */
  national: string | null;
}

export interface DispatchSearchHit {
  order: IcomflyOrderRecord;
  /** Telefono del cliente segun Shopify (tal cual esta guardado). */
  phone: string;
  /** Guia del courier: iComfly si la tiene, si no la de Shopify. */
  guide: string;
  matched: DispatchMatchField[];
}

/** Con menos de 3 caracteres la busqueda devolveria medio tablero. */
export const MIN_QUERY_LENGTH = 3;

/**
 * Deja solo lo que puede aparecer en una guia o un numero de pedido.
 * Ademas de normalizar, evita meter comas/parentesis en los filtros de
 * PostgREST, donde son separadores con significado propio.
 */
export function sanitizeSearchText(raw: string | null | undefined): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9#-]/g, "");
}

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D+/g, "");
}

export function parseDispatchQuery(
  raw: string | null | undefined,
  cfg: PhoneCountryConfig
): DispatchSearchTerms | null {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return null;
  const text = sanitizeSearchText(trimmed);
  if (!text) return null;
  // Solo tratamos como telefono un numero COMPLETO y valido: un parcial daria
  // falsos positivos contra guias numericas (que tambien son solo digitos).
  const phone = normalizePhone(trimmed, cfg);
  const national = phone ? phone.slice(cfg.countryCode.length) : null;
  return { text, phone, national };
}

/**
 * Formas en que Shopify tiene guardado un mismo celular. La gran mayoria viene
 * como "+50671041241", pero hay registros con separadores ("+504 9544-3406",
 * "+506 8781 7570"), asi que buscamos las tres variantes.
 */
export function phoneLikePatterns(national: string): string[] {
  const half = Math.floor(national.length / 2);
  const head = national.slice(0, half);
  const tail = national.slice(half);
  return [`%${national}%`, `%${head}-${tail}%`, `%${head} ${tail}%`];
}

/** Etiqueta que campo del resultado coincide con lo buscado. */
export function labelDispatchMatches(
  row: Pick<IcomflyOrderRecord, "order_number" | "shopify_display_number" | "tracking_number">,
  phone: string,
  guide: string,
  terms: DispatchSearchTerms
): DispatchMatchField[] {
  const out: DispatchMatchField[] = [];
  const has = (value: string | null | undefined) =>
    Boolean(terms.text) && sanitizeSearchText(value).includes(terms.text);

  if (has(row.order_number) || has(row.shopify_display_number)) out.push("pedido");
  if (has(row.tracking_number) || has(guide)) out.push("guia");
  if (terms.national && digitsOnly(phone).endsWith(terms.national)) out.push("telefono");
  return out;
}

export const MATCH_LABEL: Record<DispatchMatchField, string> = {
  pedido: "pedido",
  guia: "guía",
  telefono: "celular",
};
