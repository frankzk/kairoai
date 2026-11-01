// Que premarca la ficha al colgar una llamada de Telnyx.
//
// POR QUE ESTE TEST EXISTE: "No contestó" no puede premarcarse al primer
// timbre: si la asesora corta enseguida, el cliente no tuvo tiempo de contestar
// y darlo por no contestado no es justo (lo pidio operaciones el 01/11/2026).
// Tiene que sonar unos 3 timbres, o que el cliente rechace la llamada.

import { describe, expect, it } from "vitest";
import { SEGUNDOS_TIMBRE_NO_CONTESTO, sugerenciaDeLlamada } from "../lib/telefonia-cliente";

describe("premarcar Contestó / No contestó", () => {
  it("si contesto, Contestó (aunque haya sonado poco)", () => {
    expect(sugerenciaDeLlamada({ contestada: true, segundosTimbre: 2 })).toBe("contesto");
  });

  it("al primer o segundo timbre no premarca nada", () => {
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 0 })).toBeNull();
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 11, causa: "ORIGINATOR_CANCEL" })).toBeNull();
  });

  it("despues de ~3 timbres sin contestar, No contestó", () => {
    expect(SEGUNDOS_TIMBRE_NO_CONTESTO).toBe(15);
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 15, causa: "ORIGINATOR_CANCEL" })).toBe("no_contesto");
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 40, causa: "NO_ANSWER" })).toBe("no_contesto");
  });

  it("si el cliente rechaza u ocupa, No contestó aunque haya sonado poco", () => {
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 3, causa: "USER_BUSY" })).toBe("no_contesto");
    expect(sugerenciaDeLlamada({ contestada: false, segundosTimbre: 1, causa: "call_rejected" })).toBe("no_contesto");
  });
});
