// Deshacer la ultima gestion de un lead.
//
// POR QUE ESTE TEST EXISTE: "Resultado de la llamada" es la unica accion
// destructiva del tablero de Leads y se dispara con UN clic, sin confirmar.
// Son seis botones rapidos pegados mas un desplegable de 19 estados que
// escribe con `onChange` —o sea que navegarlo con las flechas del teclado ya
// compromete el estado, `lista_negra` incluido— y encima agenda una fecha de
// recontacto.
//
// Un Deshacer que revierte la gestion equivocada, o que restaura solo algunos
// campos, es un segundo error y silencioso: peor que no tener Deshacer. Por
// eso las reglas viven en un modulo sin base de datos y se prueban aqui.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMPOS_DE_GESTION,
  decidirDeshacer,
  KINDS_QUE_MUEVEN_EL_ESTADO,
  parseGestionSnapshot,
  VENTANA_DESHACER_MS,
  type FilaDeHistorial,
} from "../lib/leads-undo";

const AHORA = new Date("2026-09-12T15:00:00Z").getTime();

const SNAPSHOT_COMPLETO = {
  status: "conversando",
  category: "open",
  status_source: "auto",
  auto_reason: "el bot lo puso en frio por inactividad",
  needs_attention: true,
  closed_by: null,
  next_followup_at: null,
};

function fila(over: Partial<FilaDeHistorial> = {}): FilaDeHistorial {
  return {
    id: 501,
    kind: "state_change",
    prev_state: SNAPSHOT_COMPLETO,
    new_status: "lista_negra",
    occurred_at: new Date(AHORA - 5_000).toISOString(),
    ...over,
  };
}

describe("parseGestionSnapshot", () => {
  it("acepta una instantanea completa y devuelve los siete campos", () => {
    const snap = parseGestionSnapshot(SNAPSHOT_COMPLETO);
    expect(snap).not.toBeNull();
    for (const campo of CAMPOS_DE_GESTION) {
      expect(snap).toHaveProperty(campo);
    }
    expect(snap?.status).toBe("conversando");
    expect(snap?.needs_attention).toBe(true);
  });

  // Es una columna JSONB: el tipo de TypeScript no prueba nada sobre lo que
  // hay guardado de verdad. Restaurar a medias deja el lead peor que antes.
  it.each(CAMPOS_DE_GESTION)("rechaza la instantanea si le falta %s", (campo) => {
    const parcial: Record<string, unknown> = { ...SNAPSHOT_COMPLETO };
    delete parcial[campo];
    expect(parseGestionSnapshot(parcial)).toBeNull();
  });

  it("rechaza lo que no es un objeto de campos", () => {
    expect(parseGestionSnapshot(null)).toBeNull();
    expect(parseGestionSnapshot(undefined)).toBeNull();
    expect(parseGestionSnapshot("conversando")).toBeNull();
    expect(parseGestionSnapshot(42)).toBeNull();
    expect(parseGestionSnapshot([SNAPSHOT_COMPLETO])).toBeNull();
  });

  it("rechaza un campo con el tipo equivocado", () => {
    expect(parseGestionSnapshot({ ...SNAPSHOT_COMPLETO, status: 7 })).toBeNull();
    expect(parseGestionSnapshot({ ...SNAPSHOT_COMPLETO, needs_attention: "si" })).toBeNull();
    expect(parseGestionSnapshot({ ...SNAPSHOT_COMPLETO, status_source: null })).toBeNull();
  });

  it("deja pasar los nulos que SI son validos", () => {
    const snap = parseGestionSnapshot({
      ...SNAPSHOT_COMPLETO,
      auto_reason: null,
      closed_by: null,
      next_followup_at: null,
    });
    expect(snap?.auto_reason).toBeNull();
    expect(snap?.closed_by).toBeNull();
    expect(snap?.next_followup_at).toBeNull();
  });
});

describe("decidirDeshacer", () => {
  it("deshace la gestion que se acaba de registrar", () => {
    const d = decidirDeshacer({
      fila: fila(),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.previo.status).toBe("conversando");
  });

  it("no deshace una gestion que ya no existe", () => {
    const d = decidirDeshacer({ fila: null, ultimoIdQueMovioElEstado: null, nowMs: AHORA });
    expect(d).toEqual({ ok: false, reason: "Esa gestión ya no existe." });
  });

  // Las gestiones registradas antes de la migracion 0036 no tienen
  // instantanea: no se puede saber a que estado volver.
  it("no deshace una gestion sin instantanea", () => {
    const d = decidirDeshacer({
      fila: fila({ prev_state: null }),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(false);
  });

  it("no deshace una fila que no es una gestion", () => {
    for (const kind of ["undo", "system", "sale", "note", "call"]) {
      const d = decidirDeshacer({
        fila: fila({ kind }),
        ultimoIdQueMovioElEstado: 501,
        nowMs: AHORA,
      });
      expect(d.ok, kind).toBe(false);
    }
  });

  // El candado que importa: si despues de la gestion paso algo mas que movio
  // el estado —el cruce con Shopify marcando el lead como ganado, por
  // ejemplo— revertir borraria ESE cambio sin decirlo.
  it("no deshace si el lead cambio despues", () => {
    const d = decidirDeshacer({
      fila: fila(),
      ultimoIdQueMovioElEstado: 502,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain("cambió después");
  });

  it("no deshace si no hay ninguna fila posterior registrada", () => {
    // Ni siquiera la propia: algo esta mal, no se toca el lead.
    const d = decidirDeshacer({
      fila: fila(),
      ultimoIdQueMovioElEstado: null,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(false);
  });

  it("deshace dentro de la ventana y no fuera", () => {
    const dentro = decidirDeshacer({
      fila: fila({ occurred_at: new Date(AHORA - VENTANA_DESHACER_MS + 1_000).toISOString() }),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(dentro.ok).toBe(true);

    const fuera = decidirDeshacer({
      fila: fila({ occurred_at: new Date(AHORA - VENTANA_DESHACER_MS - 1_000).toISOString() }),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.reason).toContain("demasiado tiempo");
  });

  it("no deshace con una fecha que no se puede leer", () => {
    const d = decidirDeshacer({
      fila: fila({ occurred_at: "no es una fecha" }),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(false);
  });

  // Primero lo imposible, despues lo que cambio, al final lo que caduco: el
  // mensaje tiene que decir la razon mas fuerte, no la primera que se evalue.
  it("una gestion vieja Y sin instantanea dice que no se puede deshacer", () => {
    const d = decidirDeshacer({
      fila: fila({ prev_state: null, occurred_at: new Date(AHORA - 86_400_000).toISOString() }),
      ultimoIdQueMovioElEstado: 501,
      nowMs: AHORA,
    });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("Esa gestión no se puede deshacer.");
  });
});

describe("la instantanea cubre todo lo que una gestion escribe", () => {
  // ESTE ES EL TEST FRAGIL Y POR ESO ESTA AQUI.
  //
  // `CAMPOS_DE_GESTION` tiene que listar TODOS los campos que
  // `applyDisposition` sobreescribe. El dia que alguien agregue un campo al
  // `patch` y no a la lista, Deshacer va a restaurar el lead a medias: sin
  // error, sin aviso, y con un estado que no es ni el viejo ni el nuevo.
  //
  // Se lee el fuente porque no hay otra forma: la relacion entre las dos
  // cosas no la puede comprobar el compilador.
  const fuente = readFileSync("lib/leads.ts", "utf8");
  const cuerpo = fuente.slice(fuente.indexOf("export async function applyDisposition"));
  const hastaElUpdate = cuerpo.slice(0, cuerpo.indexOf('.from("leads")'));

  it("los campos del patch estan todos en CAMPOS_DE_GESTION", () => {
    // `patch.foo = ...` y las claves del objeto literal `{ foo: ... }`.
    const campos = new Set<string>();
    const asignados = /patch\.([a-z_]+)\s*=/g;
    let m: RegExpExecArray | null;
    while ((m = asignados.exec(hastaElUpdate)) !== null) campos.add(m[1]);

    const literal = hastaElUpdate.slice(
      hastaElUpdate.indexOf("const patch"),
      hastaElUpdate.indexOf("};")
    );
    const claves = /^\s{4}([a-z_]+):/gm;
    while ((m = claves.exec(literal)) !== null) campos.add(m[1]);

    expect(campos.size).toBeGreaterThan(0);
    Array.from(campos).forEach((campo) => {
      expect(
        (CAMPOS_DE_GESTION as readonly string[]).includes(campo),
        `applyDisposition escribe "${campo}" y CAMPOS_DE_GESTION no lo lista: Deshacer lo dejaria a medias`
      ).toBe(true);
    });
  });
});

describe("los kinds que bloquean el Deshacer", () => {
  // `note` es un WhatsApp enviado desde la ficha y `phone` un registro de
  // llamada: ninguno toca los CAMPOS_DE_GESTION, asi que escribirle al cliente
  // justo despues de gestionar no tiene por que quitarle el Deshacer.
  it("no incluye las filas que no mueven el estado", () => {
    expect(KINDS_QUE_MUEVEN_EL_ESTADO).not.toContain("note");
    expect(KINDS_QUE_MUEVEN_EL_ESTADO).not.toContain("phone");
  });

  it("incluye las que si lo mueven, y el propio undo", () => {
    // Sin `undo` en la lista, deshacer dos veces revertiria el revertido.
    for (const kind of ["state_change", "system", "sale", "undo"]) {
      expect(KINDS_QUE_MUEVEN_EL_ESTADO).toContain(kind);
    }
  });

  it("cada kind que lib/leads.ts registra esta contemplado", () => {
    // Se leen SOLO los `insertLeadCall({...})` de lib/leads.ts: es la unica
    // puerta por la que el codigo de la app escribe en el historial. Si
    // aparece un kind nuevo que mueve el estado y no entra en la lista,
    // Deshacer lo pasaria por encima sin avisar.
    const fuente = readFileSync("lib/leads.ts", "utf8");
    const kinds = new Set<string>();
    const llamadas = /insertLeadCall\(\{/g;
    let m: RegExpExecArray | null;
    while ((m = llamadas.exec(fuente)) !== null) {
      const bloque = fuente.slice(m.index, fuente.indexOf("});", m.index));
      const kind = /kind:\s*"([a-z_]+)"/.exec(bloque)?.[1];
      if (kind) kinds.add(kind);
    }
    // `note` (un WhatsApp enviado) y `phone` (registro de llamada) no tocan
    // los CAMPOS_DE_GESTION.
    kinds.delete("note");
    kinds.delete("phone");

    expect(kinds.size).toBeGreaterThan(0);
    Array.from(kinds).forEach((kind) => {
      expect(
        KINDS_QUE_MUEVEN_EL_ESTADO.includes(kind),
        `lib/leads.ts registra kind "${kind}" y no esta en KINDS_QUE_MUEVEN_EL_ESTADO`
      ).toBe(true);
    });
  });
});
