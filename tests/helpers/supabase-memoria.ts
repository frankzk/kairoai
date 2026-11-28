// Un Supabase de mentira, en memoria, que SI aplica los filtros (eq, gte, lt,
// not is/in, in, order, range, limit) y la proyeccion de columnas. Sirve para
// probar que dos consultas con "el mismo filtro" devuelven lo mismo, y para
// ver que una consulta solo lee las columnas que pide.

type Fila = Record<string, unknown>;
type Op = [string, ...unknown[]];

function comparar(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return a.localeCompare(b);
  }
  return Number(a) - Number(b);
}

export interface ConsultaRegistrada {
  tabla: string;
  ops: Op[];
}

export function supabaseEnMemoria(tablas: Record<string, Fila[]>) {
  const consultas: ConsultaRegistrada[] = [];
  const from = (tabla: string) => {
    const ops: Op[] = [];
    consultas.push({ tabla, ops });
    const filtros: Array<(f: Fila) => boolean> = [];
    const orden: Array<[string, boolean]> = [];
    let columnas: string[] | null = null;
    let rango: [number, number] | null = null;
    let limite: number | null = null;
    const q = {
      select(c: string) {
        ops.push(["select", c]);
        columnas = c === "*" ? null : c.split(",").map((x) => x.trim());
        return q;
      },
      eq(c: string, v: unknown) {
        ops.push(["eq", c, v]);
        filtros.push((f) => f[c] === v);
        return q;
      },
      gte(c: string, v: string) {
        ops.push(["gte", c, v]);
        filtros.push((f) => f[c] != null && comparar(f[c], v) >= 0);
        return q;
      },
      lt(c: string, v: string) {
        ops.push(["lt", c, v]);
        filtros.push((f) => f[c] != null && comparar(f[c], v) < 0);
        return q;
      },
      not(c: string, op: string, v: unknown) {
        ops.push(["not", c, op, v]);
        if (op === "is" && v === null) filtros.push((f) => f[c] != null);
        else if (op === "in") {
          const vals = String(v).replace(/[()]/g, "").split(",");
          filtros.push((f) => !vals.includes(String(f[c])));
        } else throw new Error(`not(${op}) sin soporte`);
        return q;
      },
      in(c: string, vals: unknown[]) {
        ops.push(["in", c, vals]);
        filtros.push((f) => vals.includes(f[c]));
        return q;
      },
      order(c: string, o?: { ascending?: boolean }) {
        ops.push(["order", c, o]);
        orden.push([c, o?.ascending !== false]);
        return q;
      },
      range(a: number, b: number) {
        ops.push(["range", a, b]);
        rango = [a, b];
        return q;
      },
      limit(n: number) {
        ops.push(["limit", n]);
        limite = n;
        return q;
      },
      then<T>(ok: (r: { data: Fila[]; error: null }) => T, ko?: (e: unknown) => T) {
        try {
          let filas = (tablas[tabla] ?? []).filter((f) => filtros.every((fn) => fn(f)));
          if (orden.length) {
            filas = [...filas].sort((x, y) => {
              for (const [c, asc] of orden) {
                const d = comparar(x[c], y[c]);
                if (d) return asc ? d : -d;
              }
              return 0;
            });
          }
          if (rango) filas = filas.slice(rango[0], rango[1] + 1);
          if (limite != null) filas = filas.slice(0, limite);
          const cols = columnas;
          const data = cols ? filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c]]))) : filas.map((f) => ({ ...f }));
          return Promise.resolve(ok({ data, error: null }));
        } catch (e) {
          return ko ? Promise.resolve(ko(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  };
  return {
    consultas,
    db: {
      from,
      rpc: async () => ({ data: [], error: null }),
    },
  };
}
