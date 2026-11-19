// Extensiones de Zadarma dinámicas (migración 20261119120000): se prestan a
// quien abre Kairo y quedan libres al cerrar la página o a los 2 min sin señal
// de vida. El historial (zadarma_prestamos) dice quién tenía cada extensión a
// cada hora, para atribuir las llamadas.

import { getDB } from "@/lib/db";

/** Sin señal de vida en este tiempo, la extensión vuelve al grupo. */
export const PRESTAMO_VENCE_SEG = 120;
/** Cada cuánto el teléfono avisa que sigue abierto. */
export const LATIDO_MS = 60_000;

/** Presta (o renueva) una extensión; null = todas en uso. */
export async function prestarExtension(opts: { userId: number; staffId: number | null; storeId: number }): Promise<string | null> {
  const { data, error } = await getDB().rpc("zadarma_prestar", {
    p_user: opts.userId,
    p_staff: opts.staffId,
    p_store: opts.storeId,
    p_vence_seg: PRESTAMO_VENCE_SEG,
  });
  if (error) throw new Error(`No se pudo asignar una extensión de Zadarma: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

export async function devolverExtension(userId: number, sip: string): Promise<void> {
  const { error } = await getDB().rpc("zadarma_devolver", { p_user: userId, p_sip: sip });
  if (error) console.warn(`[zadarma] no se pudo devolver ${sip}: ${error.message}`);
}

/** Cuántas extensiones del grupo sirven a la tienda (para el mensaje "todas en uso"). */
export async function extensionesDeTienda(storeId: number): Promise<number> {
  const { count } = await getDB()
    .from("zadarma_extensiones")
    .select("sip", { count: "exact", head: true })
    .eq("activa", true)
    .or(`store_id.is.null,store_id.eq.${Number(storeId)}`);
  return count ?? 0;
}

/**
 * Quién tenía la extensión a esa hora (asesora de la planilla), o null. `sip`
 * puede venir corto ("101", como lo manda el webhook) o completo.
 */
export async function asesoraConExtension(sip: string, at: string | null): Promise<number | null> {
  const corto = sip.trim();
  if (!/^[0-9-]{3,20}$/.test(corto)) return null;
  const momento = at && Number.isFinite(Date.parse(at)) ? new Date(at) : new Date();
  // Un minuto de margen: el aviso de Zadarma puede llegar justo después de
  // cerrar la página.
  const tope = new Date(momento.getTime() - 60_000).toISOString();
  let q = getDB()
    .from("zadarma_prestamos")
    .select("staff_id")
    .lte("desde", momento.toISOString())
    .or(`hasta.is.null,hasta.gte.${tope}`)
    .order("desde", { ascending: false })
    .limit(1);
  q = corto.includes("-") ? q.eq("sip", corto) : q.like("sip", `%-${corto}`);
  const { data, error } = await q;
  if (error) return null;
  const staff = (data?.[0] as { staff_id: number | null } | undefined)?.staff_id;
  return staff ?? null;
}
