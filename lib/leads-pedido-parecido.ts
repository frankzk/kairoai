// Leads que ya compraron con un telefono CASI igual al del carrito.
//
// El cruce exacto (RPC match_leads_to_shopify_orders) no ve a quien escribio
// mal un digito en el formulario y despues compro con el numero bueno: el
// carrito queda abierto, la asesora lo llama y el bot le escribe a un numero
// que es de otra persona. La base propone candidatos (RPC
// leads_order_candidates_near, migracion 0046) y aca se decide cuales son de
// verdad la misma persona. Puro: se prueba en tests/leads-pedido-parecido.test.ts.
//
// Reglas (conservadoras: marcar a alguien como comprado lo saca del tablero):
//
//   A. Telefono que difiere en UN digito + (nombre parecido o mismo producto)
//      + pedido entre 3 dias antes y 7 despues del carrito. Quien corrige el
//      numero lo hace enseguida.
//   B. Otro telefono, pero el mismo nombre COMPLETO (3 palabras o mas) + el
//      mismo producto + pedido entre 3 dias antes y 30 despues. Con dos
//      palabras ("Luis Soto") hay demasiados homonimos.

export interface CandidatoPedido {
  lead_id: number;
  lead_phone: string | null;
  lead_name: string | null;
  lead_first_seen: string | null;
  lead_cart_at: string | null;
  lead_cart: string | null;
  order_name: string;
  order_phone: string | null;
  order_customer: string | null;
  order_created: string;
  order_items: string | null;
  via: string;
}

export interface PedidoParecido {
  leadId: number;
  orderName: string;
  motivo: string;
}

const DIA_MS = 86_400_000;
const ANTES_DIAS = 3;
const DESPUES_TELEFONO_DIAS = 7;
const DESPUES_NOMBRE_DIAS = 30;

/** Minuscula, sin tildes, solo letras y numeros separados por un espacio. */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ultimos 8 digitos: el numero nacional en Costa Rica y Honduras. */
export function ultimos8(telefono: string | null | undefined): string {
  return String(telefono ?? "").replace(/\D/g, "").slice(-8);
}

/** En cuantas posiciones difieren dos telefonos de 8 digitos (-1 si no aplica). */
export function digitosDistintos(a: string | null | undefined, b: string | null | undefined): number {
  const x = ultimos8(a);
  const y = ultimos8(b);
  if (x.length !== 8 || y.length !== 8) return -1;
  let n = 0;
  for (let i = 0; i < 8; i++) if (x[i] !== y[i]) n++;
  return n;
}

function palabras(nombre: string | null | undefined): string[] {
  return Array.from(new Set(normalizar(nombre).split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w))));
}

/**
 * Nombres que pueden ser de la misma persona: comparten una palabra, una es el
 * comienzo de otra ("Noe" / "Noel"), o una palabra larga de uno aparece pegada
 * en el otro (alguien que escribio "albertosalazar@..." como nombre).
 */
export function nombreParecido(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = palabras(a);
  const pb = palabras(b);
  if (!pa.length || !pb.length) return false;
  const juntoA = pa.join("");
  const juntoB = pb.join("");
  for (const x of pa) {
    for (const y of pb) {
      if (x === y) return true;
      if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
    }
    if (x.length >= 6 && juntoB.includes(x)) return true;
  }
  return pb.some((y) => y.length >= 6 && juntoA.includes(y));
}

/** Mismo nombre completo: el mas corto tiene 3+ palabras y todas estan en el otro. */
export function mismoNombreCompleto(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = palabras(a);
  const pb = palabras(b);
  const [corto, largo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  if (corto.length < 3) return false;
  const set = new Set(largo);
  return corto.every((w) => set.has(w));
}

/**
 * Las primeras 3 palabras del nombre de cada producto del carrito ("1x
 * Fat‑Burn Shorts - Shorts para..." -> "fat burn shorts"). El carrito puede
 * tener varios productos separados por " | ".
 */
export function clavesProducto(carrito: string | null | undefined): string[][] {
  return String(carrito ?? "")
    .split("|")
    .map((item) => item.replace(/^\s*\d+\s*x\s*/i, ""))
    .map((item) => item.split(/\s[–—-]\s|\(/)[0])
    .map((cabeza) => normalizar(cabeza).split(" ").filter((w) => w.length >= 3).slice(0, 3))
    .filter((ws) => ws.length > 0);
}

/** Alguno de los productos del carrito esta en el pedido. */
export function mismoProducto(carrito: string | null | undefined, itemsPedido: string | null | undefined): boolean {
  const items = new Set(normalizar(itemsPedido).split(" "));
  if (!items.size) return false;
  return clavesProducto(carrito).some((ws) => ws.every((w) => items.has(w)));
}

function dentroDeVentana(c: CandidatoPedido, despuesDias: number): boolean {
  const pedido = Date.parse(c.order_created);
  if (!Number.isFinite(pedido)) return false;
  const referencias = [c.lead_first_seen, c.lead_cart_at]
    .map((t) => Date.parse(t ?? ""))
    .filter((t) => Number.isFinite(t));
  return referencias.some((ref) => pedido >= ref - ANTES_DIAS * DIA_MS && pedido <= ref + despuesDias * DIA_MS);
}

function formatoTelefono(telefono: string | null | undefined): string {
  const t = ultimos8(telefono);
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : String(telefono ?? "");
}

/** Decide un candidato. Devuelve el motivo (para el historial) o null. */
export function evaluarCandidato(c: CandidatoPedido): { motivo: string; puntaje: number } | null {
  const producto = mismoProducto(c.lead_cart, c.order_items);
  const dif = digitosDistintos(c.lead_phone, c.order_phone);

  if (dif === 1 && dentroDeVentana(c, DESPUES_TELEFONO_DIAS)) {
    const nombre = nombreParecido(c.lead_name, c.order_customer);
    if (nombre || producto) {
      const confirma = [nombre && "mismo nombre", producto && "mismo producto"].filter(Boolean).join(" y ");
      return {
        motivo: `Compró con otro teléfono: pedido ${c.order_name} con ${formatoTelefono(c.order_phone)}, que difiere en un dígito de ${formatoTelefono(c.lead_phone)} (${confirma})`,
        puntaje: 2 + (nombre ? 1 : 0) + (producto ? 1 : 0),
      };
    }
  }

  if (dif !== 0 && producto && mismoNombreCompleto(c.lead_name, c.order_customer) && dentroDeVentana(c, DESPUES_NOMBRE_DIAS)) {
    return {
      motivo: `Compró con otro teléfono: pedido ${c.order_name} a nombre de ${c.order_customer} con ${formatoTelefono(c.order_phone)} (mismo nombre completo y mismo producto)`,
      puntaje: 1,
    };
  }

  return null;
}

/** Un pedido por lead: el mejor confirmado y, a igual confianza, el mas cercano al carrito. */
export function elegirPedidosParecidos(candidatos: CandidatoPedido[]): PedidoParecido[] {
  const mejor = new Map<number, { c: CandidatoPedido; motivo: string; puntaje: number; distancia: number }>();
  for (const c of candidatos) {
    const r = evaluarCandidato(c);
    if (!r) continue;
    const ref = Date.parse(c.lead_cart_at ?? c.lead_first_seen ?? "") || 0;
    const distancia = Math.abs(Date.parse(c.order_created) - ref);
    const actual = mejor.get(c.lead_id);
    if (!actual || r.puntaje > actual.puntaje || (r.puntaje === actual.puntaje && distancia < actual.distancia)) {
      mejor.set(c.lead_id, { c, motivo: r.motivo, puntaje: r.puntaje, distancia });
    }
  }
  return Array.from(mejor.values()).map(({ c, motivo }) => ({ leadId: c.lead_id, orderName: c.order_name, motivo }));
}
