import { describe, expect, it } from "vitest";
import { causaParaSugerencia, credencialesDeWebphone, destinoSip, esFalloDelProveedor, mensajeDeCausa } from "@/lib/zadarma-webrtc";

describe("teléfono propio de Zadarma", () => {
  it("arma las credenciales SIP de la extensión", () => {
    expect(credencialesDeWebphone("499499-101", { pass: "s3cr3t", domain: "pbx.zadarma.com" })).toEqual({
      uri: "sip:499499-101@pbx.zadarma.com",
      authUser: "499499-101",
      password: "s3cr3t",
      wsUrl: "wss://pbx.zadarma.com:4443",
      domain: "pbx.zadarma.com",
    });
  });

  it("explica cuando Zadarma no entrega los datos", () => {
    expect(() => credencialesDeWebphone("499499-101", { error: { content: "key expired" } })).toThrow("Zadarma: key expired");
    expect(() => credencialesDeWebphone("499499-101", { pass: "x", domain: "evil.com/x" })).toThrow();
    expect(() => credencialesDeWebphone("499499-101", null)).toThrow("Zadarma no entregó");
  });

  it("marca el número internacional sin signos", () => {
    expect(destinoSip("+504 9988-7766", "pbx.zadarma.com")).toBe("sip:50499887766@pbx.zadarma.com");
  });

  it("solo culpa al proveedor si la llamada no llegó a sonar y no es causa del cliente", () => {
    expect(esFalloDelProveedor("Connection Error", false)).toBe(true);
    expect(esFalloDelProveedor("SIP Failure Code", false)).toBe(true);
    expect(esFalloDelProveedor("Rejected", false)).toBe(true);
    expect(esFalloDelProveedor("Rejected", true)).toBe(false);
    expect(esFalloDelProveedor("Busy", false)).toBe(false);
    expect(esFalloDelProveedor("Canceled", false)).toBe(false);
    expect(esFalloDelProveedor("User Denied Media Access", false)).toBe(false);
    expect(esFalloDelProveedor(null, false)).toBe(false);
  });

  it("traduce causas para premarcar y para la asesora", () => {
    expect(causaParaSugerencia("Busy")).toBe("USER_BUSY");
    expect(causaParaSugerencia("Rejected")).toBe("CALL_REJECTED");
    expect(mensajeDeCausa("Busy")).toBe("El cliente está ocupado.");
    expect(mensajeDeCausa("Algo raro")).toBe("No se pudo completar la llamada (Algo raro).");
  });
});

import { tiendaPorNumero } from "@/lib/zadarma-calls";

describe("tienda de una llamada sin lead", () => {
  it("sale del país del número", () => {
    expect(tiendaPorNumero("50688887777")).toBe(1);
    expect(tiendaPorNumero("50499887766")).toBe(2);
    expect(tiendaPorNumero("88887777")).toBeNull();
    expect(tiendaPorNumero("15551234567")).toBeNull();
  });
});
