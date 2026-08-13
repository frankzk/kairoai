import { describe, expect, it } from "vitest";
import {
  labelDispatchMatches,
  parseDispatchQuery,
  phoneLikePatterns,
  sanitizeSearchText,
  MIN_QUERY_LENGTH,
} from "../lib/dispatch-search";
import { CR_PHONE, HN_PHONE } from "../lib/phone-cr";
import type { IcomflyOrderRecord } from "../lib/finance-types";

const row = (
  over: Partial<Pick<IcomflyOrderRecord, "order_number" | "shopify_display_number" | "tracking_number">> = {}
) => ({
  order_number: "",
  shopify_display_number: "",
  tracking_number: "",
  ...over,
});

describe("sanitizeSearchText", () => {
  it("normaliza a mayusculas y conserva '#' y '-'", () => {
    expect(sanitizeSearchText(" mlcr000032445sd ")).toBe("MLCR000032445SD");
    expect(sanitizeSearchText("#43659")).toBe("#43659");
    expect(sanitizeSearchText("SHOP-MSQGSHSC-CBZL")).toBe("SHOP-MSQGSHSC-CBZL");
  });

  it("descarta los separadores de PostgREST para que no rompan el filtro", () => {
    expect(sanitizeSearchText("a,b)c(d")).toBe("ABCD");
    expect(sanitizeSearchText("*%\\")).toBe("");
  });
});

describe("parseDispatchQuery", () => {
  it("rechaza consultas demasiado cortas", () => {
    expect(parseDispatchQuery("ab", CR_PHONE)).toBeNull();
    expect(parseDispatchQuery("", CR_PHONE)).toBeNull();
    expect(parseDispatchQuery(null, CR_PHONE)).toBeNull();
    expect("ab".length).toBeLessThan(MIN_QUERY_LENGTH);
  });

  it("rechaza consultas que quedan vacias despues de sanear", () => {
    expect(parseDispatchQuery("...", CR_PHONE)).toBeNull();
  });

  it("lee una guia como texto, sin telefono", () => {
    const terms = parseDispatchQuery("MLCR000032445SD", CR_PHONE);
    expect(terms?.text).toBe("MLCR000032445SD");
    expect(terms?.phone).toBeNull();
    expect(terms?.national).toBeNull();
  });

  it("reconoce un celular completo y lo normaliza", () => {
    const terms = parseDispatchQuery("+506 7104-1241", CR_PHONE);
    expect(terms?.phone).toBe("50671041241");
    expect(terms?.national).toBe("71041241");
  });

  it("reconoce el celular sin codigo de pais", () => {
    expect(parseDispatchQuery("71041241", CR_PHONE)?.national).toBe("71041241");
  });

  it("usa el pais de la tienda", () => {
    expect(parseDispatchQuery("95443406", HN_PHONE)?.phone).toBe("50495443406");
    // El mismo numero no es un movil valido en CR (empieza en 9).
    expect(parseDispatchQuery("95443406", CR_PHONE)?.phone).toBeNull();
  });

  it("no confunde una guia numerica con un telefono", () => {
    // 7 digitos: no alcanza para ser un movil de 8.
    const terms = parseDispatchQuery("2557341", CR_PHONE);
    expect(terms?.text).toBe("2557341");
    expect(terms?.national).toBeNull();
  });
});

describe("phoneLikePatterns", () => {
  it("cubre los formatos con los que Shopify guarda el telefono", () => {
    expect(phoneLikePatterns("71041241")).toEqual([
      "%71041241%",
      "%7104-1241%",
      "%7104 1241%",
    ]);
  });
});

describe("labelDispatchMatches", () => {
  const terms = (raw: string, cfg = CR_PHONE) => {
    const parsed = parseDispatchQuery(raw, cfg);
    if (!parsed) throw new Error(`consulta invalida en el test: ${raw}`);
    return parsed;
  };

  it("marca 'pedido' cuando coincide el numero visible", () => {
    expect(
      labelDispatchMatches(row({ shopify_display_number: "#MCRC13403" }), "", "", terms("13403"))
    ).toEqual(["pedido"]);
  });

  it("marca 'guia' con la guia de iComfly", () => {
    expect(
      labelDispatchMatches(row({ tracking_number: "MLCR000032445SD" }), "", "", terms("32445"))
    ).toEqual(["guia"]);
  });

  it("marca 'guia' cuando la guia solo vino de Shopify", () => {
    expect(labelDispatchMatches(row(), "", "2557341", terms("2557341"))).toEqual(["guia"]);
  });

  it("marca 'telefono' comparando solo digitos, sin importar el formato", () => {
    const t = terms("71041241");
    expect(labelDispatchMatches(row(), "+50671041241", "", t)).toEqual(["telefono"]);
    expect(labelDispatchMatches(row(), "+506 7104-1241", "", t)).toEqual(["telefono"]);
    expect(labelDispatchMatches(row(), "50671041241", "", t)).toEqual(["telefono"]);
  });

  it("no marca telefono si el numero es de otro cliente", () => {
    expect(labelDispatchMatches(row(), "+50688889999", "", terms("71041241"))).toEqual([]);
  });

  it("puede marcar varios campos a la vez", () => {
    expect(
      labelDispatchMatches(
        row({ order_number: "2557341", tracking_number: "2557341" }),
        "",
        "",
        terms("2557341")
      )
    ).toEqual(["pedido", "guia"]);
  });
});
