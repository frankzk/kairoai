// Escalas y posiciones de los gráficos de Marketing (sin React: se prueban solas).
// Las usa components/marketing/charts.tsx; aquí no hay colores ni textos.

/**
 * Ticks limpios desde 0 hasta un tope redondo ≥ max (pasos de 1, 2 o 5 × 10ⁿ).
 * `integer` evita pasos fraccionarios para conteos (pedidos).
 */
export function niceTicks(max: number, target = 4, integer = false): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const raw = max / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step =
    [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ??
    10 * magnitude;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + step * 1e-9; i++)
    ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

/** Índice del punto más cercano en un eje de `n` puntos repartidos en [left, left+width]. */
export function nearestIndex(
  x: number,
  n: number,
  left: number,
  width: number,
): number {
  if (n <= 1 || width <= 0) return 0;
  const i = Math.round(((x - left) / width) * (n - 1));
  return Math.min(n - 1, Math.max(0, i));
}

/** Banda (columna) bajo el puntero: `n` bandas iguales en [left, left+width]. */
export function bandIndex(
  x: number,
  n: number,
  left: number,
  width: number,
): number {
  if (n <= 1 || width <= 0) return 0;
  const i = Math.floor(((x - left) / width) * n);
  return Math.min(n - 1, Math.max(0, i));
}

/**
 * Qué etiquetas del eje X caben sin chocar: siempre la primera y la última,
 * y las intermedias repartidas cuando hay sitio (`room` px por etiqueta).
 */
export function xLabelIndexes(n: number, width: number, room = 56): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const fit = Math.max(2, Math.floor(width / room));
  if (fit >= n) return Array.from({ length: n }, (_, i) => i);
  const slots = fit - 1;
  const step = Math.ceil((n - 1) / slots);
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  // La última siempre; quita la intermedia previa si quedaría pegada.
  const gapPx = ((n - 1 - out[out.length - 1]) / (n - 1)) * width;
  if (out.length > 1 && gapPx < room) out.pop();
  out.push(n - 1);
  return out;
}

/** Las etiquetas al final de las líneas solo se ponen si no se pisan. */
export function labelsFit(ys: number[], minGap = 14): boolean {
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.every((y, i) => i === 0 || y - sorted[i - 1] >= minGap);
}

/** Recorta un nombre largo para una etiqueta directa (el completo va en la leyenda). */
export function shortName(name: string, max = 16): string {
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Columna con la punta redondeada (4 px) y la base recta sobre el eje.
 * Devuelve el `d` de un <path>; si es más baja que el radio, el radio se ajusta.
 */
export function columnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const b = y + height;
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${b}Z`;
}
