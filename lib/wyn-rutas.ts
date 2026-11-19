// Rutas y días de entrega de WYN en Costa Rica (Mejoras Kairo N.º 2).
//
// WYN manda un Excel con las zonas rurales y los días que su camión pasa por
// cada una ("Frecuencias por zona": región, hub, ruta, ● por día de lunes a
// sábado). Con eso Kairo le dice a la asesora, al confirmar, crear o
// reprogramar un pedido, qué días entrega WYN en la zona del cliente y la
// próxima fecha posible.
//
// Reglas acordadas (19/11/2026):
//   - Manda la hoja "Frecuencias por zona".
//   - Una zona que no está en el Excel (Valle Central y el resto) se toma
//     como entrega diaria, lunes a sábado.
//   - Confirmado antes de las 12 m. sale de Boxful ese día; llega al hub de
//     WYN al día siguiente; se entrega el primer día de ruta de la zona desde
//     ese día. Domingo no se despacha ni se entrega.
//
// Todo lo de aquí es puro (tests/wyn-rutas.test.ts).

export interface RutaWyn {
  region: string;
  hub: string;
  /** Como viene en el Excel: "Nosara / Ostional / Guiones". */
  ruta: string;
  zonas: string[];
  /** Días de entrega: 1 = lunes … 6 = sábado. */
  dias: number[];
  nota: string | null;
}

export interface UbicacionCliente {
  provincia?: string | null;
  canton?: string | null;
  distrito?: string | null;
  direccion?: string | null;
}

export const DIAS_TODOS = [1, 2, 3, 4, 5, 6];
export const CORTE_HORA = 12;
export const DIAS_AL_HUB = 1;
const ZONA_HORARIA = "America/Costa_Rica";

const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ENCABEZADO_DIAS = ["lun", "mar", "mie", "jue", "vie", "sab"];

export function normalizarLugar(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Lee la hoja "Frecuencias por zona" (filas como las da SheetJS con header: 1). */
export function parseFrecuenciasWyn(filas: unknown[][]): RutaWyn[] {
  const idx = filas.findIndex((f) => {
    const n = (f ?? []).map(normalizarLugar);
    return n.includes("region") && n.includes("hub") && n.includes("lun");
  });
  if (idx < 0) throw new Error("No encontré la tabla de la hoja «Frecuencias por zona» (columnas Región, Hub, Ruta, Lun…Sáb).");
  const cab = (filas[idx] ?? []).map(normalizarLugar);
  const col = (nombre: string) => cab.findIndex((c) => c === nombre || c.startsWith(nombre));
  const cRegion = col("region");
  const cHub = col("hub");
  const cRuta = cab.findIndex((c) => c.startsWith("ruta"));
  const cDias = ENCABEZADO_DIAS.map((d) => col(d));
  const cNota = col("nota");
  if (cRuta < 0 || cDias.some((c) => c < 0)) throw new Error("Faltan columnas en «Frecuencias por zona»: Ruta / Zonas y Lun a Sáb.");
  const rutas: RutaWyn[] = [];
  for (const fila of filas.slice(idx + 1)) {
    const f = fila ?? [];
    const ruta = String(f[cRuta] ?? "").trim();
    const region = String(f[cRegion] ?? "").trim();
    if (!ruta || !region) continue;
    const dias = cDias.flatMap((c, i) => (String(f[c] ?? "").trim() ? [i + 1] : []));
    if (!dias.length) continue;
    rutas.push({
      region,
      hub: String(f[cHub] ?? "").trim(),
      ruta,
      zonas: ruta.split("/").map((z) => z.trim()).filter(Boolean),
      dias,
      nota: cNota >= 0 ? String(f[cNota] ?? "").trim() || null : null,
    });
  }
  if (!rutas.length) throw new Error("La hoja «Frecuencias por zona» no trae rutas.");
  return rutas;
}

/** Nombres con que se puede reconocer una zona: "Guápiles-Pococí" → guapiles pococi, guapiles, pococi. */
export function aliasDeZona(zona: string): string[] {
  const limpia = zona.replace(/\(.*?\)/g, " ").replace(/\*/g, " ");
  const base = normalizarLugar(limpia);
  const partes = limpia.split("-").map(normalizarLugar).filter(Boolean);
  const alias = new Set([base, ...(partes.length > 1 ? partes : [])]);
  // "Santa Cruz centro" es el centro del cantón Santa Cruz.
  if (base.endsWith(" centro")) alias.add(base.replace(/ centro$/, ""));
  return Array.from(alias).filter((a) => a.length >= 3);
}

// Nombres que también son palabras comunes en una dirección ("de la Cruz
// Roja", "frente al potrero"): solo cuentan si vienen en cantón o distrito.
const SOLO_EN_CAMPO = new Set(["la cruz", "salto", "potrero", "cartagena", "manzanillo", "limon", "osa", "canas", "coco", "bejuco", "anita grande", "el humo", "uvita", "caribe sur"]);

const contiene = (texto: string, alias: string) => ` ${texto} `.includes(` ${alias} `);

export interface ZonaEncontrada {
  ruta: RutaWyn;
  zona: string;
  /** De dónde salió: "distrito", "canton", "provincia" o "direccion". */
  por: "distrito" | "canton" | "provincia" | "direccion";
}

/**
 * La ruta de WYN del cliente. Primero el distrito (Nicoya / Nosara es Nosara,
 * no Nicoya), después el cantón y al final la dirección escrita. Entre
 * varias, gana el nombre más largo (Cañas Dulces antes que Cañas).
 */
export function rutaDeUbicacion(rutas: RutaWyn[], u: UbicacionCliente): ZonaEncontrada | null {
  const candidatos = rutas.flatMap((ruta) => ruta.zonas.flatMap((zona) => aliasDeZona(zona).map((alias) => ({ ruta, zona, alias }))));
  candidatos.sort((a, b) => b.alias.length - a.alias.length);
  const campos: Array<[ZonaEncontrada["por"], string]> = [
    ["distrito", normalizarLugar(u.distrito)],
    ["canton", normalizarLugar(u.canton)],
    ["direccion", normalizarLugar(u.direccion)],
  ];
  for (const [por, texto] of campos) {
    if (!texto) continue;
    const hit = candidatos.find((c) => (por === "direccion" ? !SOLO_EN_CAMPO.has(c.alias) && c.alias.length >= 5 : true) && (texto === c.alias || contiene(texto, c.alias)));
    if (hit) return { ruta: hit.ruta, zona: hit.zona, por };
  }
  return null;
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

/** Fecha "YYYY-MM-DD" y hora en Costa Rica. */
function hoyEn(ahora: Date, tz = ZONA_HORARIA): { fecha: string; hora: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora)
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) };
}

const aDate = (f: string) => new Date(`${f}T12:00:00Z`);
const aTexto = (d: Date) => d.toISOString().slice(0, 10);
const sumar = (f: string, dias: number) => aTexto(new Date(aDate(f).getTime() + dias * 86_400_000));
export const diaSemana = (f: string) => aDate(f).getUTCDay();

function siguienteHabil(f: string): string {
  return diaSemana(f) === 0 ? sumar(f, 1) : f;
}

/** Primer día de ruta desde `desde` (inclusive). */
export function primerDiaDeRuta(dias: number[], desde: string): string {
  let f = desde;
  for (let i = 0; i < 14; i++) {
    if (dias.includes(diaSemana(f))) return f;
    f = sumar(f, 1);
  }
  return desde;
}

export interface Entregas {
  /** Cuándo sale de Boxful. */
  despacho: string;
  /** Próxima entrega posible. */
  entrega: string;
  /** Si esa no se concreta, la siguiente. */
  siguiente: string;
}

export function proximasEntregas(dias: number[], ahora = new Date(), opts: { corteHora?: number; diasAlHub?: number } = {}): Entregas {
  const { fecha, hora } = hoyEn(ahora);
  const corte = opts.corteHora ?? CORTE_HORA;
  const despacho = siguienteHabil(hora < corte ? fecha : sumar(fecha, 1));
  const hub = siguienteHabil(sumar(despacho, opts.diasAlHub ?? DIAS_AL_HUB));
  const entrega = primerDiaDeRuta(dias, hub);
  const siguiente = primerDiaDeRuta(dias, sumar(entrega, 1));
  return { despacho, entrega, siguiente };
}

/** "lunes y jueves", "lunes a sábado", "martes, jueves y sábado". */
export function nombresDias(dias: number[]): string {
  const d = [...dias].sort();
  if (d.join() === DIAS_TODOS.join()) return "lunes a sábado";
  if (d.join() === "1,2,3,4,5") return "lunes a viernes";
  const n = d.map((x) => NOMBRE_DIA[x]);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

/** "jueves 20/11". */
export function fechaCorta(f: string): string {
  const d = aDate(f);
  return `${NOMBRE_DIA[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ¿WYN pasa por la zona ese día? (para reprogramar en Novedades). */
export function esDiaDeRuta(dias: number[], f: string): boolean {
  return dias.includes(diaSemana(f));
}
