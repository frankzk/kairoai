// Estado de iComfly y ultima nota a la vista en Gestion › Pendientes
// (17/11/2026). En iComfly el pedido ya dice "Comprar Despues", "Modificar
// Direccion"... pero en Kairo todos se veian como "Pendiente / Sin llamar" y la
// asesora tenia que abrir cada uno para leer la nota. El 17/11 eran 126 en
// "Comprar Despues", 154 en "Modificar Direccion" y 64 por coordinar entrega.
//
// Puro (sin imports de servidor): lo usan la ruta /api/finance/orders y la
// pagina. Se prueba en tests/icomfly-estado-lista.test.ts.

/** Color de la etiqueta, como en el desplegable de estados de iComfly. */
const COLORES: Array<[RegExp, string]> = [
  [/compra[r]? despu|comprar[aá] despu/i, "border-purple-500/40 bg-purple-500/10 text-purple-300"],
  [/modificar direcci/i, "border-blue-500/40 bg-blue-500/10 text-blue-300"],
  [/modificar pedido/i, "border-violet-500/40 bg-violet-500/10 text-violet-300"],
  [/coordinar|cordinar|repartidor/i, "border-teal-500/40 bg-teal-500/10 text-teal-300"],
  [/confirmad|pagado/i, "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"],
  [/cancelad/i, "border-rose-500/40 bg-rose-500/10 text-rose-300"],
  [/agotad/i, "border-orange-500/40 bg-orange-500/10 text-orange-300"],
  [/testeo/i, "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"],
  [/pendiente/i, "border-amber-500/40 bg-amber-500/10 text-amber-300"],
];

export function claseEstadoIcomfly(estado: string): string {
  for (const [re, cls] of COLORES) if (re.test(estado)) return cls;
  return "border-border bg-muted text-muted-foreground";
}

/** "Comprar Después" tal cual; "quiere cordinar entrega..." con mayuscula inicial. */
export function etiquetaEstadoIcomfly(estado: string): string {
  const t = estado.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

export interface EstadoIcomflyCount {
  estado: string;
  count: number;
}

const SIN_ESTADO = "Sin estado en iComfly";

export const estadoIcomflyDe = (row: { icomfly_estado?: string | null }) => (row.icomfly_estado ?? "").trim() || SIN_ESTADO;

/** Conteo por estado de iComfly, de mayor a menor (lo "sin estado" al final). */
export function contarEstadosIcomfly(rows: Array<{ icomfly_estado?: string | null }>): EstadoIcomflyCount[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const e = estadoIcomflyDe(r);
    m.set(e, (m.get(e) ?? 0) + 1);
  }
  return Array.from(m, ([estado, count]) => ({ estado, count })).sort(
    (a, b) => Number(a.estado === SIN_ESTADO) - Number(b.estado === SIN_ESTADO) || b.count - a.count || a.estado.localeCompare(b.estado)
  );
}

export function pasaEstadoIcomfly(row: { icomfly_estado?: string | null }, filtro: string): boolean {
  return !filtro || estadoIcomflyDe(row) === filtro;
}
