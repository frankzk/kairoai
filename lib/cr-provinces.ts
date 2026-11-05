// Provincia de Costa Rica a partir de lo que escribe el cliente (05/11/2026,
// módulo 12 "Segmentación").
//
// iComfly guarda la provincia en `shipping_department` como texto libre:
// "San José", "SAN JOSE", "Sanjose", "Sam jose", "Provincia de Alajuela",
// "Heredia Province", "GUANCASTE", "Gte", "CR-H", a veces un cantón ("San
// Carlos", "Talamanca") y a veces basura ("Shopify", "Seleccione
// región/estado"). Se normaliza en este orden: nombre exacto, código ISO,
// abreviatura, primera palabra, cantón (los 84), errores de tipeo (hasta 2
// letras contra las 7 provincias) y, si nada sirve, lo mismo con la ciudad.
// Sin resultado: null ("Sin provincia").
//
// Puro: se prueba en tests/cr-provinces.test.ts.

export type CrProvince =
  | "San José"
  | "Alajuela"
  | "Cartago"
  | "Heredia"
  | "Guanacaste"
  | "Puntarenas"
  | "Limón";

export const CR_PROVINCES: readonly CrProvince[] = [
  "San José",
  "Alajuela",
  "Cartago",
  "Heredia",
  "Guanacaste",
  "Puntarenas",
  "Limón",
];

const norm = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(provincia de|provincia|province)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const compact = (value: string) => value.replace(/ /g, "");

const BY_NAME = new Map<string, CrProvince>(
  CR_PROVINCES.map((province) => [compact(norm(province)), province]),
);

const ISO: Record<string, CrProvince> = {
  sj: "San José",
  a: "Alajuela",
  c: "Cartago",
  h: "Heredia",
  g: "Guanacaste",
  p: "Puntarenas",
  l: "Limón",
};

const ABBREVIATIONS: Record<string, CrProvince> = {
  sj: "San José",
  sjo: "San José",
  gte: "Guanacaste",
  guana: "Guanacaste",
  ctgo: "Cartago",
  ptas: "Puntarenas",
  pts: "Puntarenas",
  hdia: "Heredia",
};

const NOT_A_PLACE = new Set([
  "shopify",
  "seleccione region estado",
  "seleccione",
  "costa rica",
  "cr",
  "n a",
  "na",
  "none",
  "null",
]);

/** The 84 cantons plus a few well-known districts customers write instead. */
const CANTONS: Record<CrProvince, string[]> = {
  "San José": [
    "escazu",
    "desamparados",
    "puriscal",
    "tarrazu",
    "aserri",
    "mora",
    "goicoechea",
    "santa ana",
    "alajuelita",
    "vazquez de coronado",
    "coronado",
    "acosta",
    "tibas",
    "moravia",
    "montes de oca",
    "turrubares",
    "dota",
    "curridabat",
    "perez zeledon",
    "leon cortes",
    // Distritos frecuentes.
    "san isidro de el general",
    "paso ancho",
    "hatillo",
    "pavas",
    "zapote",
    "san pedro de montes de oca",
    "guadalupe",
    "san francisco de dos rios",
    "uruca",
    "la uruca",
  ],
  Alajuela: [
    "san ramon",
    "grecia",
    "san mateo",
    "atenas",
    "naranjo",
    "palmares",
    "poas",
    "orotina",
    "san carlos",
    "zarcero",
    "sarchi",
    "valverde vega",
    "upala",
    "los chiles",
    "guatuso",
    "rio cuarto",
    "ciudad quesada",
    "la fortuna",
  ],
  Cartago: [
    "paraiso",
    "la union",
    "jimenez",
    "turrialba",
    "alvarado",
    "oreamuno",
    "el guarco",
    "tres rios",
  ],
  Heredia: [
    "barva",
    "santo domingo",
    "santa barbara",
    "san rafael",
    "san isidro",
    "belen",
    "san antonio de belen",
    "flores",
    "san pablo",
    "sarapiqui",
  ],
  Guanacaste: [
    "liberia",
    "nicoya",
    "santa cruz",
    "bagaces",
    "carrillo",
    "canas",
    "abangares",
    "tilaran",
    "nandayure",
    "la cruz",
    "hojancha",
    "nuevo arenal",
    "tamarindo",
  ],
  Puntarenas: [
    "esparza",
    "buenos aires",
    "montes de oro",
    "osa",
    "quepos",
    "aguirre",
    "golfito",
    "coto brus",
    "parrita",
    "corredores",
    "garabito",
    "jaco",
    "monteverde",
    "puerto jimenez",
  ],
  Limón: ["pococi", "guapiles", "siquirres", "talamanca", "matina", "guacimo"],
};

const BY_CANTON = new Map<string, CrProvince>();
for (const province of CR_PROVINCES)
  for (const canton of CANTONS[province]) {
    BY_CANTON.set(canton, province);
    BY_CANTON.set(compact(canton), province);
  }
// Longest names first so "san isidro de el general" wins over "san isidro".
const CANTON_PREFIXES = Array.from(BY_CANTON.keys())
  .filter((key) => key.includes(" "))
  .sort((a, b) => b.length - a.length);
const PROVINCE_PREFIXES = CR_PROVINCES.map(
  (province) => [norm(province), province] as const,
).sort((a, b) => b[0].length - a[0].length);

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

function resolve(raw: string | null | undefined): CrProvince | null {
  const text = norm(String(raw ?? ""));
  if (!text || NOT_A_PLACE.has(text)) return null;
  const key = compact(text);
  const exact = BY_NAME.get(key);
  if (exact) return exact;
  const iso = /^cr ?([a-z]{1,2})$/.exec(text);
  if (iso && ISO[iso[1]]) return ISO[iso[1]];
  if (ABBREVIATIONS[key]) return ABBREVIATIONS[key];
  for (const [name, province] of PROVINCE_PREFIXES)
    if (text.startsWith(`${name} `)) return province;
  const canton = BY_CANTON.get(text) ?? BY_CANTON.get(key);
  if (canton) return canton;
  for (const prefix of CANTON_PREFIXES)
    if (text.startsWith(`${prefix} `)) return BY_CANTON.get(prefix)!;
  // Typos: up to 2 letters for long names, 1 for short ones; a single best match only.
  if (key.length >= 5) {
    let best: CrProvince | null = null,
      bestDistance = Infinity,
      tie = false;
    for (const [name, province] of Array.from(BY_NAME)) {
      const limit = name.length >= 7 ? 2 : 1;
      const distance = editDistance(key, name);
      if (distance > limit) continue;
      if (distance < bestDistance) {
        best = province;
        bestDistance = distance;
        tie = false;
      } else if (distance === bestDistance && province !== best) tie = true;
    }
    if (best && !tie) return best;
  }
  return null;
}

/** Province from the shipping department (free text), else from the city. */
export function provinceOf(
  department: string | null | undefined,
  city?: string | null,
): CrProvince | null {
  return resolve(department) ?? resolve(city);
}
