// Las llamadas a un telefono, para el historial de un pedido (Gestion) o de
// una novedad (Novedades). Leads ya las muestra desde getLeadHistory
// (lib/leads.ts), por lead.
//
// Se buscan por TELEFONO y no por pedido: asi aparecen todas las llamadas a
// ese cliente, de Zadarma y de Telnyx, se hayan hecho desde Leads, Gestion o
// Novedades. Los prefijos de pais (506, 504, 52) separan las tiendas.

import { getDB } from "@/lib/db";
import { normalizePhone, phoneConfigForStore } from "@/lib/phone-cr";
import { AGENT_LEG_ANSWERED, describeZadarmaCall } from "@/lib/zadarma";
import { esLlamadaReal } from "@/lib/telnyx";

export interface LlamadaHistorial {
  id: number;
  /** Cuando se marco (ISO). */
  at: string;
  /** "Saliente · contestada · 1m 20s", como el historial del lead. */
  descripcion: string;
  asesora: string | null;
  proveedor: string;
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
}

export async function llamadasDelTelefono(opts: {
  storeCode: string;
  phone: string;
  limit?: number;
}): Promise<LlamadaHistorial[]> {
  const phone = normalizePhone(opts.phone, phoneConfigForStore(opts.storeCode));
  if (!phone) return [];

  const db = getDB();
  const { data, error } = await db
    .from("zadarma_calls")
    .select("id,direction,status,duration_seconds,started_at,vendedora,provider,cost,cost_currency")
    .eq("phone", phone)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 30);
  if (error) throw new Error(`llamadasDelTelefono: ${error.message}`);

  // La pata de timbrado de Zadarma que SI contesto no aporta: la llamada al
  // cliente viene como su propia fila (igual que en getLeadHistory).
  // Tampoco las que Kairo preparo y nunca se marcaron (lib/telnyx.ts).
  const filas = ((data ?? []) as Fila[]).filter(
    (r) => r.started_at && r.status !== AGENT_LEG_ANSWERED && esLlamadaReal(r)
  );

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
  }));
}
