import { describe, expect, it } from "vitest";
import { claveMotivo, escalaresPresentes } from "@/lib/shiphero-devoluciones";

describe("prueba de devoluciones en ShipHero", () => {
  it("pide solo los campos escalares que el tipo declara", () => {
    const campos = [{ name: "id", escalar: true }, { name: "status", escalar: true }, { name: "order", escalar: false }];
    expect(escalaresPresentes(campos, ["id", "order", "status", "reason"])).toEqual(["id", "status"]);
  });
  it("agrupa motivos sin números", () => {
    expect(claveMotivo("Return #1234 received")).toBe(claveMotivo("Return #99 received"));
    expect(claveMotivo(null)).toBe("(sin motivo)");
  });
});
