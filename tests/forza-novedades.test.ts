// Novedades de Honduras deducidas de los hitos de Forza. Forza no informa
// intentos fallidos ni devoluciones: solo 5 hitos, cada uno con la fecha de la
// ultima vez que el paquete paso por ahi.

import { describe, expect, it } from "vitest";
import { conIntentosFallidos, forzaHitos, intentoFallidoVisible, senalForza } from "../lib/forza-novedades";

const NOW = "2026-10-12T18:00:00.000Z";
const H = 3_600_000;
const hace = (horas: number) => new Date(Date.parse(NOW) - horas * H).toISOString();

type Hitos = { creado?: number; recibido?: number; instal?: number; ruta?: number; entregado?: number };

// Como los guarda la sincronizacion: un hito no alcanzado viene sin fecha.
function eventos(horasAtras: Hitos, bodega = "") {
  const fila = (title: string, h: number | undefined, description = "") => ({
    title,
    description,
    date: h === undefined ? null : hace(h),
  });
  return [
    fila("Entregado", horasAtras.entregado),
    fila("En Ruta", horasAtras.ruta),
    fila("En instalaciones", horasAtras.instal, bodega),
    fila("Recibido por Forza", horasAtras.recibido),
    fila("Creado", horasAtras.creado, "Mireva"),
  ];
}

const pedidoDe = (dias: number) => hace(dias * 24);

describe("forzaHitos", () => {
  it("lee la fecha de cada hito y la ciudad de la bodega, por titulo o por codigo", () => {
    const h = forzaHitos([
      { title: "EN_INSTALACIONES", description: "SAN PEDRO SULA", date: hace(10) },
      { title: "En Ruta", description: "", date: hace(30) },
      { title: "Entregado", description: "", date: null },
    ]);
    expect(h.instalaciones).toBe(Date.parse(hace(10)));
    expect(h.ruta).toBe(Date.parse(hace(30)));
    expect(h.entregado).toBeNull();
    expect(h.bodega).toBe("SAN PEDRO SULA");
  });
});

describe("senalForza", () => {
  describe("salio a ruta y volvio a una bodega", () => {
    it("mas de un dia de vuelta en la bodega es un intento fallido probable", () => {
      const s = senalForza(eventos({ creado: 120, recibido: 100, ruta: 50, instal: 40 }, "LA CEIBA"), pedidoDe(6), NOW)!;
      expect(s.category).toBe("fallo_entrega");
      expect(s.detail).toContain("volvio a la bodega de Forza en LA CEIBA");
      expect(s.failureAt).toBe(hace(40));
    });

    it("menos de un dia es el paso normal por una bodega intermedia", () => {
      // De los que volvieron y despues se entregaron, 2 de cada 3 salieron en menos de 12 h.
      expect(senalForza(eventos({ creado: 60, recibido: 50, ruta: 20, instal: 8 }), pedidoDe(3), NOW)).toBeNull();
    });
  });

  describe("en ruta", () => {
    it("mas de 24 horas en ruta sin entregarse es un intento fallido probable", () => {
      const s = senalForza(eventos({ creado: 120, recibido: 100, instal: 90, ruta: 30 }), pedidoDe(6), NOW)!;
      expect(s.category).toBe("fallo_entrega");
      expect(s.detail).toContain("En ruta desde el");
      expect(s.failureAt).toBe(hace(30));
    });

    it("el mismo dia va en tiempo: el 95% se entrega en menos de 18,4 horas", () => {
      expect(senalForza(eventos({ creado: 60, recibido: 50, instal: 40, ruta: 10 }), pedidoDe(3), NOW)).toBeNull();
    });
  });

  describe("antes de salir a ruta", () => {
    it("mas de 3 dias dentro de Forza sin salir a ruta es demora", () => {
      const s = senalForza(eventos({ creado: 120, recibido: 100, instal: 80 }, "TEGUCIGALPA"), pedidoDe(6), NOW)!;
      expect(s.category).toBe("demora_entrega");
      expect(s.detail).toContain("En Forza en TEGUCIGALPA");
      expect(s.failureAt).toBeNull();
    });

    it("una guia creada que Forza no recibe en 48 horas se revisa con bodega", () => {
      const s = senalForza(eventos({ creado: 50 }), pedidoDe(3), NOW)!;
      expect(s.category).toBe("demora_entrega");
      expect(s.detail).toContain("revisar con bodega");
    });

    it("dentro de los tiempos normales no hay novedad", () => {
      expect(senalForza(eventos({ creado: 30 }), pedidoDe(2), NOW)).toBeNull();
      expect(senalForza(eventos({ creado: 70, recibido: 60, instal: 40 }), pedidoDe(3), NOW)).toBeNull();
    });
  });

  it("un envio entregado no es novedad", () => {
    expect(senalForza(eventos({ creado: 300, recibido: 280, ruta: 200, instal: 150, entregado: 100 }), pedidoDe(13), NOW)).toBeNull();
  });

  it("un pedido de mas de 60 dias no genera novedades, aunque siga trabado", () => {
    // Habia 73 demoras de pedidos de enero a marzo con la guia en "Creado".
    expect(senalForza(eventos({ creado: 61 * 24 }), pedidoDe(61), NOW)).toBeNull();
    // Sin pedido en Shopify, cuenta desde que se creo la guia.
    expect(senalForza(eventos({ creado: 61 * 24 }), null, NOW)).toBeNull();
  });

  it("el detalle no cambia mientras el paquete no se mueve", () => {
    const e = eventos({ creado: 120, recibido: 100, ruta: 50, instal: 40 });
    const unRato = new Date(Date.parse(NOW) + 5 * H).toISOString();
    expect(senalForza(e, pedidoDe(6), unRato)!.detail).toBe(senalForza(e, pedidoDe(6), NOW)!.detail);
  });
});

describe("intentos fallidos de Forza", () => {
  // Forza solo guarda la ULTIMA fecha de cada hito: Kairo recuerda los intentos.
  const codigos = (evs: Array<{ code: string }>) => evs.filter((e) => e.code === "INTENTO_FALLIDO");
  const conCodigo = (evs: ReturnType<typeof eventos>) => evs.map((e) => ({ ...e, code: e.title.toUpperCase(), group: "in_progress", note: "", description: e.description ?? "" }));

  it("salir a ruta y volver a la bodega por mas de un dia es un intento fallido", () => {
    const evs = conIntentosFallidos(conCodigo(eventos({ creado: 120, recibido: 100, ruta: 50, instal: 40 }, "LA CEIBA")), [], NOW);
    const intentos = codigos(evs);
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toMatchObject({ group: "failed", date: hace(40), note: hace(50) });
  });

  it("un paso de menos de un dia por la bodega no cuenta", () => {
    expect(intentoFallidoVisible(eventos({ creado: 60, recibido: 50, ruta: 20, instal: 8 }), NOW)).toBeNull();
  });

  it("recuerda el primer intento cuando el paquete vuelve a salir, y suma el segundo", () => {
    // Lectura 1: volvio a la bodega despues de la primera salida.
    const lectura1 = conIntentosFallidos(conCodigo(eventos({ creado: 200, recibido: 180, ruta: 100, instal: 90 })), [], NOW);
    // Lectura 2: salio de nuevo a ruta (Forza ya no muestra la primera salida).
    const lectura2 = conIntentosFallidos(conCodigo(eventos({ creado: 200, recibido: 180, instal: 90, ruta: 40 })), lectura1, NOW);
    expect(codigos(lectura2)).toHaveLength(1);
    // Lectura 3: volvio otra vez a la bodega: segundo intento fallido.
    const lectura3 = conIntentosFallidos(conCodigo(eventos({ creado: 200, recibido: 180, ruta: 40, instal: 30 })), lectura2, NOW);
    expect(codigos(lectura3)).toHaveLength(2);
  });

  it("releer lo mismo no duplica el intento", () => {
    const e = conCodigo(eventos({ creado: 120, recibido: 100, ruta: 50, instal: 40 }));
    const una = conIntentosFallidos(e, [], NOW);
    expect(codigos(conIntentosFallidos(e, una, NOW))).toHaveLength(1);
  });

  it("si despues se entrega, el intento fallido queda en el historial", () => {
    const fallo = conIntentosFallidos(conCodigo(eventos({ creado: 200, recibido: 180, ruta: 100, instal: 90 })), [], NOW);
    const entregado = conIntentosFallidos(conCodigo(eventos({ creado: 200, recibido: 180, instal: 90, ruta: 30, entregado: 20 })), fallo, NOW);
    expect(codigos(entregado)).toHaveLength(1);
  });
});
