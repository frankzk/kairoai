// Rutas de WYN en la base (tabla wyn_rutas, migración 20261119140000) y la
// ubicación de un pedido para cruzarla. Solo servidor.

import * as XLSX from "xlsx";
import { getDB } from "@/lib/db";
import { filtrosPedidoIcomfly } from "@/lib/zadarma-calls";
import { parseFrecuenciasWyn, type RutaWyn, type UbicacionCliente } from "@/lib/wyn-rutas";

export interface CargaRutasWyn {
  archivo: string | null;
  rutas: number;
  cargado_por: string | null;
  cargado_at: string | null;
}

export async function leerRutasWyn(): Promise<{ rutas: RutaWyn[]; carga: CargaRutasWyn | null }> {
  const db = getDB();
  const [r, c] = await Promise.all([
    db.from("wyn_rutas").select("region,hub,ruta,zonas,dias,nota").order("orden"),
    db.from("wyn_rutas_carga").select("archivo,rutas,cargado_por,cargado_at").eq("id", 1).maybeSingle(),
  ]);
  if (r.error) throw new Error(`No se pudieron leer las rutas de WYN: ${r.error.message}`);
  return {
    rutas: ((r.data ?? []) as RutaWyn[]).map((x) => ({ ...x, dias: (x.dias ?? []).map(Number) })),
    carga: (c.data as CargaRutasWyn | null) ?? null,
  };
}

/** Lee el Excel de WYN (hoja "Frecuencias por zona") y reemplaza las rutas. */
export async function cargarExcelWyn(archivo: ArrayBuffer, nombre: string, por: string): Promise<number> {
  const wb = XLSX.read(new Uint8Array(archivo), { type: "array" });
  const hoja =
    wb.SheetNames.find((n) => /frecuencias/i.test(n)) ??
    wb.SheetNames.find((n) => {
      const filas = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null, raw: false }) as unknown[][];
      try {
        return parseFrecuenciasWyn(filas).length > 0;
      } catch {
        return false;
      }
    });
  if (!hoja) throw new Error("El Excel no trae la hoja «Frecuencias por zona».");
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: null, raw: false }) as unknown[][];
  const rutas = parseFrecuenciasWyn(filas).map((r, i) => ({ orden: i + 1, ...r }));
  const { data, error } = await getDB().rpc("wyn_rutas_reemplazar", {
    p_rutas: rutas,
    p_archivo: nombre.slice(0, 200),
    p_por: por.slice(0, 200),
  });
  if (error) throw new Error(`No se pudieron guardar las rutas: ${error.message}`);
  return Number(data) || rutas.length;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Provincia, cantón, distrito y dirección del pedido (iComfly o Shopify). */
export async function ubicacionDePedido(storeId: number, orderName: string): Promise<UbicacionCliente | null> {
  const nombre = orderName.trim();
  const filtros = filtrosPedidoIcomfly(nombre);
  if (filtros) {
    const { data } = await getDB()
      .from("icomfly_order_payloads")
      .select(
        "provincia:payload->>shipping_department, provincia2:payload->>shipping_province, canton:payload->>shipping_city, distrito:payload->>shipping_district, direccion:payload->>shipping_address",
      )
      .eq("store_id", storeId)
      .or(filtros)
      .limit(1);
    const f = data?.[0] as Record<string, string | null> | undefined;
    if (f && (f.canton || f.direccion || f.distrito)) {
      return { provincia: texto(f.provincia) || texto(f.provincia2), canton: texto(f.canton), distrito: texto(f.distrito), direccion: texto(f.direccion) };
    }
  }
  const { data } = await getDB()
    .from("shopify_orders")
    .select("direccion:raw_order->shipping_address")
    .eq("store_id", storeId)
    .eq("name", nombre)
    .limit(1);
  const a = (data?.[0] as { direccion?: Record<string, unknown> | null } | undefined)?.direccion;
  if (!a) return null;
  return {
    provincia: texto(a.province),
    canton: texto(a.city),
    distrito: "",
    direccion: [texto(a.address1), texto(a.address2)].filter(Boolean).join(", "),
  };
}
