import { describe, expect, it } from "vitest";
import { esperaTrasError, mensajeBloqueo } from "@/lib/zadarma-webrtc-db";

describe("llave WebRTC compartida", () => {
  it("espera más cuanto más grave es el rechazo de Zadarma", () => {
    expect(esperaTrasError("You exceeded the rate limit by IP")).toBe(180_000);
    expect(esperaTrasError("Not authorized")).toBe(300_000);
    expect(esperaTrasError("timeout")).toBe(30_000);
  });

  it("explica el bloqueo con los minutos que faltan", () => {
    const ahora = new Date("2026-11-19T12:00:00Z");
    expect(mensajeBloqueo("You exceeded the rate limit by IP", new Date("2026-11-19T12:02:30Z"), ahora)).toBe(
      "Zadarma frenó las consultas de Kairo por un rato. Se vuelve a intentar solo en 3 min.",
    );
    expect(mensajeBloqueo("Not authorized", new Date("2026-11-19T12:05:00Z"), ahora)).toContain("no autorizó esta extensión");
  });
});
