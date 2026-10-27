// La lista de asesoras la lee cualquiera con sesion (selector de Leads), pero
// correo, usuario de iComfly y extension solo quien administra personal.

import { describe, expect, it } from "vitest";
import { planillaPara, veePlanillaCompleta } from "../lib/planilla-publica";
import type { PayrollStaff } from "../lib/finance-types";

const staff: PayrollStaff[] = [
  {
    id: 21,
    name: "Mónica Espinoza",
    role: "Asesora",
    active: true,
    email: "mespinozapublicidad@gmail.com",
    icomfly_user_id: 77,
    zadarma_sip: "499499-100",
    created_at: "2026-10-27T00:00:00Z",
    updated_at: "2026-10-27T00:00:00Z",
  },
];

describe("planillaPara", () => {
  it("una asesora ve solo id, nombre, funcion y si esta activa", () => {
    const r = planillaPara(staff, ["leads", "novedades"]);
    expect(r).toEqual([{ id: 21, name: "Mónica Espinoza", role: "Asesora", active: true }]);
    expect(JSON.stringify(r)).not.toContain("@");
  });

  it("finanzas y usuarios ven la ficha completa", () => {
    expect(planillaPara(staff, ["finanzas"])).toBe(staff);
    expect(planillaPara(staff, ["usuarios"])).toBe(staff);
  });

  it("un proceso del sistema (sin persona) ve todo", () => {
    expect(veePlanillaCompleta(null)).toBe(true);
  });
});
