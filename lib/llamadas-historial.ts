// Las llamadas de un pedido (Gestion) o de una novedad (Novedades). Leads ya
// las muestra desde getLeadHistory (lib/leads.ts), por lead.
//
// Se buscan por TELEFONO: asi aparecen todas las llamadas a ese cliente, de
// Zadarma y de Telnyx, se hayan hecho desde Leads, Gestion o Novedades. Los
// prefijos de pais (506, 504, 52) separan las tiendas. Y ademas por PEDIDO
// (order_name, desde noviembre 2026): una llamada hecha desde el pedido o su
// novedad aparece aunque el cliente haya cambiado de telefono. Las dos
// busquedas se juntan sin repetir.

import { getDB } from "@/lib/db";
import { normalizePhone, phoneConfigForStore } from "@/lib/phone-cr";
import { AGENT_LEG_ANSWERED, describeZadarmaCall } from "@/lib/zadarma";
import { esLlamadaReal } from "@/lib/telnyx";
import { COLUMNAS_GRABACION, esColumnaFaltante, estadoGrabacion, type EstadoGrabacion } from "@/lib/grabaciones";

export interface LlamadaHistorial {
  /** Id de la fila de la llamada: /api/calls/<id>/recording la reproduce. */
  id: number;
  /** Cuando se marco (ISO). */
  at: string;
  /** "Saliente · contestada · 1m 20s", como el historial del lead. */
  descripcion: string;
  asesora: string | null;
  proveedor: string;
  /** El proveedor la grabo (este o no copiada todavia). */
  has_recording: boolean;
  /** Que mostrar: "Escuchar", "procesándose" o "no disponible". null = sin grabacion. */
  grabacion: EstadoGrabacion | null;
}

interface Fila {
  id: number;
  direction: string | null;
  status: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  vendedora: number | null;
  provider: string | null;
  cost: number | string | null;
  cost_currency: string | null;
  is_recorded?: boolean | null;
  recording_path?: string | null;
  recording_attempts?: number | null;
}

const COLUMNAS_BASE = "id,direction,status,duration_seconds,started_at,vendedora,provider,cost,cost_currency";

export async function llamadasDelTelefono(opts: {
  storeCode: string;
  phone: string | null | undefined;
  /** Con storeId, tambien las llamadas hechas por este pedido. */
  storeId?: number;
  orderName?: string | null;
  limit?: number;
}): Promise<LlamadaHistorial[]> {
  const phone = opts.phone ? normalizePhone(opts.phone, phoneConfigForStore(opts.storeCode)) : null;
  const orderName = (opts.orderName ?? "").trim();
  const porPedido = Boolean(orderName && opts.storeId);
  if (!phone && !porPedido) return [];

  const limite = opts.limit ?? 30;
  const db = getDB();

  // Con las columnas de la grabacion; sin la migracion aplicada, sin ellas
  // (el historial sigue, solo sin "Escuchar").
  async function buscar(filtro: "phone" | "order"): Promise<Fila[]> {
    const consulta = (columnas: string) => {
      const q = db.from("zadarma_calls").select(columnas);
      const filtrada =
        filtro === "phone"
          ? q.eq("phone", phone as string)
          : q.eq("store_id", opts.storeId as number).eq("order_name", orderName);
      return filtrada.order("started_at", { ascending: false, nullsFirst: false }).limit(limite);
    };
    let { data, error } = await consulta(`${COLUMNAS_BASE},${COLUMNAS_GRABACION}`);
    if (error && esColumnaFaltante(error)) {
      // Sin order_name no hay busqueda por pedido.
      if (filtro === "order") return [];
      ({ data, error } = await consulta(COLUMNAS_BASE));
    }
    if (error) throw new Error(`llamadasDelTelefono: ${error.message}`);
    return (data ?? []) as unknown as Fila[];
  }

  const [delTelefono, delPedido] = await Promise.all([
    phone ? buscar("phone") : Promise.resolve([] as Fila[]),
    porPedido ? buscar("order") : Promise.resolve([] as Fila[]),
  ]);

  // Sin repetir: la misma llamada sale en las dos busquedas.
  const porId = new Map<number, Fila>();
  for (const f of [...delTelefono, ...delPedido]) if (!porId.has(f.id)) porId.set(f.id, f);

  // La pata de timbrado de Zadarma que SI contesto no aporta: la llamada al
  // cliente viene como su propia fila (igual que en getLeadHistory).
  // Tampoco las que Kairo preparo y nunca se marcaron (lib/telnyx.ts).
  const filas = Array.from(porId.values())
    .filter((r) => r.started_at && r.status !== AGENT_LEG_ANSWERED && esLlamadaReal(r))
    .sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string))
    .slice(0, limite);

  const ids = Array.from(new Set(filas.map((r) => r.vendedora).filter((v): v is number => v != null)));
  const nombres = new Map<number, string>();
  if (ids.length) {
    const { data: staff } = await db.from("payroll_staff").select("id,name").in("id", ids);
    for (const s of (staff ?? []) as Array<{ id: number; name: string }>) nombres.set(s.id, s.name);
  }

  return filas.map((r) => ({
    id: r.id,
    at: r.started_at as string,
    descripcion: describeZadarmaCall(r),
    asesora: r.vendedora != null ? nombres.get(r.vendedora) ?? null : null,
    proveedor: r.provider ?? "zadarma",
    has_recording: Boolean(r.recording_path || r.is_recorded),
    grabacion: "recording_path" in r ? estadoGrabacion(r) : null,
  }));
}
