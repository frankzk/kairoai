// Fase 0 de las tiendas nuevas (Kenku Mexico primero): cada tienda trae su
// pais, moneda y zona horaria, y lo que depende del pais sale de ahi.
//
// POR QUE ESTE TEST EXISTE: Kairo decidia "si es Honduras esto, si no Costa
// Rica". Una tienda de otro pais habria tomado las provincias de Costa Rica
// (y "Crear en iComfly" mandaba departamento "San José"), el simbolo de colon,
// el telefono de Costa Rica (todos sus clientes "sin telefono", cero leads) y
// cruzado sus liquidaciones contra los pedidos de Costa Rica. Y Costa Rica y
// Honduras tienen que seguir exactamente igual.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINANCE_STORES,
  getCurrencySymbol,
  getFinanceStore,
  getStoreRegions,
  regionesDePais,
  simboloDeMoneda,
} from "../lib/store-config";
import { CR_PHONE, HN_PHONE, MX_PHONE, normalizePhone, phoneConfigForStore } from "../lib/phone-cr";
import { tzDeTienda } from "../lib/confirmacion";
import { credencialMcp } from "../lib/icomfly-mcp";
import { CORTE_PEDIDOS_ICOMFLY, corteIcomflyDe } from "../lib/icomfly-pedidos";
import type { FinanceStoreCode } from "../lib/store-config";

const eqs: string[] = [];
vi.mock("@/lib/db", () => {
  const cadena: unknown = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
        return (...args: unknown[]) => {
          if (prop === "eq") eqs.push(`${String(args[0])}=${String(args[1])}`);
          return cadena;
        };
      },
    }
  );
  return { getDB: () => cadena };
});

beforeEach(() => {
  eqs.length = 0;
});

describe("Costa Rica y Honduras siguen igual", () => {
  it("provincias, departamentos, símbolo, zona horaria y teléfono", () => {
    expect(getStoreRegions("mireva-cr")).toMatchObject({ label: "Provincia", subLabel: "Cantón" });
    expect(getStoreRegions("mireva-cr").options).toHaveLength(7);
    expect(getStoreRegions("mireva-hn")).toMatchObject({ label: "Departamento", subLabel: "Municipio" });
    expect(getStoreRegions("mireva-hn").options).toHaveLength(18);
    expect(getCurrencySymbol("mireva-cr")).toBe("₡");
    expect(getCurrencySymbol("mireva-hn")).toBe("L");
    expect(tzDeTienda("mireva-cr")).toBe("America/Costa_Rica");
    expect(tzDeTienda("mireva-hn")).toBe("America/Tegucigalpa");
    expect(phoneConfigForStore("mireva-cr")).toBe(CR_PHONE);
    expect(phoneConfigForStore("mireva-hn")).toBe(HN_PHONE);
    expect(normalizePhone("8888 7777", CR_PHONE)).toBe("50688887777");
    expect(normalizePhone("+504 9999-8888", HN_PHONE)).toBe("50499998888");
    // Una tienda desconocida sigue cayendo en Costa Rica, como antes.
    expect(phoneConfigForStore("otra")).toBe(CR_PHONE);
    expect(corteIcomflyDe(1)).toBe(CORTE_PEDIDOS_ICOMFLY);
  });

  it("cada tienda trae una zona horaria IANA válida", () => {
    for (const store of FINANCE_STORES) {
      expect(() => new Intl.DateTimeFormat("es", { timeZone: store.timezone })).not.toThrow();
      expect(tzDeTienda(store.code)).toBe(store.timezone);
    }
  });
});

describe("México está listo para Kenku México", () => {
  it("los 32 estados", () => {
    const mx = regionesDePais("MX");
    expect(mx).toMatchObject({ label: "Estado", subLabel: "Municipio" });
    expect(mx.options).toHaveLength(32);
    expect(mx.options).toContain("Ciudad de México");
    expect(mx.options).toContain("Nuevo León");
    expect(new Set(mx.options).size).toBe(32);
  });

  it("el peso mexicano y las monedas que vienen, por su código", () => {
    expect(simboloDeMoneda("MXN")).toBe("$");
    expect(simboloDeMoneda("EUR")).toBe("€");
    expect(simboloDeMoneda("hnl")).toBe("L");
    expect(simboloDeMoneda("XYZ")).toBe("XYZ ");
    expect(simboloDeMoneda(null)).toBe("");
  });

  it("teléfonos de 10 dígitos, con o sin 52, y el 521 de WhatsApp es el mismo cliente", () => {
    const esperado = "525512345678";
    for (const crudo of ["55 1234 5678", "5512345678", "+52 55 1234 5678", "525512345678", "+52 1 55 1234 5678", "5215512345678", "0052 55 1234 5678"]) {
      expect(normalizePhone(crudo, MX_PHONE)).toBe(esperado);
    }
    // Monterrey: el 81 no se corta a 8 digitos.
    expect(normalizePhone("81 2345 6789", MX_PHONE)).toBe("528123456789");
    // Un numero de Costa Rica sin codigo en una tienda de Mexico no se inventa.
    expect(normalizePhone("88887777", MX_PHONE)).toBeNull();
    // Con su codigo, si: es un cliente de otro pais.
    expect(normalizePhone("+506 8888 7777", MX_PHONE)).toBe("50688887777");
  });

  it("un cliente mexicano en una tienda de Costa Rica se acepta con su código", () => {
    expect(normalizePhone("+52 55 1234 5678", CR_PHONE)).toBe("525512345678");
    // Y un movil de Costa Rica que empieza en 52 sigue siendo de Costa Rica.
    expect(normalizePhone("5212 3456", CR_PHONE)).toBe("50652123456");
  });
});

describe("lo que se cruzaba con Costa Rica", () => {
  it("las liquidaciones se cruzan con los pedidos de SU tienda; una desconocida no cae en Costa Rica", async () => {
    const { loadShopifyOrdersForMatching } = await import("../lib/finance-matching");
    await loadShopifyOrdersForMatching(null, 2, { includeFreshShopify: false, fallbackToShopify: false });
    expect(eqs).toContain("store_id=2");
    eqs.length = 0;
    await expect(loadShopifyOrdersForMatching(null, 99, { fallbackToShopify: false })).rejects.toThrow("tienda 99 desconocida");
    expect(eqs).not.toContain("store_id=1");
  });

  it("el conector de iComfly de una tienda sin mapa dice qué falta, sin romper", () => {
    const r = credencialMcp("kenku-mx" as FinanceStoreCode, {});
    expect(r.url).toBeUndefined();
    expect(r.faltan).toEqual(["ICOMFLY_KENKU_MX_MCP_URL", "ICOMFLY_KENKU_MX_MCP_TOKEN"]);
    expect(credencialMcp("mireva-hn", {}).faltan).toEqual(["ICOMFLY_HN_MCP_URL", "ICOMFLY_HN_MCP_TOKEN"]);
  });
});

it("getFinanceStore de una tienda desconocida sigue siendo Costa Rica (compatibilidad)", () => {
  expect(getFinanceStore("nada").code).toBe("mireva-cr");
});
