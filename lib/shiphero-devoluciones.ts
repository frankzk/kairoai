// Prueba de solo lectura: ¿Boxful registra en ShipHero los paquetes que le
// devuelve el courier? Antes de construir "Recibido en Boxful" en No
// entregados hay que ver qué guarda ShipHero:
//  1. si la API expone devoluciones (returns) y con qué campos,
//  2. si los pedidos devueltos de iComfly (boxful_shiphero_order_number)
//     tienen una devolución o un movimiento de inventario en ShipHero,
//  3. qué motivos aparecen en los movimientos de inventario recientes.
// Nada se escribe en ShipHero. La consulta se arma con lo que la propia API
// declara (introspección), así un campo que no exista no rompe la prueba.

import { graphql, ShipHeroError } from "./shiphero-client";
import { getValidAccessToken, readConnectionRow } from "./shiphero-connection";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const edges = (conn: unknown) => list(obj(obj(conn).data).edges).map((e) => obj(obj(e).node));

const INTROSPECCION = `query KairoProbeSchema {
  __schema { queryType { fields { name args { name } } } }
  ret: __type(name: "Return") { fields { name type { kind name ofType { kind name } } } }
  ord: __type(name: "Order") { fields { name type { kind name ofType { kind name } } } }
  inv: __type(name: "InventoryChange") { fields { name type { kind name ofType { kind name } } } }
}`;

interface Campo { name: string; escalar: boolean }

function camposDe(t: unknown): Campo[] {
  return list(obj(t).fields).map((f) => {
    const tipo = obj(obj(f).type);
    const base = tipo.kind === "NON_NULL" ? obj(tipo.ofType) : tipo;
    return { name: String(obj(f).name), escalar: base.kind === "SCALAR" || base.kind === "ENUM" };
  });
}

/** Solo los campos escalares pedidos que el tipo realmente tiene. */
export function escalaresPresentes(campos: Campo[], deseados: string[]): string[] {
  const presentes = new Set(campos.filter((c) => c.escalar).map((c) => c.name));
  return deseados.filter((d) => presentes.has(d));
}

/** Primeras palabras de un motivo, sin números: agrupa "Return #123 received" con "Return #456 received". */
export function claveMotivo(reason: unknown): string {
  return String(reason ?? "")
    .replace(/#?\d[\d-]*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ")
    .slice(0, 80) || "(sin motivo)";
}

export interface PruebaDevoluciones {
  ok: boolean;
  error?: string;
  esquema?: {
    queryReturns: string[] | null;
    queryOrders: string[] | null;
    queryInventoryChanges: string[] | null;
    returnFields: string[];
    orderTieneReturns: boolean;
    inventoryChangeFields: string[];
  };
  devoluciones?: { total: number; porEstado: Record<string, number>; muestra: Json[]; error?: string };
  pedidos?: Array<{ shiphero: string; guia: string; courier: string; devueltoEnIcomfly: string; encontrado: boolean; fulfillment?: string; devoluciones?: Json[]; error?: string }>;
  movimientos?: { total: number; motivos: Array<{ motivo: string; veces: number; cambio: number }>; error?: string };
}

export async function probarDevolucionesShipHero(
  storeId: number,
  muestraPedidos: Array<{ shiphero: string; guia: string; courier: string; devueltoEnIcomfly: string }>,
  opts: { desde: string; hasta: string; deadline: number }
): Promise<PruebaDevoluciones> {
  const row = await readConnectionRow(storeId);
  if (!row || row.state === "disconnected" || !row.refresh_token_enc) return { ok: false, error: "ShipHero no está conectado para esta tienda." };
  const deps = { deadline: opts.deadline };
  const { token } = await getValidAccessToken(row, { ...deps, env: process.env });
  const q = (query: string, variables: Record<string, unknown> = {}) => graphql(token, query, variables, deps).then((r) => obj(r.data));
  const motivo = (e: unknown) => (e instanceof ShipHeroError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e)).slice(0, 300);

  // 1. Qué expone la API. Si ShipHero no permite introspección, se prueba con
  // los nombres de su documentación pública.
  let schema: Json;
  let introspeccionError: string | undefined;
  try {
    schema = await q(INTROSPECCION);
  } catch (e) {
    introspeccionError = motivo(e);
    const f = (names: string[]) => ({ fields: names.map((name) => ({ name, type: { kind: "SCALAR" } })) });
    schema = {
      __schema: { queryType: { fields: [
        { name: "returns", args: [{ name: "date_from" }, { name: "date_to" }] },
        { name: "orders", args: [{ name: "order_number" }] },
        { name: "inventory_changes", args: [{ name: "date_from" }, { name: "date_to" }] },
      ] } },
      ret: f(["id", "order_id", "status", "reason", "created_at", "total_items_expected", "total_items_received", "total_items_restocked"]),
      ord: { fields: [...f(["id", "order_number", "fulfillment_status", "order_date"]).fields, { name: "returns", type: { kind: "LIST" } }] },
      inv: f(["sku", "change_in_on_hand", "reason", "created_at"]),
    };
  }
  const queryFields = list(obj(obj(schema.__schema).queryType).fields).map((f) => ({
    name: String(obj(f).name),
    args: list(obj(f).args).map((a) => String(obj(a).name)),
  }));
  const argsDe = (name: string) => queryFields.find((f) => f.name === name)?.args ?? null;
  const ret = camposDe(schema.ret);
  const ord = camposDe(schema.ord);
  const inv = camposDe(schema.inv);
  const out: PruebaDevoluciones = {
    ok: true,
    ...(introspeccionError ? { error: `Sin introspección: ${introspeccionError}` } : {}),
    esquema: {
      queryReturns: argsDe("returns"),
      queryOrders: argsDe("orders"),
      queryInventoryChanges: argsDe("inventory_changes"),
      returnFields: ret.map((c) => c.name),
      orderTieneReturns: ord.some((c) => c.name === "returns"),
      inventoryChangeFields: inv.map((c) => c.name),
    },
  };
  const retEscalares = escalaresPresentes(ret, ["id", "legacy_id", "order_id", "status", "reason", "created_at", "total_items_expected", "total_items_received", "total_items_restocked", "label_type"]);
  const retOrden = ret.some((c) => c.name === "order") ? " order { order_number }" : "";
  const retSel = `${retEscalares.join(" ")}${retOrden}` || "id";

  // 2. Devoluciones registradas en el periodo.
  const returnsArgs = out.esquema!.queryReturns;
  if (returnsArgs) {
    try {
      const filtros = returnsArgs.includes("date_from") ? "(date_from: $desde, date_to: $hasta)" : "";
      const defs = filtros ? "($desde: ISODateTime, $hasta: ISODateTime, $after: String)" : "($after: String)";
      const porEstado: Record<string, number> = {};
      const muestra: Json[] = [];
      let total = 0;
      let after: string | null = null;
      for (let page = 0; page < 5; page++) {
        const data = await q(`query KairoProbeReturns${defs} { returns${filtros} { data(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { ${retSel} } } } } }`, { desde: opts.desde, hasta: opts.hasta, after });
        const nodes = edges(data.returns);
        total += nodes.length;
        for (const n of nodes) {
          const k = String(n.status ?? "(sin estado)");
          porEstado[k] = (porEstado[k] ?? 0) + 1;
          if (muestra.length < 15) muestra.push(n);
        }
        const info = obj(obj(obj(data.returns).data).pageInfo);
        if (!info.hasNextPage) break;
        after = String(info.endCursor ?? "");
      }
      out.devoluciones = { total, porEstado, muestra };
    } catch (e) {
      out.devoluciones = { total: 0, porEstado: {}, muestra: [], error: motivo(e) };
    }
  }

  // 3. Pedidos que iComfly ya da por devueltos: ¿ShipHero los tiene como devolución?
  const ordersArgs = out.esquema!.queryOrders ?? [];
  if (ordersArgs.includes("order_number")) {
    const devolSel = out.esquema!.orderTieneReturns ? ` returns { ${retEscalares.filter((f) => f !== "order_id").join(" ") || "id"} }` : "";
    const ordSel = escalaresPresentes(ord, ["id", "order_number", "partner_order_id", "fulfillment_status", "order_date", "updated_at"]).join(" ");
    out.pedidos = [];
    for (const p of muestraPedidos) {
      try {
        const data = await q(`query KairoProbeOrder($n: String) { orders(order_number: $n) { data(first: 2) { edges { node { ${ordSel}${devolSel} } } } } }`, { n: p.shiphero });
        const node = edges(data.orders)[0];
        out.pedidos.push({
          ...p,
          encontrado: Boolean(node),
          ...(node ? { fulfillment: String(node.fulfillment_status ?? ""), devoluciones: list(node.returns).map(obj) } : {}),
        });
      } catch (e) {
        out.pedidos.push({ ...p, encontrado: false, error: motivo(e) });
      }
    }
  }

  // 4. Motivos de los movimientos de inventario recientes (¿aparece "return"/"devolución"?).
  const invArgs = out.esquema!.queryInventoryChanges;
  if (invArgs) {
    try {
      const filtros = invArgs.includes("date_from") ? "(date_from: $desde, date_to: $hasta)" : "";
      const defs = filtros ? "($desde: ISODateTime, $hasta: ISODateTime, $after: String)" : "($after: String)";
      const sel = escalaresPresentes(inv, ["sku", "change_in_on_hand", "reason", "created_at", "location_id"]).join(" ") || "reason";
      const motivos = new Map<string, { veces: number; cambio: number }>();
      let total = 0;
      let after: string | null = null;
      for (let page = 0; page < 5; page++) {
        const data = await q(`query KairoProbeInventory${defs} { inventory_changes${filtros} { data(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { ${sel} } } } } }`, { desde: opts.desde, hasta: opts.hasta, after });
        const nodes = edges(data.inventory_changes);
        total += nodes.length;
        for (const n of nodes) {
          const k = claveMotivo(n.reason);
          const m = motivos.get(k) ?? { veces: 0, cambio: 0 };
          m.veces += 1;
          m.cambio += Number(n.change_in_on_hand) || 0;
          motivos.set(k, m);
        }
        const info = obj(obj(obj(data.inventory_changes).data).pageInfo);
        if (!info.hasNextPage) break;
        after = String(info.endCursor ?? "");
      }
      out.movimientos = {
        total,
        motivos: Array.from(motivos.entries())
          .map(([m, v]) => ({ motivo: m, ...v }))
          .sort((a, b) => b.veces - a.veces)
          .slice(0, 25),
      };
    } catch (e) {
      out.movimientos = { total: 0, motivos: [], error: motivo(e) };
    }
  }
  return out;
}
