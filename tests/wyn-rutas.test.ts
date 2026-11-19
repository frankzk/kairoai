import { describe, expect, it } from "vitest";
import { aliasDeZona, esDiaDeRuta, nombresDias, parseFrecuenciasWyn, proximasEntregas, rutaDeUbicacion, type RutaWyn } from "@/lib/wyn-rutas";

const FILAS = [
  [null],
  ["Frecuencias de visita por zona"],
  ["Región", "Hub", "Ruta / Zonas", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Visitas / semana", "Días de distribución", "Nota"],
  ["Guanacaste", "Liberia", "Hojancha / Nicoya / Sámara", "●", "●", "●", "●", "●", "●", "6", "Diario", null],
  ["Guanacaste", "Liberia", "Nosara / Ostional / Guiones", "●", null, null, "●", null, null, "2", "Lunes/Jueves", null],
  ["Guanacaste", "Liberia", "La Cruz", null, null, null, "●", null, null, "1", "Jueves", "Nuevo horario"],
  ["Guanacaste", "Liberia", "Santa Cruz centro / Chirco / Laguinilla / Diriá", "●", "●", "●", "●", "●", "●", "6", "Diario", null],
  ["Guanacaste", "Liberia", "Liberia / Salto / Pijije / Cañas Dulces", "●", "●", "●", "●", "●", "●", "6", "Diario", null],
  ["Guanacaste", "Liberia", "Bagaces / Cañas / Abangares", "●", "●", "●", "●", "●", "●", "6", "Diario", null],
  ["Caribe", "Guápiles", "Guápiles-Pococí / Cariari / Limón / Caribe Sur-Talamanca", "●", "●", "●", "●", "●", "●", "6", "Diario", null],
  ["Guanacaste", "Liberia", "Nandayure (resto del cantón) *", null, null, "●", null, null, "●", "2", "Miércoles/Sábado", null],
  [null, null, "Total visitas-ruta por día", 16, 15, 16, 16, 16, 13, 92],
];

describe("rutas de WYN", () => {
  const rutas = parseFrecuenciasWyn(FILAS);

  it("lee la hoja Frecuencias por zona", () => {
    expect(rutas).toHaveLength(8);
    expect(rutas[1]).toMatchObject({ region: "Guanacaste", hub: "Liberia", zonas: ["Nosara", "Ostional", "Guiones"], dias: [1, 4] });
    expect(rutas[2].nota).toBe("Nuevo horario");
    expect(() => parseFrecuenciasWyn([["nada"]])).toThrow("Frecuencias por zona");
  });

  it("reconoce nombres compuestos", () => {
    expect(aliasDeZona("Guápiles-Pococí")).toEqual(expect.arrayContaining(["guapiles pococi", "guapiles", "pococi"]));
    expect(aliasDeZona("Nandayure (resto del cantón) *")).toEqual(["nandayure"]);
    expect(aliasDeZona("Santa Cruz centro")).toContain("santa cruz");
  });

  it("encuentra la zona: distrito antes que cantón", () => {
    const z = (u: Parameters<typeof rutaDeUbicacion>[1]) => rutaDeUbicacion(rutas, u)?.zona ?? null;
    expect(z({ canton: "Nicoya", distrito: "Nosara" })).toBe("Nosara");
    expect(z({ canton: "Nicoya" })).toBe("Nicoya");
    expect(z({ canton: "Pococí", distrito: "Guápiles" })).toBe("Guápiles-Pococí");
    expect(z({ canton: "Liberia", distrito: "Cañas Dulces" })).toBe("Cañas Dulces");
    expect(z({ canton: "Santa Cruz", distrito: "Santa Cruz" })).toBe("Santa Cruz centro");
    expect(z({ canton: "San José", distrito: "Pavas" })).toBeNull();
    // "La Cruz" solo por cantón o distrito, no por "Cruz Roja" en la dirección.
    expect(z({ canton: "Heredia", direccion: "frente a la Cruz Roja" })).toBeNull();
    expect(z({ canton: "La Cruz" })).toBe("La Cruz");
    expect(z({ canton: "Guanacaste", direccion: "Barrio X, Ostional, casa azul" })).toBe("Ostional");
  });

  it("calcula la próxima entrega con corte a las 12 m. y un día al hub", () => {
    const nosara = [1, 4];
    // Martes 17/11/2026 10:00 CR: sale el martes, hub miércoles → jueves 19; si no, lunes 23.
    expect(proximasEntregas(nosara, new Date("2026-11-17T16:00:00Z"))).toEqual({ despacho: "2026-11-17", entrega: "2026-11-19", siguiente: "2026-11-23" });
    // Martes 14:00 CR: sale el miércoles, hub jueves → jueves.
    expect(proximasEntregas(nosara, new Date("2026-11-17T20:00:00Z")).entrega).toBe("2026-11-19");
    // Viernes 13:00: sale sábado, hub lunes (domingo no) → lunes.
    expect(proximasEntregas([1, 2, 3, 4, 5, 6], new Date("2026-11-20T19:00:00Z"))).toMatchObject({ despacho: "2026-11-21", entrega: "2026-11-23" });
    // Diario, miércoles 9:00: sale miércoles, hub jueves.
    expect(proximasEntregas([1, 2, 3, 4, 5, 6], new Date("2026-11-18T15:00:00Z"))).toMatchObject({ entrega: "2026-11-19", siguiente: "2026-11-20" });
  });

  it("nombra los días y valida una fecha", () => {
    expect(nombresDias([1, 4])).toBe("lunes y jueves");
    expect(nombresDias([2, 4, 6])).toBe("martes, jueves y sábado");
    expect(nombresDias([1, 2, 3, 4, 5, 6])).toBe("lunes a sábado");
    expect(esDiaDeRuta([4] as RutaWyn["dias"], "2026-11-19")).toBe(true);
    expect(esDiaDeRuta([4], "2026-11-20")).toBe(false);
  });
});
