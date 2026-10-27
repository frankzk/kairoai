// Quien registro cada gestion de Leads (lead_calls.kairo_user_id / actor).
//
// `vendedora` dice a nombre de que asesora quedo la gestion; esto dice quien
// estaba conectado. Sin la migracion 0053 la gestion se tiene que registrar
// igual (sin autor): perder la autoria es mejor que perder la gestion.

import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<Record<string, unknown>> = [];
let faltanColumnas = false;

vi.mock("@/lib/db", () => ({ getDB: () => db }));
vi.mock("../lib/db", () => ({ getDB: () => db }));

const db = {
  from: (tabla: string) => ({
    insert: (valores: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          inserts.push({ tabla, ...valores });
          if (faltanColumnas && ("kairo_user_id" in valores || "actor" in valores)) {
            return { data: null, error: { message: "Could not find the 'actor' column of 'lead_calls' in the schema cache" } };
          }
          return { data: { id: 77 }, error: null };
        },
      }),
    }),
  }),
};

type Yo = { id: number; nombre: string; permisos: never[]; tiendas: string[]; staffId: number | null };
let yo: Yo | null = null;
vi.mock("next/headers", () => ({
  headers: () => ({
    get: () => (yo ? encodeURIComponent(JSON.stringify(yo)) : null),
  }),
}));

const fila = { lead_id: 1, store_id: 1, vendedora: 21, kind: "state_change", new_status: "no_responde" };

describe("autorDeGestion", () => {
  it("usuario con fila: id y nombre", async () => {
    const { autorDeGestion } = await import("../lib/identidad");
    expect(autorDeGestion({ id: 9, nombre: "Mónica Espinoza", permisos: [], tiendas: [], staffId: 21 })).toEqual({
      kairo_user_id: 9,
      actor: "Mónica Espinoza",
    });
  });

  it("el admin de la contraseña compartida (id 0) no tiene fila en kairo_users", async () => {
    const { autorDeGestion } = await import("../lib/identidad");
    expect(autorDeGestion({ id: 0, nombre: "Administrador", permisos: [], tiendas: [], staffId: null })).toEqual({
      kairo_user_id: null,
      actor: "Administrador",
    });
  });

  it("sin persona (cron) no hay autor", async () => {
    const { autorDeGestion } = await import("../lib/identidad");
    expect(autorDeGestion(null)).toBeNull();
  });
});

describe("insertLeadCall", () => {
  beforeEach(() => {
    inserts.length = 0;
    faltanColumnas = false;
    yo = null;
  });

  it("guarda quien estaba conectado", async () => {
    yo = { id: 9, nombre: "Mónica Espinoza", permisos: [], tiendas: ["mireva-cr"], staffId: 21 };
    const { insertLeadCall } = await import("../lib/leads");
    expect(await insertLeadCall(fila)).toBe(77);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ vendedora: 21, kairo_user_id: 9, actor: "Mónica Espinoza" });
  });

  it("un cron no escribe columnas de autor", async () => {
    const { insertLeadCall } = await import("../lib/leads");
    await insertLeadCall(fila);
    expect(inserts[0]).not.toHaveProperty("kairo_user_id");
    expect(inserts[0]).not.toHaveProperty("actor");
  });

  it("sin la migracion 0053 reintenta sin autor y la gestion queda registrada", async () => {
    faltanColumnas = true;
    yo = { id: 9, nombre: "Mónica Espinoza", permisos: [], tiendas: ["mireva-cr"], staffId: 21 };
    const { insertLeadCall } = await import("../lib/leads");
    expect(await insertLeadCall(fila)).toBe(77);
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("actor");
  });

  it("reconoce el error de columna faltante y no otros", async () => {
    const { faltanColumnasDeAutor } = await import("../lib/leads");
    expect(faltanColumnasDeAutor("Could not find the 'kairo_user_id' column of 'lead_calls' in the schema cache")).toBe(true);
    expect(faltanColumnasDeAutor('column "actor" of relation "lead_calls" does not exist')).toBe(true);
    expect(faltanColumnasDeAutor("violates foreign key constraint lead_calls_lead_id_fkey")).toBe(false);
    expect(faltanColumnasDeAutor(undefined)).toBe(false);
  });
});
