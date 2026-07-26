import { describe, expect, it } from "vitest";

import { renderQuickReply } from "../lib/quick-replies-format";

describe("renderQuickReply", () => {
  it("reemplaza {nombre} con el PRIMER nombre del cliente", () => {
    expect(renderQuickReply("Hola {nombre}, gracias!", { nombre: "Maria Fernanda Rojas" })).toBe(
      "Hola Maria, gracias!"
    );
  });

  it("reemplaza {tienda}", () => {
    expect(renderQuickReply("Somos {tienda}.", { tienda: "Costa Rica" })).toBe("Somos Costa Rica.");
  });

  it("sin nombre no deja puntuacion ni espacios colgando", () => {
    expect(renderQuickReply("Hola {nombre}, ¿como estas?", { nombre: null })).toBe(
      "Hola, ¿como estas?"
    );
    expect(renderQuickReply("Hola {nombre}!", { nombre: "   " })).toBe("Hola!");
  });

  it("es case-insensitive con las variables", () => {
    expect(renderQuickReply("Hola {NOMBRE} de {Tienda}", { nombre: "Ana", tienda: "CR" })).toBe(
      "Hola Ana de CR"
    );
  });

  it("respeta los saltos de linea del mensaje", () => {
    expect(renderQuickReply("Hola {nombre}\nGracias", { nombre: "Ana" })).toBe("Hola Ana\nGracias");
  });

  it("deja intacto un mensaje sin variables", () => {
    const body = "Envio gratis a todo el pais, pago contra entrega.";
    expect(renderQuickReply(body, { nombre: "Ana", tienda: "CR" })).toBe(body);
  });
});
