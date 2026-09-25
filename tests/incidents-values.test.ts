import { describe, expect, it } from "vitest";
import { INCIDENT_CATEGORIES, INCIDENT_SOURCES, INCIDENT_STATUSES } from "../lib/incidents-types";

// Regresion: /api/incidents tenia sus propias listas escritas a mano. Al sumar
// reprog_fallida (reconciliacion) y demora_entrega (envios que se quedan en el
// camino) esas listas quedaron atras y la API los rechazaba con 400.
describe("valores validos de novedades", () => {
  it("incluyen el estado y la causa que se sumaron despues", () => {
    expect(INCIDENT_STATUSES).toContain("reprog_fallida");
    expect(INCIDENT_CATEGORIES).toContain("demora_entrega");
  });

  // Fijados contra los CHECK de la tabla incidents (migraciones 0016, 0018 y
  // 0019). Si este test falla porque se agrego un valor al tipo, falta la
  // migracion que lo agregue al CHECK: sin ella el insert revienta en produccion.
  it("coinciden con los CHECK de la base", () => {
    expect([...INCIDENT_STATUSES].sort()).toEqual([
      "descartada", "no_llamar", "pendiente", "perdida", "reprog_fallida", "reprogramada", "resuelta", "sin_contestar",
    ]);
    expect([...INCIDENT_CATEGORIES].sort()).toEqual([
      "cliente_no_responde", "cliente_rechaza", "dano_paquete", "demora_entrega",
      "devuelto_origen", "direccion_incorrecta", "fallo_entrega", "otro",
    ]);
    expect([...INCIDENT_SOURCES].sort()).toEqual(["boxful", "forza", "manual", "moovin"]);
  });
});
