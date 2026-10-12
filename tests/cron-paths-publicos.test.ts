// Todo cron declarado en vercel.json tiene que pasar la puerta del middleware.
//
// HISTORIA: agregar un cron eran DOS ediciones en archivos distintos
// —vercel.json y la lista PUBLIC_PATHS del middleware— y nada las ataba.
// Cuando faltaba la segunda, Vercel invocaba el cron puntualmente, el
// middleware lo cortaba con 401 y el cron "corria" sin hacer nada: en los logs
// se veia la invocacion, en la base no pasaba nada.
//
// Asi se perdio shopify-recent: 18 invocaciones cada 10 minutos, todas 401,
// mientras los pedidos seguian entrando solo cada 3 horas por la barrida
// vieja. El sintoma que lo delato fue que todos los pedidos compartian el
// mismo synced_at, siempre en frontera de 3 horas.
//
// AHORA: el middleware deja pasar todo /api/cron/* por una sola puerta (sesion
// o CRON_SECRET, lib/cron-auth.ts), definida en la tabla de reglas de
// lib/permisos.ts. El olvido ya no es posible por construccion. Este test
// verifica que siga siendo asi.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exigenciaDe } from "../lib/permisos";

const ROOT = path.resolve(__dirname, "..");

function cronPathsFromVercelJson(): string[] {
  const raw = readFileSync(path.join(ROOT, "vercel.json"), "utf8");
  const config = JSON.parse(raw) as { crons?: Array<{ path?: string }> };
  return (config.crons ?? [])
    .map((cron) => String(cron.path ?? ""))
    .map((p) => p.split("?")[0])
    .filter(Boolean);
}

describe("crons y middleware", () => {
  it("hay crons declarados (la prueba no pasa por lista vacia)", () => {
    expect(cronPathsFromVercelJson().length).toBeGreaterThan(5);
  });

  it("cada cron de vercel.json vive bajo /api/cron/, que es lo que cubre la puerta", () => {
    const fuera = cronPathsFromVercelJson().filter((p) => !p.startsWith("/api/cron/"));
    expect(fuera, `Estos crons no pasan por la puerta de crons: ${fuera.join(", ")}`).toEqual([]);
  });

  it("cada cron cae en la puerta de crons (sesion o CRON_SECRET), no en otra regla", () => {
    // Desde el 12/10/2026 la puerta es una tabla de reglas (lib/permisos.ts)
    // que usa el middleware: /api/cron/* tiene su propia regla de tipo "cron".
    const otra = cronPathsFromVercelJson().filter((p) => exigenciaDe(p).tipo !== "cron");
    expect(otra, `Crons que no pasan por la puerta de crons: ${otra.join(", ")}`).toEqual([]);
  });

  it("ningun cron es publico: abiertos a cualquiera era el problema", () => {
    const abiertos = cronPathsFromVercelJson().filter((p) => exigenciaDe(p).tipo === "publico");
    expect(abiertos).toEqual([]);
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
