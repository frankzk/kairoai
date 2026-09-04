// Nadie puede volver a pedirle a PostgREST mas de 1.000 filas de una.
//
// POR QUE ESTE TEST EXISTE: PostgREST corta TODA respuesta en 1.000 filas
// (`max-rows`) y lo hace EN SILENCIO — no devuelve error, no avisa, solo manda
// menos datos. Un `.limit(2000)` no es un tope: es una mentira que compila,
// pasa los tests y produce numeros equivocados en produccion.
//
// Ya nos mordio TRES veces:
//
//   1. El tablero de Novedades pedia `.limit(8000)` y contaba 64 novedades
//      nuevas en 7 dias cuando en la base habia 272.
//   2. `listIncidentKeys` pedia `.limit(10000)` y veia el 43% de las claves.
//      Esa lista decide si una entrega confirmada cierra una novedad abierta,
//      asi que 26 paquetes ya entregados y 42 ya devueltos seguian figurando
//      como trabajo pendiente: 68 de 197 abiertas (03/09/2026).
//   3. `countLeadStages` pedia `.limit(100000)` en el tablero de Leads.
//
// Las tres se encontraron por casualidad, mirando otra cosa. Este test las
// encuentra en CI.
//
// LA FORMA CORRECTA de traer mas de 1.000 filas es paginar con `.range()` y un
// `.order()` estable: ver `fetchAll` en lib/incidents.ts o `fetchLeadPages` en
// lib/leads.ts.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tope real de PostgREST. Pedir mas no rompe: miente. */
const MAX_ROWS_POSTGREST = 1000;

const RAICES = ["lib", "app"];

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) archivosTs(ruta, acc);
    else if (/\.tsx?$/.test(entrada)) acc.push(ruta);
  }
  return acc;
}

interface Hallazgo {
  archivo: string;
  linea: number;
  pedido: number;
  fuente: string;
}

/**
 * Busca `.limit(N)` con N > 1.000, sea literal o una constante del mismo
 * archivo (`const MAX_ROWS = 2000` y despues `.limit(MAX_ROWS)` — asi estaba
 * escrito el caso de la auditoria de despacho).
 */
function pedidosDemasiadoGrandes(archivo: string): Hallazgo[] {
  const texto = readFileSync(archivo, "utf8");
  const lineas = texto.split("\n");

  // Constantes numericas del archivo, para resolver `.limit(MAX_ROWS)`.
  const constantes = new Map<string, number>();
  const declaracion = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(\d[\d_]*)\s*;/g;
  for (let m = declaracion.exec(texto); m; m = declaracion.exec(texto)) {
    constantes.set(m[1], Number(m[2].replace(/_/g, "")));
  }

  const hallazgos: Hallazgo[] = [];
  lineas.forEach((linea, i) => {
    // Los comentarios hablan del problema; no son el problema.
    if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
    const uso = /\.limit\(\s*([A-Za-z_$][\w$]*|\d[\d_]*)\s*\)/g;
    for (let m = uso.exec(linea); m; m = uso.exec(linea)) {
      const arg = m[1];
      const valor = /^\d/.test(arg)
        ? Number(arg.replace(/_/g, ""))
        : constantes.get(arg);
      // Un argumento que no se puede resolver (variable, parametro, expresion)
      // no se juzga: este test avisa de lo que se ve escrito, no adivina.
      if (valor != null && valor > MAX_ROWS_POSTGREST) {
        hallazgos.push({ archivo, linea: i + 1, pedido: valor, fuente: linea.trim() });
      }
    }
  });
  return hallazgos;
}

describe("nadie le pide a PostgREST mas de 1.000 filas de una", () => {
  it("no hay .limit() por encima del tope real", () => {
    const hallazgos = RAICES.flatMap((raiz) => archivosTs(raiz)).flatMap(
      pedidosDemasiadoGrandes
    );

    const detalle = hallazgos
      .map(
        (h) =>
          `  ${h.archivo}:${h.linea} pide ${h.pedido} y recibiria ${MAX_ROWS_POSTGREST}\n` +
          `    ${h.fuente}`
      )
      .join("\n");

    expect(
      hallazgos,
      hallazgos.length
        ? `PostgREST corta en ${MAX_ROWS_POSTGREST} filas EN SILENCIO, asi que estos ` +
          `topes no topan nada: devuelven datos incompletos sin avisar.\n${detalle}\n` +
          `Para traer mas, paginar con .range() y un .order() estable ` +
          `(ver fetchAll en lib/incidents.ts o fetchLeadPages en lib/leads.ts).`
        : ""
    ).toEqual([]);
  });

  it("el detector reconoce las dos formas de escribirlo", () => {
    // Guarda de la guarda: si el regex deja de matchear, el test de arriba pasa
    // sin mirar nada y volvemos a estar ciegos.
    const tmp = join("tests", "__fixtures-limite.ts");
    const { writeFileSync, unlinkSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(
      tmp,
      [
        "const MAX_ROWS = 2000;",
        'db.from("t").select("*").limit(MAX_ROWS);',
        'db.from("t").select("*").limit(8000);',
        'db.from("t").select("*").limit(1000);',
        'db.from("t").select("*").limit(pageSize);',
      ].join("\n")
    );
    try {
      const h = pedidosDemasiadoGrandes(tmp);
      // Detecta la constante y el literal; deja pasar el que esta justo en el
      // tope y el que no se puede resolver.
      expect(h.map((x) => x.pedido).sort((a, b) => a - b)).toEqual([2000, 8000]);
    } finally {
      unlinkSync(tmp);
    }
  });
});
