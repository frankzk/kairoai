// Planilla quincenal: quincenas, total a pagar por persona, abonos y saldo.
//
// Una quincena es la 1 (del 1 al 15) o la 2 (del 16 a fin de mes). Por persona:
//   total a pagar = base + extras/bonos/comisiones - rebajos/CCSS
//   abonado       = suma de los abonos no anulados
//   saldo         = total a pagar - abonado
// Los adelantos son abonos (se pagan antes del cierre), no rebajos: asi no se
// descuentan dos veces.
//
// Puro (sin base ni red): lo usan la ruta /api/finance/planilla y la pestaña
// Planilla de Gestión. Se prueba en tests/planilla.test.ts.

export type AjusteTipo = "extra" | "bono" | "comision" | "otro_suma" | "rebajo" | "ccss" | "otro_resta";

export const AJUSTES: Array<{ value: AjusteTipo; label: string; signo: 1 | -1 }> = [
  { value: "extra", label: "Horas extra", signo: 1 },
  { value: "bono", label: "Bono", signo: 1 },
  { value: "comision", label: "Comisión", signo: 1 },
  { value: "otro_suma", label: "Otro (suma)", signo: 1 },
  { value: "rebajo", label: "Rebajo", signo: -1 },
  { value: "ccss", label: "CCSS", signo: -1 },
  { value: "otro_resta", label: "Otro (resta)", signo: -1 },
];

export const METODOS_PAGO = ["SINPE Móvil", "Transferencia", "Efectivo", "Otro"] as const;

export function esAjusteTipo(value: unknown): value is AjusteTipo {
  return AJUSTES.some((a) => a.value === value);
}

export function signoAjuste(tipo: AjusteTipo): 1 | -1 {
  return AJUSTES.find((a) => a.value === tipo)?.signo ?? 1;
}

export function etiquetaAjuste(tipo: AjusteTipo): string {
  return AJUSTES.find((a) => a.value === tipo)?.label ?? tipo;
}

const PERIOD_RE = /^(\d{4})-(\d{2})-([12])$/;

/** "2026-11-1" -> del 1 al 15 de noviembre; "2026-11-2" -> del 16 al 30. */
export function quincenaDe(periodKey: string): { startsOn: string; endsOn: string } | null {
  const m = PERIOD_RE.exec(periodKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return m[3] === "1"
    ? { startsOn: `${year}-${mm}-01`, endsOn: `${year}-${mm}-15` }
    : { startsOn: `${year}-${mm}-16`, endsOn: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export function esQuincena(value: unknown): value is string {
  return typeof value === "string" && quincenaDe(value) != null;
}

/** Quincena de una fecha YYYY-MM-DD. */
export function quincenaDeFecha(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${y}-${m}-${Number(d) <= 15 ? 1 : 2}`;
}

/** La quincena anterior o siguiente. */
export function moverQuincena(periodKey: string, pasos: number): string {
  const m = PERIOD_RE.exec(periodKey);
  if (!m) return periodKey;
  let index = Number(m[1]) * 24 + (Number(m[2]) - 1) * 2 + (Number(m[3]) - 1) + pasos;
  const year = Math.floor(index / 24);
  index -= year * 24;
  const month = Math.floor(index / 2) + 1;
  const half = (index % 2) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${half}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-11-2" -> "16 al 30 de noviembre 2026". */
export function nombreQuincena(periodKey: string): string {
  const q = quincenaDe(periodKey);
  if (!q) return periodKey;
  const [y, m] = periodKey.split("-");
  return `${Number(q.startsOn.slice(8))} al ${Number(q.endsOn.slice(8))} de ${MESES[Number(m) - 1]} ${y}`;
}

export interface AjusteLike {
  kind: AjusteTipo;
  amount: number;
}

export interface AbonoLike {
  amount: number;
  voided_at?: string | null;
}

export type EstadoPago = "sin_monto" | "pendiente" | "parcial" | "pagado" | "sobrepago";

export interface TotalesLinea {
  base: number;
  sumas: number;
  restas: number;
  total: number;
  abonado: number;
  saldo: number;
  estado: EstadoPago;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function totalesLinea(base: number, ajustes: AjusteLike[], abonos: AbonoLike[]): TotalesLinea {
  let sumas = 0;
  let restas = 0;
  for (const a of ajustes) {
    if (signoAjuste(a.kind) === 1) sumas += num(a.amount);
    else restas += num(a.amount);
  }
  const total = round2(num(base) + sumas - restas);
  const abonado = round2(abonos.filter((p) => !p.voided_at).reduce((s, p) => s + num(p.amount), 0));
  const saldo = round2(total - abonado);
  const estado: EstadoPago =
    total <= 0 && abonado === 0
      ? "sin_monto"
      : saldo < 0
        ? "sobrepago"
        : saldo === 0
          ? "pagado"
          : abonado > 0
            ? "parcial"
            : "pendiente";
  return { base: round2(num(base)), sumas: round2(sumas), restas: round2(restas), total, abonado, saldo, estado };
}

export const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = {
  sin_monto: "Sin monto",
  pendiente: "Pendiente",
  parcial: "Abono parcial",
  pagado: "Pagado",
  sobrepago: "Pagado de más",
};

/** Totales de la quincena por moneda (puede haber personas en CRC y en USD). */
export function totalesQuincena(lineas: Array<{ moneda: string; totales: TotalesLinea }>) {
  const porMoneda = new Map<string, { total: number; abonado: number; saldo: number; personas: number; pagadas: number }>();
  for (const l of lineas) {
    const t = porMoneda.get(l.moneda) ?? { total: 0, abonado: 0, saldo: 0, personas: 0, pagadas: 0 };
    t.total = round2(t.total + l.totales.total);
    t.abonado = round2(t.abonado + l.totales.abonado);
    t.saldo = round2(t.saldo + l.totales.saldo);
    t.personas += 1;
    if (l.totales.estado === "pagado" || l.totales.estado === "sobrepago" || l.totales.estado === "sin_monto") t.pagadas += 1;
    porMoneda.set(l.moneda, t);
  }
  return Array.from(porMoneda.entries()).map(([moneda, t]) => ({ moneda, ...t }));
}

/** Se puede cerrar cuando nadie tiene saldo pendiente. */
export function puedeCerrar(lineas: Array<{ totales: TotalesLinea }>): boolean {
  return lineas.length > 0 && lineas.every((l) => l.totales.saldo <= 0);
}

const SIMBOLO: Record<string, string> = { CRC: "₡", USD: "US$ ", PEN: "S/ " };

export function formatoMonto(monto: number, moneda: string): string {
  const symbol = SIMBOLO[moneda] ?? `${moneda} `;
  const value = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(monto);
  return monto < 0 ? `−${symbol}${value.replace("-", "")}` : `${symbol}${value}`;
}

/** Monedas de pago. Soles primero: el equipo cobra en soles. */
export const MONEDAS = ["PEN", "CRC", "USD"] as const;
export type Moneda = (typeof MONEDAS)[number];
export const esMoneda = (v: unknown): v is Moneda => (MONEDAS as readonly string[]).includes(String(v));

/** Nota del gasto en colones, en el formato que Gastos ya sabe leer. */
export function notaGasto(moneda: string, monto: number, tipoCambio: number | null, nota: string): string {
  if (moneda === "CRC" || !tipoCambio) return nota;
  return [`Monto original: ${moneda} ${monto.toFixed(2)}`, `Tipo de cambio ${moneda}->CRC: ${tipoCambio}`, nota ? `Nota: ${nota}` : ""]
    .filter(Boolean)
    .join("\n");
}

/** Monto en colones de un abono. */
export function montoEnColones(moneda: string, monto: number, tipoCambio: number | null): number {
  if (moneda === "CRC") return round2(monto);
  return round2(monto * (tipoCambio ?? 0));
}
