// El pedido que la asesora arma en Leads, como lo pide crear_pedido de iComfly
// (lib/icomfly-mcp.ts). Mismo formulario que el de Shopify (CreateOrderPanel).
//
// crear_pedido lleva UN producto. Con varios (3% de los pedidos de asesora en
// Costa Rica desde julio, ninguno en Honduras, medido el 24/10/2026) van en una
// sola linea: "1x A + 2x B" por el total, para que el monto a cobrar sea el
// correcto. El descuento va en el total.
//
// Puro: se prueba en tests/icomfly-pedido-lead.test.ts.

export interface ItemPedidoLead {
  /** Nombre que se muestra: producto + variante ("Shorts - Negro / L"). */
  title: string;
  /** Producto sin variante, para buscarlo en el catalogo de iComfly. */
  product_title?: string;
  variant_title?: string;
  price: number;
  quantity: number;
}

export interface EnvioPedidoLead {
  name?: string;
  province?: string;
  canton?: string;
  address?: string;
  reference?: string;
}

export interface PedidoLead {
  items: ItemPedidoLead[];
  envio: EnvioPedidoLead;
  nombreLead: string | null;
  telefono: string;
  pago: "cod" | "sinpe";
  descuento?: { value: number; type: "percentage" | "fixed_amount" };
  nota?: string;
}

/** Producto del catalogo de iComfly que corresponde a cada item (id y nombre de alla). */
export type ProductoIcomfly = { id: number; name: string };

export type CampoEnvio = "address" | "canton" | "province";

/** Lo que iComfly exige y falta (crear_pedido rechaza sin direccion, ciudad y departamento). */
export function faltanParaIcomfly(envio: EnvioPedidoLead): CampoEnvio[] {
  const falta: CampoEnvio[] = [];
  if (!envio.address?.trim()) falta.push("address");
  if (!envio.canton?.trim()) falta.push("canton");
  if (!envio.province?.trim()) falta.push("province");
  return falta;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export function totalPedidoLead(items: ItemPedidoLead[], descuento?: PedidoLead["descuento"]): number {
  const bruto = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  const d = Number(descuento?.value) || 0;
  if (d <= 0) return redondear(bruto);
  return redondear(descuento?.type === "fixed_amount" ? Math.max(0, bruto - d) : bruto * (1 - d / 100));
}

// iComfly escribe "Fat‑Burn" con guion no separable (U+2011) y "–" en los
// titulos; Shopify, con guion comun. Para comparar se igualan.
export function normalizarNombreProducto(nombre: string): string {
  return String(nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * La palabra con que se busca el producto en iComfly: la mas larga sin
 * simbolos. La busqueda de iComfly es literal: "Fat-Burn Shorts" no encuentra
 * "Fat‑Burn Shorts", pero "Moldeadora" si.
 */
export function palabraDeBusqueda(titulo: string): string {
  const palabras = String(titulo ?? "").split(/[^A-Za-z0-9]+/).filter((p) => p.length >= 3);
  return palabras.sort((a, b) => b.length - a.length)[0] ?? String(titulo ?? "").trim();
}

/** El producto de iComfly con el mismo nombre (normalizado). Ninguno si no hay uno igual. */
export function elegirProducto(candidatos: Array<{ id?: unknown; name?: unknown }>, titulo: string): ProductoIcomfly | null {
  const buscado = normalizarNombreProducto(titulo);
  for (const c of candidatos) {
    const id = Number(c.id);
    const nombre = String(c.name ?? "");
    if (Number.isFinite(id) && id > 0 && nombre && normalizarNombreProducto(nombre) === buscado) return { id, name: nombre };
  }
  return null;
}

function nombreItem(item: ItemPedidoLead, producto?: ProductoIcomfly | null): string {
  if (!producto) return item.title;
  const variante = String(item.variant_title ?? "").trim();
  return variante && variante !== "Default Title" ? `${producto.name} - ${variante}` : producto.name;
}

/** Los argumentos de crear_pedido. `productos[i]` es el de iComfly para items[i], si se encontro. */
export function argumentosCrearPedido(
  pedido: PedidoLead,
  productos: Array<ProductoIcomfly | null> = []
): Record<string, unknown> {
  const items = pedido.items.filter((it) => Number(it.quantity) > 0 && it.title);
  const total = totalPedidoLead(items, pedido.descuento);
  const pagoTexto = pedido.pago === "sinpe" ? "SINPE" : "Contraentrega";
  const d = Number(pedido.descuento?.value) || 0;
  const notas = [
    "Cerrado por la asesora desde el tablero de Leads (Kairo).",
    `Pago: ${pagoTexto}.`,
    d > 0 ? `Descuento: ${pedido.descuento?.type === "fixed_amount" ? d : `${d}%`}.` : "",
    pedido.nota?.trim() ? `Nota: ${pedido.nota.trim()}` : "",
  ].filter(Boolean);

  const producto =
    items.length === 1
      ? {
          producto_nombre: nombreItem(items[0], productos[0]),
          producto_precio: Number(items[0].price) || 0,
          cantidad: Number(items[0].quantity) || 1,
          ...(productos[0] ? { product_id: productos[0].id } : {}),
        }
      : {
          producto_nombre: items.map((it, i) => `${Number(it.quantity) || 1}x ${nombreItem(it, productos[i])}`).join(" + "),
          producto_precio: redondear(items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0)),
          cantidad: 1,
        };

  const envio = pedido.envio;
  return {
    nombre_cliente: envio.name?.trim() || pedido.nombreLead?.trim() || "Cliente",
    telefono: pedido.telefono,
    whatsapp: pedido.telefono,
    direccion: [envio.address?.trim(), envio.reference?.trim()].filter(Boolean).join(" - "),
    ciudad: envio.canton?.trim() ?? "",
    departamento: envio.province?.trim() ?? "",
    ...producto,
    total,
    // Con el valor que usa iComfly. Hoy crear_pedido no lo guarda (queda vacio
    // con "Contra Entrega" y con "Contraentrega", medido el 24/10/2026): el
    // pago va tambien en las notas.
    metodo_pago: pedido.pago === "sinpe" ? "Transferencia" : "Contra Entrega",
    notas: notas.join(" "),
  };
}
