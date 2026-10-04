// Normalizacion de telefonos a E.164 sin '+', parametrizada por pais para que
// el mismo modulo sirva a Costa Rica (506 + 8 digitos) y a Honduras (504 + 8)
// el dia de manana, sin tocar codigo.
//
// Costa Rica: moviles de 8 digitos que inician en 5, 6, 7 u 8.
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
  // El 5 faltaba. SUTEL abrio la serie 5xxx-xxxx a moviles, y en los pedidos
  // NO cancelados de Shopify hay 40 clientes de Costa Rica con numero 5xxxxxxx,
  // 38 de ellos entregados (medido 04/10/2026). La ingesta los descartaba como
  // "sin telefono" y el cruce con pedidos nunca los marcaba como comprados.
  mobilePrefixes: ["5", "6", "7", "8"],
};

/**
 * Codigos de pais que se aceptan TAL CUAL cuando el numero ya los trae.
 *
 * Son los vecinos de Centroamerica con plan nacional de 8 digitos, mas los dos
 * propios para que un hondureño en la tienda de Costa Rica (o al reves) no se
 * pierda. Medido en pedidos NO cancelados de Shopify (04/10/2026): 57 con +505
 * en la tienda de Costa Rica —TODOS enviados a Costa Rica, 54 entregados—, 3
 * con +507 y 2 con +502. Son nicaragüenses que viven en Guanacaste y compran,
 * y la ingesta los tiraba a `skipped_no_phone` sin que nadie lo viera: el
 * tablero decia "sin resultados" y la asesora concluia que el lead no existia.
 *
 * NO es "cualquier numero largo": los +197, +160, +181 que tambien aparecen en
 * los pedidos son errores de tipeo, y aceptarlos seria inventar numeros, que
 * es exactamente lo que esta funcion existe para no hacer.
 */
export const EXPLICIT_COUNTRY_CODES: Record<string, number> = {
  "506": 8, // Costa Rica
  "504": 8, // Honduras
  "505": 8, // Nicaragua
  "507": 8, // Panama
  "502": 8, // Guatemala
  "503": 8, // El Salvador
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
 * Devuelve null si no puede formar un numero valido.
 *
 * El `cfg` de la tienda decide UNA sola cosa: que pais asumir cuando el numero
 * viene sin codigo (un nacional de 8 digitos), que es el unico caso ambiguo.
 * Un numero que ya trae un codigo conocido no es ambiguo y se respeta.
 */
export function normalizePhone(
  raw: string | null | undefined,
  cfg: PhoneCountryConfig = CR_PHONE
): string | null {
  if (!raw) return null;
  const { countryCode, nationalLength, mobilePrefixes } = cfg;
  let d = digitsOnly(raw);
  if (!d) return null;

  // Trae el codigo de OTRO pais que conocemos, con la longitud exacta de ese
  // pais: se devuelve tal cual. No se le exige prefijo movil, porque no hay
  // datos para afirmar cuales son y equivocarse volveria a descartar clientes
  // en silencio — el mismo defecto que esto arregla. Al pais de la tienda si
  // se le valida el prefijo, mas abajo, como siempre.
  if (!d.startsWith(countryCode)) {
    for (const [code, len] of Object.entries(EXPLICIT_COUNTRY_CODES)) {
      if (d.startsWith(code) && d.length === code.length + len) return d;
    }
  }

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
