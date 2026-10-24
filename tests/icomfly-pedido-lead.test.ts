// El pedido de la asesora, como lo pide crear_pedido de iComfly.
//
// POR QUE ESTE TEST EXISTE: lo que se arma aca es lo que cobra el courier. Si
// el total no lleva el descuento, o un pedido de dos productos sale con uno
// solo, se cobra mal. Y el pago tiene que ir en las notas: crear_pedido no
// guarda el metodo de pago (medido el 24/10/2026).

import { describe, expect, it } from "vitest";
import {
  argumentosCrearPedido,
  elegirProducto,
  faltanParaIcomfly,
  normalizarNombreProducto,
  palabraDeBusqueda,
  type PedidoLead,
} from "../lib/icomfly-pedido-lead";

const ENVIO = { name: "Marvin Guzmán", province: "Cortés", canton: "San Pedro Sula", address: "Col. Trejo", reference: "Casa azul" };

function pedido(over: Partial<PedidoLead> = {}): PedidoLead {
  return {
    items: [{ title: "Auto Wash Water Gun", product_title: "Auto Wash Water Gun", price: 890, quantity: 1 }],
    envio: ENVIO,
    nombreLead: "Marvin",
    telefono: "50498629003",
    pago: "cod",
    ...over,
  };
}

describe("lo que se manda a iComfly", () => {
  it("un producto: cliente, envío, producto, total y pago contra entrega", () => {
    expect(argumentosCrearPedido(pedido(), [{ id: 3833, name: "Auto Wash Water Gun" }])).toEqual({
      nombre_cliente: "Marvin Guzmán",
      telefono: "50498629003",
      whatsapp: "50498629003",
      direccion: "Col. Trejo - Casa azul",
      ciudad: "San Pedro Sula",
      departamento: "Cortés",
      producto_nombre: "Auto Wash Water Gun",
      producto_precio: 890,
      cantidad: 1,
      product_id: 3833,
      total: 890,
      metodo_pago: "Contra Entrega",
      notas: "Cerrado por la asesora desde el tablero de Leads (Kairo). Pago: Contraentrega.",
    });
  });

  it("con el nombre del catálogo de iComfly y la variante, para que despachen la talla correcta", () => {
    const args = argumentosCrearPedido(
      pedido({
        items: [{ title: "Fat-Burn Shorts - Negro / L", product_title: "Fat-Burn Shorts", variant_title: "Negro / L", price: 1110, quantity: 2 }],
      }),
      [{ id: 3456, name: "Fat‑Burn Shorts" }]
    );
    expect(args).toMatchObject({ producto_nombre: "Fat‑Burn Shorts - Negro / L", product_id: 3456, cantidad: 2, total: 2220 });
  });

  it("sin producto en el catálogo va con el nombre de Kairo y sin product_id", () => {
    const args = argumentosCrearPedido(pedido({ items: [{ title: "Producto nuevo", price: 500, quantity: 1 }] }), [null]);
    expect(args.producto_nombre).toBe("Producto nuevo");
    expect(args).not.toHaveProperty("product_id");
  });

  it("varios productos van en una línea por el total (crear_pedido lleva uno)", () => {
    const args = argumentosCrearPedido(
      pedido({
        items: [
          { title: "Auto Wash Water Gun", price: 890, quantity: 2 },
          { title: "Lymphatic Drainage", price: 890, quantity: 1 },
        ],
      })
    );
    expect(args).toMatchObject({
      producto_nombre: "2x Auto Wash Water Gun + 1x Lymphatic Drainage",
      producto_precio: 2670,
      cantidad: 1,
      total: 2670,
    });
  });

  it("el descuento va en el total, y en la nota", () => {
    const porcentaje = argumentosCrearPedido(pedido({ descuento: { value: 10, type: "percentage" } }));
    expect(porcentaje).toMatchObject({ producto_precio: 890, total: 801 });
    expect(porcentaje.notas).toContain("Descuento: 10%.");
    expect(argumentosCrearPedido(pedido({ descuento: { value: 100, type: "fixed_amount" } })).total).toBe(790);
  });

  it("SINPE va como transferencia; la nota de la asesora se agrega", () => {
    const args = argumentosCrearPedido(pedido({ pago: "sinpe", nota: "Llamar antes" }));
    expect(args.metodo_pago).toBe("Transferencia");
    expect(args.notas).toBe("Cerrado por la asesora desde el tablero de Leads (Kairo). Pago: SINPE. Nota: Llamar antes");
  });

  it("sin nombre de envío usa el del lead", () => {
    expect(argumentosCrearPedido(pedido({ envio: { ...ENVIO, name: "" } })).nombre_cliente).toBe("Marvin");
  });
});

describe("lo que iComfly exige", () => {
  it("dirección, ciudad y departamento", () => {
    expect(faltanParaIcomfly(ENVIO)).toEqual([]);
    expect(faltanParaIcomfly({ name: "x" })).toEqual(["address", "canton", "province"]);
    expect(faltanParaIcomfly({ ...ENVIO, canton: " " })).toEqual(["canton"]);
  });
});

describe("el producto en el catálogo de iComfly", () => {
  it("iComfly escribe guiones distintos: se igualan", () => {
    expect(normalizarNombreProducto("Fat‑Burn Shorts – Faja")).toBe(normalizarNombreProducto("Fat-Burn  Shorts - Faja"));
  });

  it("se busca por la palabra más larga sin símbolos (la búsqueda de iComfly es literal)", () => {
    expect(palabraDeBusqueda("Fat-Burn Shorts - Shorts para Quemar Grasa – Faja Moldeadora")).toBe("Moldeadora");
    expect(palabraDeBusqueda("Auto Wash Water Gun")).toBe("Water");
  });

  it("solo vale el del mismo nombre", () => {
    const candidatos = [
      { id: "3456", name: "Fat‑Burn Shorts - Shorts para Quemar Grasa" },
      { id: "3457", name: "Fat‑Burn Shorts - Shorts para Quemar Grasa (talla extra)" },
    ];
    expect(elegirProducto(candidatos, "Fat-Burn Shorts - Shorts para Quemar Grasa")).toEqual({
      id: 3456,
      name: "Fat‑Burn Shorts - Shorts para Quemar Grasa",
    });
    expect(elegirProducto(candidatos, "Otro producto")).toBeNull();
  });
});
