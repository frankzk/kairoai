import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  maskPhone,
  CR_PHONE,
  HN_PHONE,
  EXPLICIT_COUNTRY_CODES,
} from "../lib/phone-cr";

describe("normalizePhone (Costa Rica)", () => {
  it("keeps a well-formed 506 number", () => {
    expect(normalizePhone("50661234567")).toBe("50661234567");
  });
  it("adds 506 to an 8-digit mobile starting in 5/6/7/8", () => {
    // El 5 es movil en Costa Rica desde que SUTEL abrio la serie: 40 pedidos
    // no cancelados con 5xxxxxxx, 38 entregados (04/10/2026). Antes se tiraba.
    expect(normalizePhone("51234567")).toBe("50651234567");
    expect(normalizePhone("61234567")).toBe("50661234567");
    expect(normalizePhone("71234567")).toBe("50671234567");
    expect(normalizePhone("81234567")).toBe("50681234567");
  });
  it("strips formatting and the 00 international prefix", () => {
    expect(normalizePhone("+506 6123-4567")).toBe("50661234567");
    expect(normalizePhone("0050661234567")).toBe("50661234567");
  });
  it("rejects 8-digit numbers with an invalid mobile prefix", () => {
    expect(normalizePhone("11234567")).toBeNull();
    expect(normalizePhone("21234567")).toBeNull();
    expect(normalizePhone("41234567")).toBeNull();
  });
  it("rejects garbage and empty input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("normalizePhone (Honduras)", () => {
  it("adds 504 to an 8-digit mobile", () => {
    expect(normalizePhone("91234567", HN_PHONE)).toBe("50491234567");
  });
  it("does not misclassify HN under the CR config", () => {
    // 9XXXXXXXX is invalid for CR (prefixes 5/6/7/8) but valid for HN.
    expect(normalizePhone("91234567", CR_PHONE)).toBeNull();
  });
});

// EL CASO REAL. Un cliente de Guanacaste con numero de Nicaragua (+505) hizo
// el pedido #MCRC24634 el 03/10/2026. La asesora lo busco en el tablero, salio
// "Sin resultados", y concluyo que el lead no existia. No existia: la ingesta
// lo habia descartado como "sin telefono" porque el numero no era 506. Y no
// era uno: 57 pedidos no cancelados con +505 en la tienda de Costa Rica, todos
// enviados a Costa Rica.
describe("normalizePhone: un codigo de pais explicito se respeta", () => {
  it("acepta Nicaragua (+505) en la tienda de Costa Rica, tal cual", () => {
    expect(normalizePhone("+505 81916739", CR_PHONE)).toBe("50581916739");
    expect(normalizePhone("50581916739", CR_PHONE)).toBe("50581916739");
    expect(normalizePhone("00505 8191-6739", CR_PHONE)).toBe("50581916739");
  });
  it("acepta Nicaragua tambien en la tienda de Honduras", () => {
    expect(normalizePhone("+505 81916739", HN_PHONE)).toBe("50581916739");
  });
  it("acepta Panama, Guatemala y El Salvador con su codigo", () => {
    expect(normalizePhone("+507 61234567", CR_PHONE)).toBe("50761234567");
    expect(normalizePhone("+502 41234567", CR_PHONE)).toBe("50241234567");
    expect(normalizePhone("+503 71234567", HN_PHONE)).toBe("50371234567");
  });
  it("un hondureño en la tienda de Costa Rica no se pierde, ni al reves", () => {
    expect(normalizePhone("+504 91234567", CR_PHONE)).toBe("50491234567");
    expect(normalizePhone("+506 61234567", HN_PHONE)).toBe("50661234567");
  });
  it("al pais de la tienda le sigue validando el prefijo movil", () => {
    // El codigo explicito NO salta la validacion propia: 506 + fijo sigue
    // siendo null, igual que antes.
    expect(normalizePhone("+506 21234567", CR_PHONE)).toBeNull();
  });
  it("NO acepta un codigo que no conoce: eso seria inventar un numero", () => {
    // Estos aparecen de verdad en los pedidos y son errores de tipeo.
    expect(normalizePhone("19712345678", CR_PHONE)).toBeNull();
    expect(normalizePhone("16012345678", CR_PHONE)).toBeNull();
    expect(normalizePhone("+1 (305) 123-4567", CR_PHONE)).toBeNull();
  });
  it("NO acepta un codigo conocido con la longitud equivocada", () => {
    expect(normalizePhone("505819167", CR_PHONE)).toBeNull(); // le faltan digitos
    expect(normalizePhone("505819167390", CR_PHONE)).toBeNull(); // le sobra uno
  });
  it("un nacional de 8 digitos SIEMPRE es del pais de la tienda: no se adivina", () => {
    // Un nicaragüense que escribe su numero sin +505 queda como 506xxxxxxxx.
    // Es ambiguo de verdad (Nicaragua tambien usa 8 digitos que empiezan en
    // 5, 7 y 8) y la unica regla sana es la tienda. Lo que NO se puede hacer
    // es adivinar Nicaragua: eso inventaria un numero.
    expect(normalizePhone("81916739", CR_PHONE)).toBe("50681916739");
    expect(normalizePhone("50512345", CR_PHONE)).toBe("50650512345");
  });
  it("la lista incluye a los dos paises propios", () => {
    // Si alguien quita 506 o 504 de aqui, un hondureño en la tienda de Costa
    // Rica vuelve a desaparecer.
    expect(EXPLICIT_COUNTRY_CODES[CR_PHONE.countryCode]).toBe(CR_PHONE.nationalLength);
    expect(EXPLICIT_COUNTRY_CODES[HN_PHONE.countryCode]).toBe(HN_PHONE.nationalLength);
  });
});

describe("maskPhone", () => {
  it("keeps country prefix and last 4, masks the middle", () => {
    expect(maskPhone("50661234567")).toBe("506####4567");
  });
});
