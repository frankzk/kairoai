// Normalizacion de telefonos a E.164 sin '+', parametrizada por pais para que
// el mismo modulo sirva a Costa Rica (506 + 8 digitos) y a Honduras (504 + 8)
// el dia de manana, sin tocar codigo.
//
// Costa Rica: moviles de 8 digitos que inician en 6, 7 u 8.
// Icomfly ya entrega el telefono como '506########' (verificado en Fase 0),
// pero normalizamos defensivamente porque los CRM cambian de forma sin avisar.

export interface PhoneCountryConfig {
  /** Codigo de pais sin '+', p.ej. "506". */
  countryCode: string;
  /** Longitud del numero nacional (sin codigo de pais), p.ej. 8 en CR. */
  nationalLength: number;
  /** Digitos iniciales validos del numero nacional (moviles). Vacio = no valida. */
  mobilePrefixes: string[];
}

export const CR_PHONE: PhoneCountryConfig = {
  countryCode: "506",
  nationalLength: 8,
  mobilePrefixes: ["6", "7", "8"],
};

export const HN_PHONE: PhoneCountryConfig = {
  countryCode: "504",
  nationalLength: 8,
  mobilePrefixes: ["3", "8", "9"],
};

const PHONE_BY_STORE_CODE: Record<string, PhoneCountryConfig> = {
  "mireva-cr": CR_PHONE,
  "mireva-hn": HN_PHONE,
};

export function phoneConfigForStore(storeCode?: string | null): PhoneCountryConfig {
  return PHONE_BY_STORE_CODE[String(storeCode || "").toLowerCase()] ?? CR_PHONE;
}

/** Deja solo digitos y quita un prefijo internacional "00" si viene. */
function digitsOnly(raw: string): string {
  let d = String(raw).replace(/\D+/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

/**
 * Normaliza un telefono a `${countryCode}${national}` (E.164 sin '+').
 * Devuelve null si no puede formar un numero valido para el pais.
 */
export function normalizePhone(
  raw: string | null | undefined,
  cfg: PhoneCountryConfig = CR_PHONE
): string | null {
  if (!raw) return null;
  const { countryCode, nationalLength, mobilePrefixes } = cfg;
  let d = digitsOnly(raw);
  if (!d) return null;

  // Ya trae el codigo de pais.
  if (d.startsWith(countryCode) && d.length === countryCode.length + nationalLength) {
    d = d.slice(countryCode.length);
  }

  // Numero nacional puro.
  if (d.length === nationalLength) {
    if (mobilePrefixes.length && !mobilePrefixes.some((p) => d.startsWith(p))) {
      return null;
    }
    return `${countryCode}${d}`;
  }

  // Longitud inesperada: si empieza con el codigo de pais y el resto es valido,
  // aceptar; si no, rechazar para no inventar numeros.
  if (d.startsWith(countryCode)) {
    const national = d.slice(countryCode.length);
    if (national.length === nationalLength) {
      if (mobilePrefixes.length && !mobilePrefixes.some((p) => national.startsWith(p))) {
        return null;
      }
      return `${countryCode}${national}`;
    }
  }
  return null;
}

/** Enmascara para mostrar en logs/UI parcial: 506########  ->  506####4567 */
export function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  const head = phone.slice(0, 3);
  const tail = phone.slice(-4);
  return `${head}${"#".repeat(Math.max(0, phone.length - 7))}${tail}`;
}
