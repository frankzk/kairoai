// Una ruta que corta su trabajo por presupuesto de tiempo y DESPUES reconstruye
// la cache de Finanzas necesita tiempo de sobra para eso ultimo.
//
// EL CASO REAL (07/10/2026): shopify-refresh paginaba hasta 50 s con un
// maxDuration de 60 s, y despues reconstruia la cache de Finanzas de cada
// tienda. No entraba: en 3 dias Vercel corto 10 corridas de shopify-refresh, 6
// de shopify-recheck-stale y 2 de la sincronizacion manual con "Task timed out
// after 60 seconds". La tira roja marcaba "Guias de Shopify sin actualizar hace
// 8 h" y era cierto: los pedidos que cambian en Shopify (guias, anulaciones)
// dejaban de actualizarse.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
// Lo que una ruta tiene que poder usar DESPUES de su presupuesto de paginado.
// Referencia medida: el cron de Forza deja 100 s (300 - 200) y no tuvo ni un
// corte en los mismos 3 dias; las que dejaban 10 s se cortaban.
const MARGEN_MINIMO_MS = 90_000;

function rutas(dir: string): string[] {
  const out: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const p = path.join(dir, nombre);
    if (statSync(p).isDirectory()) out.push(...rutas(p));
    else if (nombre === "route.ts") out.push(p);
  }
  return out;
}

function numero(src: string, re: RegExp): number | null {
  const m = src.match(re);
  return m ? Number(m[1].replace(/_/g, "")) : null;
}

const conPresupuestoYCache = rutas(path.join(ROOT, "app/api"))
  .map((file) => ({ file: path.relative(ROOT, file), src: readFileSync(file, "utf8") }))
  .filter(({ src }) => /TIME_BUDGET_MS\s*=/.test(src) && src.includes("refreshFinanceDatasetCache("));

describe("tiempo limite de las rutas que reconstruyen la cache", () => {
  it("las encuentra (el test no pasa por lista vacia)", () => {
    const nombres = conPresupuestoYCache.map((r) => r.file);
    expect(nombres).toContain("app/api/cron/shopify-refresh/route.ts");
    expect(nombres).toContain("app/api/cron/shopify-recheck-stale/route.ts");
  });

  it.each(conPresupuestoYCache.map((r) => [r.file, r.src]))(
    "%s deja al menos 90 s despues del presupuesto",
    (_file, src) => {
      const maxDuration = numero(src, /export const maxDuration\s*=\s*([\d_]+)/);
      const presupuesto = numero(src, /TIME_BUDGET_MS\s*=\s*([\d_]+)/);
      expect(maxDuration).not.toBeNull();
      expect(presupuesto).not.toBeNull();
      expect(maxDuration! * 1000 - presupuesto!).toBeGreaterThanOrEqual(MARGEN_MINIMO_MS);
    }
  );

  it("la sincronizacion manual de Shopify tampoco se queda en 60 s", () => {
    // No tiene presupuesto con nombre, pero pagina y reconstruye la cache igual;
    // se corto 2 veces en 3 dias.
    const src = readFileSync(path.join(ROOT, "app/api/finance/shopify-sync/route.ts"), "utf8");
    expect(numero(src, /export const maxDuration\s*=\s*([\d_]+)/)).toBe(300);
  });
});
