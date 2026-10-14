// Leads que compraron con un telefono casi igual al del carrito.
//
// POR QUE ESTE TEST EXISTE: el cruce lead<->pedido unia solo por telefono
// exacto. Quien escribia mal un digito en el formulario y despues compraba con
// el numero bueno quedaba como "carrito abandonado" para siempre: la asesora lo
// llamaba y el bot le escribia a un numero que es de otra persona. El 14/10/2026
// habia 8 asi entre 279 carritos abiertos de los ultimos 30 dias.
//
// Y al reves: marcar a alguien como comprado lo saca del tablero. Un parecido
// casual (otro cliente con un numero vecino) no puede esconder un carrito real.
// Los casos de abajo son reales, con nombres y numeros cambiados.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clavesProducto,
  digitosDistintos,
  elegirPedidosParecidos,
  evaluarCandidato,
  mismoNombreCompleto,
  mismoProducto,
  nombreParecido,
  type CandidatoPedido,
} from "../lib/leads-pedido-parecido";

function cand(over: Partial<CandidatoPedido> = {}): CandidatoPedido {
  return {
    lead_id: 1,
    lead_phone: "50686063000",
    lead_name: "Víctor Hugo Leiva Leiva",
    lead_first_seen: "2026-10-14T12:00:00Z",
    lead_cart_at: "2026-10-14T12:05:00Z",
    lead_cart: "1x Turkesterone - Cápsulas de Ajuga Turkestanica con Tongkat Ali (120 Cápsulas)",
    order_name: "#MCRC25879",
    order_phone: "+50686043000",
    order_customer: "Victor Hugo Leiva Leiva",
    order_created: "2026-10-14T12:23:00Z",
    order_items: "Turkesterone - Cápsulas de Ajuga Turkestanica con Tongkat Ali para Resistencia (120 Cápsulas)",
    via: "telefono",
    ...over,
  };
}

describe("teléfono que difiere en un dígito", () => {
  it("cuenta las posiciones distintas en los últimos 8 dígitos, con o sin + y código de país", () => {
    expect(digitosDistintos("50686063000", "+50686043000")).toBe(1);
    expect(digitosDistintos("86063000", "+506 8606-3000")).toBe(0);
    expect(digitosDistintos("50683618188", "+50683628788")).toBe(2);
    expect(digitosDistintos("", "+50686043000")).toBe(-1);
  });

  it("une al cliente que corrigió un dígito y compró lo mismo", () => {
    const r = evaluarCandidato(cand());
    expect(r?.motivo).toMatch(/#MCRC25879/);
    expect(r?.motivo).toMatch(/8604-3000/);
    expect(r?.motivo).toMatch(/8606-3000/);
    expect(r?.motivo).toMatch(/mismo nombre y mismo producto/);
  });

  it("basta el mismo nombre aunque haya comprado otro producto", () => {
    const r = evaluarCandidato(
      cand({ lead_cart: "1x Sovexa Cayenne Pepper – Suplemento Botánico", order_items: "NAD+ Men's Complex – Energía (60 Cápsulas)" })
    );
    expect(r?.motivo).toMatch(/\(mismo nombre\)/);
  });

  it("basta el mismo producto aunque el nombre del pedido sea otro (lo pidió un familiar o puso un apodo)", () => {
    const r = evaluarCandidato(cand({ order_customer: "Mariela Mariela" }));
    expect(r?.motivo).toMatch(/\(mismo producto\)/);
  });

  it("NO une a un vecino de número con otro nombre y otro producto", () => {
    expect(
      evaluarCandidato(
        cand({ lead_name: "Karol Ramírez", order_customer: "Itay Itay", order_items: "Sovexa Cayenne Pepper – Suplemento" })
      )
    ).toBeNull();
  });

  it("NO une si el pedido es de mucho antes o mucho después: quien corrige el número lo hace enseguida", () => {
    const soloProducto = { order_customer: "Mariela Mariela" };
    expect(evaluarCandidato(cand({ ...soloProducto, order_created: "2026-10-30T12:00:00Z" }))).toBeNull();
    expect(evaluarCandidato(cand({ ...soloProducto, order_created: "2026-10-01T12:00:00Z" }))).toBeNull();
    expect(evaluarCandidato(cand({ ...soloProducto, order_created: "2026-10-16T12:00:00Z" }))).not.toBeNull();
  });

  it("NO une dos dígitos distintos con otro nombre: ya no es un error de tipeo, puede ser cualquiera", () => {
    // Caso real: carrito 8361-8188, pedido del mismo producto 8362-8788 a otro
    // nombre. Puede ser ella, pero eso lo confirma una persona, no el sistema.
    expect(evaluarCandidato(cand({ order_phone: "+50686143000", order_customer: "Mariela Mariela" }))).toBeNull();
  });
});

describe("otro teléfono, mismo nombre completo y mismo producto", () => {
  const otroNumero = {
    lead_phone: "50686242321",
    lead_name: "Carlos Eduardo Jiménez",
    lead_first_seen: "2026-09-20T15:00:00Z",
    lead_cart_at: "2026-09-21T01:00:00Z",
    lead_cart: "1x NAD+ Men's Complex – Energía, Rendimiento y Vitalidad Masculina (60 Cápsulas)",
    order_phone: "+50672174812",
    order_customer: "Carlos Eduardo Jiménez Flores",
    order_created: "2026-10-01T18:00:00Z",
    order_items: "NAD+ Men's Complex – Energía, Rendimiento y Vitalidad Masculina (60 Cápsulas)",
    via: "nombre",
  };

  it("une cuando el nombre tiene tres palabras o más y el producto coincide", () => {
    expect(evaluarCandidato(cand(otroNumero))?.motivo).toMatch(/mismo nombre completo y mismo producto/);
  });

  it("NO une con solo dos palabras: hay demasiados «Luis Díaz»", () => {
    expect(evaluarCandidato(cand({ ...otroNumero, lead_name: "Luis Díaz", order_customer: "Luís Díaz" }))).toBeNull();
  });

  it("NO une si compró otro producto", () => {
    expect(evaluarCandidato(cand({ ...otroNumero, order_items: "NAD + Resveratrol – Fórmula Avanzada" }))).toBeNull();
  });

  it("NO une si no sabemos qué tenía en el carrito", () => {
    expect(evaluarCandidato(cand({ ...otroNumero, lead_cart: null }))).toBeNull();
  });
});

describe("nombres y productos", () => {
  it("reconoce nombres de la misma persona escritos distinto", () => {
    expect(nombreParecido("JUSTO CHAVES Marchena", "Justo German Chaves March")).toBe(true);
    expect(nombreParecido("Noel Noel", "Noe Noe")).toBe(true);
    expect(nombreParecido("Alberto Salazar gutierrez", "albertosalazar@g.meil.con")).toBe(true);
    expect(nombreParecido("Lilliana Salguero", "Álvaro Álvaro")).toBe(false);
    expect(nombreParecido(null, "Álvaro")).toBe(false);
  });

  it("nombre completo: el corto con 3+ palabras, todas en el largo", () => {
    expect(mismoNombreCompleto("Carlos Eduardo Jiménez", "Carlos Eduardo Jiménez Flores")).toBe(true);
    expect(mismoNombreCompleto("Carlos Carlos Carlos", "Carlos Carlos Carlos")).toBe(false);
    expect(mismoNombreCompleto("Ana María Rojas", "Ana Rojas Mora")).toBe(false);
  });

  it("toma el nombre del producto antes del guion, sin cantidades ni tildes", () => {
    expect(clavesProducto("1x Fat‑Burn Shorts - Shorts para Quemar Grasa – Faja")).toEqual([["fat", "burn", "shorts"]]);
    expect(clavesProducto("3x Set de Pelador de Verduras + Abridor Premium (2 piezas)")).toEqual([["set", "pelador", "verduras"]]);
    expect(clavesProducto("1x HER LOSS – Colonia | 1x Óxido Nítrico")).toEqual([["her", "loss"], ["oxido", "nitrico"]]);
  });

  it("mismo producto aunque la tienda lo escriba distinto en cada país", () => {
    expect(mismoProducto("1x Autogrip - Soporte 360° de Auto", "AutoGrip 360™ – Soporte Inteligente de Auto para Celular")).toBe(true);
    expect(mismoProducto("1x NAD+ Men's Complex – Energía", "NAD + Resveratrol – Fórmula Avanzada")).toBe(false);
    expect(mismoProducto("", "Turkesterone")).toBe(false);
  });
});

describe("elegirPedidosParecidos", () => {
  it("un solo pedido por lead: el más confirmado y, a igual confianza, el más cercano", () => {
    const elegidos = elegirPedidosParecidos([
      cand({ order_name: "#A", order_customer: "Otra Persona", via: "telefono" }), // solo producto
      cand({ order_name: "#B", via: "telefono" }), // nombre y producto
      cand({ order_name: "#C", via: "telefono", order_created: "2026-10-16T12:00:00Z" }), // igual, mas lejos
      cand({ lead_id: 2, order_name: "#D", lead_name: "Karol Ramírez", order_customer: "Itay Itay", order_items: "Otra cosa" }),
    ]);
    expect(elegidos).toEqual([{ leadId: 1, orderName: "#B", motivo: expect.stringMatching(/#B/) }]);
  });
});

// ─── La pasada en la base ────────────────────────────────────────────────────

const llamadas: Array<{ tabla: string; op: string; args: unknown[] }> = [];
let candidatos: CandidatoPedido[] = [];
let filasActualizadas: Array<{ id: number }> = [{ id: 1 }];

vi.mock("../lib/db", () => ({
  getDB: () => {
    let tabla = "";
    const q: Record<string, unknown> = {};
    const anotar = (op: string) => (...args: unknown[]) => {
      llamadas.push({ tabla, op, args });
      return q;
    };
    Object.assign(q, {
      from: (t: string) => {
        tabla = t;
        return q;
      },
      update: anotar("update"),
      insert: anotar("insert"),
      eq: anotar("eq"),
      not: anotar("not"),
      // update(...).select() devuelve las filas tocadas; insert(...).select().single() la nueva.
      select: () =>
        Object.assign(Promise.resolve({ data: filasActualizadas, error: null }), {
          single: () => Promise.resolve({ data: { id: 99 }, error: null }),
        }),
      rpc: (nombre: string, args: unknown) => {
        llamadas.push({ tabla: "rpc", op: nombre, args: [args] });
        return Promise.resolve({ data: candidatos, error: null });
      },
    });
    return q;
  },
}));

describe("matchLeadsToNearbyOrders", () => {
  beforeEach(() => {
    llamadas.length = 0;
    candidatos = [cand()];
    filasActualizadas = [{ id: 1 }];
  });

  it("marca el lead como comprado con el pedido y deja el motivo en el historial", async () => {
    const { matchLeadsToNearbyOrders } = await import("../lib/leads");
    expect(await matchLeadsToNearbyOrders(7)).toBe(1);

    const update = llamadas.find((l) => l.tabla === "leads" && l.op === "update");
    expect(update?.args[0]).toMatchObject({ has_order: true, status: "pedido_generado", shopify_order_name: "#MCRC25879" });

    // Nunca pisa a quien ya tiene pedido ni un estado protegido (lista negra...).
    const filtros = llamadas.filter((l) => l.tabla === "leads" && (l.op === "eq" || l.op === "not")).map((l) => l.args);
    expect(filtros).toContainEqual(["has_order", false]);
    expect(filtros).toContainEqual(["status", "in", "(lista_negra,cancelado_cliente,cancelado)"]);

    const historial = llamadas.find((l) => l.tabla === "lead_calls" && l.op === "insert");
    expect(historial?.args[0]).toMatchObject({ lead_id: 1, kind: "system", note: expect.stringMatching(/difiere en un dígito/) });
  });

  it("si otro proceso ya lo marcó, no repite la gestión en el historial", async () => {
    filasActualizadas = [];
    const { matchLeadsToNearbyOrders } = await import("../lib/leads");
    expect(await matchLeadsToNearbyOrders(7)).toBe(0);
    expect(llamadas.some((l) => l.tabla === "lead_calls")).toBe(false);
  });
});
