import { describe, expect, it } from "vitest";
import { resumirRecibidos } from "@/lib/leads-recibidos";

describe("leads recibidos por asesora", () => {
  const leads = [
    { id: 1, claimed_by: 5, claimed_at: "2026-11-17T15:00:00Z", cerrado: false, descartado: false },
    { id: 2, claimed_by: 5, claimed_at: "2026-11-17T15:00:00Z", cerrado: true, descartado: false },
    { id: 3, claimed_by: 5, claimed_at: "2026-11-17T16:00:00Z", cerrado: false, descartado: false },
    { id: 4, claimed_by: 34, claimed_at: "2026-11-17T16:00:00Z", cerrado: false, descartado: false },
  ];
  const gestiones = [
    { lead_id: 1, kairo_user_id: 5, occurred_at: "2026-11-17T15:30:00Z" },
    { lead_id: 2, kairo_user_id: 5, occurred_at: "2026-11-17T15:10:00Z" },
    // Gestión de OTRA asesora: no cuenta como trabajado por la dueña.
    { lead_id: 3, kairo_user_id: 34, occurred_at: "2026-11-17T16:30:00Z" },
    // Gestión de antes de que se lo asignaran: tampoco.
    { lead_id: 4, kairo_user_id: 34, occurred_at: "2026-11-17T15:00:00Z" },
  ];

  it("cuenta recibidos, trabajados, cerrados y sin tocar por dueña", () => {
    expect(resumirRecibidos(leads, gestiones)).toEqual({
      5: { recibidos: 3, trabajados: 2, cerrados: 1, sinTocar: 1 },
      34: { recibidos: 1, trabajados: 0, cerrados: 0, sinTocar: 1 },
    });
  });

  it("sin leads, vacío", () => {
    expect(resumirRecibidos([], gestiones)).toEqual({});
  });
});
