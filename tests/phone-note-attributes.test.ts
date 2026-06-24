import { describe, expect, it } from "vitest";
import { phoneFromNoteAttributes } from "../lib/finance-orders";

describe("phoneFromNoteAttributes", () => {
  it("toma el campo nombrado como telefono (8+ digitos)", () => {
    expect(phoneFromNoteAttributes([{ name: "Telefono", value: "8888-7777" }])).toBe("8888-7777");
    expect(phoneFromNoteAttributes([{ name: "Numero de WhatsApp", value: "+506 8888 7777" }])).toBe("+506 8888 7777");
    expect(phoneFromNoteAttributes([{ name: "Contacto", value: "70001234" }])).toBe("70001234");
  });

  it("rescata por FORMA de telefono CR aunque el campo no se llame telefono", () => {
    expect(phoneFromNoteAttributes([{ name: "Numero", value: "87654321" }])).toBe("87654321");
    expect(phoneFromNoteAttributes([{ name: "Dato extra", value: "50688887777" }])).toBe("50688887777");
  });

  it("ignora cedula (9 digitos) y otros numeros que no son telefono", () => {
    expect(phoneFromNoteAttributes([{ name: "Cedula", value: "1-1234-5678" }])).toBeNull(); // 9 digitos
    expect(phoneFromNoteAttributes([{ name: "Codigo postal", value: "10101" }])).toBeNull();
  });

  it("prefiere el campo nombrado sobre el de pura forma", () => {
    expect(
      phoneFromNoteAttributes([
        { name: "Cedula", value: "61234567" }, // forma de telefono pero es cedula mal puesta
        { name: "Celular", value: "89998888" },
      ])
    ).toBe("89998888");
  });

  it("devuelve null sin datos utiles", () => {
    expect(phoneFromNoteAttributes(undefined)).toBeNull();
    expect(phoneFromNoteAttributes([])).toBeNull();
    expect(phoneFromNoteAttributes([{ name: "Nota", value: "entregar en la tarde" }])).toBeNull();
  });
});
