import { describe, expect, it } from "vitest";
import { sanitizeExternalError } from "@/lib/api-errors";

describe("sanitizeExternalError", () => {
  it("convierte la página de Cloudflare 521 (aunque venga recortada) en un mensaje claro", () => {
    const fragment =
      'ass="cf-icon-ok w-12 h-12"></span> </div> <span class="md:block w-full truncate">Ashburn</span> <h3 class="md:inline-block">Cloudflare</h3> <a href="https://www.cloudflare.com/5xx-error-landing?utm_source=errorcode_521">';
    expect(sanitizeExternalError(fragment, "x")).toMatch(/base de datos no respondió/);
    expect(sanitizeExternalError("<!DOCTYPE html><html><body>Error 522 Connection timed out</body></html>", "x")).toMatch(/base de datos no respondió/);
  });

  it("deja pasar mensajes normales", () => {
    expect(sanitizeExternalError("Agrega al menos un producto al pedido.", "x")).toBe("Agrega al menos un producto al pedido.");
    expect(sanitizeExternalError("", "fallback")).toBe("fallback");
  });
});
