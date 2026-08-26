// Todo cron declarado en vercel.json tiene que estar en la lista publica del
// middleware.
//
// Agregar un cron son DOS ediciones en archivos distintos —vercel.json y
// middleware.ts— y nada las ataba. Cuando falta la segunda, Vercel invoca el
// cron puntualmente, el middleware lo corta con 401 y el cron "corre" sin
// hacer nada: en los logs se ve la invocacion, en la base no pasa nada.
//
// Asi se perdio shopify-recent: 18 invocaciones cada 10 minutos, todas 401,
// mientras los pedidos seguian entrando solo cada 3 horas por la barrida
// vieja. El sintoma que lo delato fue que todos los pedidos compartian el
// mismo synced_at, siempre en frontera de 3 horas.
//
// Esta prueba es el lazo que faltaba: si alguien agrega un cron y se olvida
// del middleware, falla aca y no en produccion.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function cronPathsFromVercelJson(): string[] {
  const raw = readFileSync(path.join(ROOT, "vercel.json"), "utf8");
  const config = JSON.parse(raw) as { crons?: Array<{ path?: string }> };
  return (config.crons ?? [])
    .map((cron) => String(cron.path ?? ""))
    // El path puede traer query string; la lista del middleware compara solo
    // la ruta.
    .map((p) => p.split("?")[0])
    .filter(Boolean);
}

function publicPathsFromMiddleware(): string[] {
  const source = readFileSync(path.join(ROOT, "middleware.ts"), "utf8");
  const block = source.match(/const PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("No se encontro PUBLIC_PATHS en middleware.ts");
  return Array.from(block[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

describe("crons y middleware", () => {
  it("cada cron de vercel.json esta en PUBLIC_PATHS del middleware", () => {
    const publicos = new Set(publicPathsFromMiddleware());
    const faltantes = cronPathsFromVercelJson().filter((p) => !publicos.has(p));
    expect(
      faltantes,
      `Estos crons los va a cortar el middleware con 401: ${faltantes.join(", ")}`
    ).toEqual([]);
  });

  it("hay crons declarados (la prueba no pasa por lista vacia)", () => {
    expect(cronPathsFromVercelJson().length).toBeGreaterThan(5);
  });

  it("cada cron de vercel.json tiene su archivo de ruta", () => {
    // El otro olvido posible: declarar el cron y que la ruta no exista.
    const sinRuta = cronPathsFromVercelJson().filter((p) => {
      const file = path.join(ROOT, "app", `${p}`, "route.ts");
      try {
        readFileSync(file);
        return false;
      } catch {
        return true;
      }
    });
    expect(sinRuta, `Crons declarados sin route.ts: ${sinRuta.join(", ")}`).toEqual([]);
  });
});
