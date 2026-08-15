import { describe, expect, it } from "vitest";
import { phoneFromNoteAttributes, phoneFromNote } from "../lib/finance-orders";

describe("phoneFromNote (celular en la nota de texto del pedido)", () => {
  it("rescata el celular de una nota real de venta por bot", () => {
    // Nota real del pedido #MCRC19178 (canal icomfly). El campo estandar viene
    // vacio y no hay note_attributes; el numero solo esta en la nota.
    expect(phoneFromNote("Pedido #8927 - Venta por bot - WhatsApp +83297165150")).toBe("83297165");
  });

  it("tolera prefijo 506 y separadores", () => {
    expect(phoneFromNote("Cliente: +506 8423-5361")).toBe("84235361");
    expect(phoneFromNote("wsp 506 7016 2233")).toBe("70162233");
    expect(phoneFromNote("llamar al 88887777")).toBe("88887777");
  });

  it("no confunde el numero de pedido ni direcciones", () => {
    // "#8927" (4 digitos) y "150 mts" (3 digitos) no tienen forma de celular CR.
    expect(phoneFromNote("Pedido #8927 - 150 mts al sur de la iglesia")).toBeNull();
  });

  it("devuelve null cuando no hay celular", () => {
    expect(phoneFromNote("")).toBeNull();
    expect(phoneFromNote(null)).toBeNull();
    expect(phoneFromNote("entregar en la tarde")).toBeNull();
  });
});

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
