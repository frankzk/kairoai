import { describe, expect, it } from "vitest";
import { configPorDefecto, validarConfigTelefonia } from "@/lib/telefonia";

describe("telefonía por tienda", () => {
  it("sin ajuste usa TELEFONIA y no tiene respaldo", () => {
    expect(configPorDefecto({ TELEFONIA: "telnyx" })).toEqual({ principal: "telnyx", respaldo: null });
    expect(configPorDefecto({ TELEFONIA: " Telnyx " })).toEqual({ principal: "telnyx", respaldo: null });
    expect(configPorDefecto({})).toEqual({ principal: "zadarma", respaldo: null });
  });

  it("acepta principal con el otro de respaldo, o sin respaldo", () => {
    expect(validarConfigTelefonia({ principal: "zadarma", respaldo: "telnyx" })).toEqual({ principal: "zadarma", respaldo: "telnyx" });
    expect(validarConfigTelefonia({ principal: "telnyx", respaldo: null })).toEqual({ principal: "telnyx", respaldo: null });
    expect(validarConfigTelefonia({ principal: "telnyx", respaldo: "" })).toEqual({ principal: "telnyx", respaldo: null });
    expect(validarConfigTelefonia({ principal: "telnyx" })).toEqual({ principal: "telnyx", respaldo: null });
  });

  it("rechaza el mismo proveedor de respaldo y valores desconocidos", () => {
    expect(validarConfigTelefonia({ principal: "zadarma", respaldo: "zadarma" })).toBeNull();
    expect(validarConfigTelefonia({ principal: "twilio", respaldo: null })).toBeNull();
    expect(validarConfigTelefonia({ principal: "telnyx", respaldo: "twilio" })).toBeNull();
    expect(validarConfigTelefonia(null)).toBeNull();
  });
});
