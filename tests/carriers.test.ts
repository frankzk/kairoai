import { describe, expect, it } from "vitest";
import {
  forzaGuideNumber,
  getStoreCarriers,
  isForzaCourier,
  isMoovinCourier,
  normalizeForzaGuide,
  resolveRowCarrier,
  rowMatchesCarrier,
} from "../lib/carriers";
import type { FinanceStorePublic } from "../lib/store-config";

const cr: FinanceStorePublic = {
  id: 1,
  code: "mireva-cr",
  label: "Mireva Costa Rica",
  shortLabel: "Costa Rica",
  countryCode: "CR",
  currency: "CRC",
  locale: "es-CR",
  logisticsProvider: "moovin",
};

const hn: FinanceStorePublic = {
  id: 2,
  code: "mireva-hn",
  label: "Mireva Honduras",
  shortLabel: "Honduras",
  countryCode: "HN",
  currency: "HNL",
  locale: "es-HN",
  logisticsProvider: "forza",
};

// Tienda hipotetica con dos transportadoras: ejercita la resolucion por fila.
const multi: FinanceStorePublic = { ...cr, carriers: ["moovin", "forza"] };

describe("normalizeForzaGuide (fix FD)", () => {
  it("antepone la serie FD a una guia numerica", () => {
    expect(normalizeForzaGuide("26827471")).toBe("FD26827471");
  });

  it("es idempotente sobre guias que ya tienen FD", () => {
    expect(normalizeForzaGuide("FD26827471")).toBe("FD26827471");
    expect(normalizeForzaGuide("fd26827471")).toBe("FD26827471");
  });

  it("tolera separadores y espacios (caso que antes fallaba)", () => {
    expect(normalizeForzaGuide("FD-26827471")).toBe("FD26827471");
    expect(normalizeForzaGuide("FD 26827471")).toBe("FD26827471");
    expect(normalizeForzaGuide("  fd_26827471 ")).toBe("FD26827471");
    expect(normalizeForzaGuide("268-271")).toBe("FD268271");
  });

  it("limpia el artefacto de coma flotante de Excel y acepta numeros", () => {
    expect(normalizeForzaGuide("26827471.0")).toBe("FD26827471");
    expect(normalizeForzaGuide(26827471)).toBe("FD26827471");
  });

  it("devuelve cadena vacia para valores vacios/nulos", () => {
    expect(normalizeForzaGuide("")).toBe("");
    expect(normalizeForzaGuide("   ")).toBe("");
    expect(normalizeForzaGuide(null)).toBe("");
    expect(normalizeForzaGuide(undefined)).toBe("");
  });

  it("forzaGuideNumber devuelve los digitos sin la serie FD", () => {
    expect(forzaGuideNumber("FD26827471")).toBe("26827471");
    expect(forzaGuideNumber("26827471")).toBe("26827471");
    expect(forzaGuideNumber("FD-268 471")).toBe("268471");
  });
});

describe("getStoreCarriers", () => {
  it("usa logisticsProvider cuando la tienda no declara carriers", () => {
    expect(getStoreCarriers(cr)).toEqual(["moovin"]);
    expect(getStoreCarriers(hn)).toEqual(["forza"]);
  });

  it("respeta la lista declarada en multi-transportadora", () => {
    expect(getStoreCarriers(multi)).toEqual(["moovin", "forza"]);
  });

  it("cae al provider primario si la lista declarada queda vacia", () => {
    expect(getStoreCarriers({ ...cr, carriers: [] })).toEqual(["moovin"]);
  });
});

describe("resolveRowCarrier (resolucion por fila)", () => {
  it("tienda mono-transportadora: siempre la transportadora de la tienda, ignora la etiqueta", () => {
    // Costa Rica = Moovin aunque la fila diga Forza / tenga guia FD.
    expect(resolveRowCarrier({ courier: "Forza", guide: "FD123", store: cr })).toBe("moovin");
    expect(resolveRowCarrier({ courier: "", guide: "", store: cr })).toBe("moovin");
    // Honduras = Forza aunque el fulfillment de Shopify diga "Moovin" (etiqueta vieja).
    expect(resolveRowCarrier({ courier: "Moovin", guide: "123", store: hn })).toBe("forza");
  });

  it("multi-transportadora: desambigua por etiqueta de courier primero", () => {
    expect(resolveRowCarrier({ courier: "Moovin", guide: "FD1", store: multi })).toBe("moovin");
    expect(resolveRowCarrier({ courier: "Forza Delivery", guide: "555", store: multi })).toBe("forza");
  });

  it("multi-transportadora: usa el prefijo de guia cuando no hay etiqueta util", () => {
    expect(resolveRowCarrier({ courier: "", guide: "FD999", store: multi })).toBe("forza");
    expect(resolveRowCarrier({ courier: "Correos", guide: "FD999", store: multi })).toBe("forza");
  });

  it("multi-transportadora: cae a la transportadora primaria si no hay senal", () => {
    expect(resolveRowCarrier({ courier: "", guide: "999", store: multi })).toBe("moovin");
  });
});

describe("rowMatchesCarrier (paridad mono-transportadora)", () => {
  it("Costa Rica delega exactamente en isMoovinCourier/isForzaCourier", () => {
    expect(rowMatchesCarrier("moovin", { displayCourier: "Moovin", store: cr })).toBe(true);
    expect(rowMatchesCarrier("forza", { displayCourier: "Moovin", store: cr })).toBe(false);
    // Courier vacio => sin match (mismo gate que el codigo historico).
    expect(rowMatchesCarrier("moovin", { displayCourier: "", store: cr })).toBe(false);
  });

  it("Honduras: Forza con cualquier courier no vacio, nunca Moovin", () => {
    expect(rowMatchesCarrier("forza", { displayCourier: "Forza", store: hn })).toBe(true);
    expect(rowMatchesCarrier("moovin", { displayCourier: "Forza", store: hn })).toBe(false);
    expect(rowMatchesCarrier("forza", { displayCourier: "", store: hn })).toBe(false);
  });

  it("multi-transportadora: enruta por fila usando rawCourier/guide", () => {
    expect(rowMatchesCarrier("forza", { rawCourier: "", guide: "FD1", store: multi })).toBe(true);
    expect(rowMatchesCarrier("moovin", { rawCourier: "Moovin", guide: "1", store: multi })).toBe(true);
    expect(rowMatchesCarrier("moovin", { rawCourier: "", guide: "FD1", store: multi })).toBe(false);
  });
});

describe("isMoovinCourier / isForzaCourier (comportamiento preservado)", () => {
  it("isMoovinCourier", () => {
    expect(isMoovinCourier("Moovin", cr)).toBe(true);
    expect(isMoovinCourier("", cr)).toBe(false);
    expect(isMoovinCourier(undefined, hn)).toBe(false); // tienda Forza: nunca Moovin
  });

  it("isForzaCourier", () => {
    expect(isForzaCourier("cualquier cosa", hn)).toBe(true); // tienda Forza: courier no vacio
    expect(isForzaCourier("", hn)).toBe(false);
    expect(isForzaCourier("Forza", cr)).toBe(true); // por substring
    expect(isForzaCourier("Moovin", cr)).toBe(false);
  });
});
