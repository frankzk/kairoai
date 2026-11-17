// Lectura de los leads recibidos por asesora en un periodo (lib/leads-recibidos.ts).

import { getDB } from "@/lib/db";
import { leadBoardStage, type LeadRecord } from "@/lib/leads";
import { resumirRecibidos, type GestionLead, type LeadRecibido, type RecibidosAsesora } from "@/lib/leads-recibidos";

const PAGE = 1000;
const MAX_PAGES = 20;

export async function leerRecibidosPorAsesora(storeId: number, fromIso: string, toIso: string): Promise<Record<number, RecibidosAsesora>> {
  const db = getDB();
  const leads: LeadRecibido[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from("leads")
      .select("id,claimed_by,claimed_at,status,status_source,shopify_cart_open,has_order")
      .eq("store_id", storeId)
      .not("claimed_by", "is", null)
      .gte("claimed_at", fromIso)
      .lt("claimed_at", toIso)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`leerRecibidosPorAsesora: ${error.message}`);
    const filas = (data ?? []) as Array<Pick<LeadRecord, "id" | "status" | "status_source" | "shopify_cart_open" | "has_order"> & { claimed_by: number; claimed_at: string }>;
    for (const f of filas) {
      const etapa = leadBoardStage(f);
      leads.push({ id: f.id, claimed_by: f.claimed_by, claimed_at: f.claimed_at, cerrado: etapa === "cerrado", descartado: etapa === "descartado" });
    }
    if (filas.length < PAGE) break;
  }
  if (!leads.length) return {};
  // Gestiones de las asesoras desde el inicio del periodo (sin tope: lo
  // asignado ayer y trabajado hoy cuenta como trabajado).
  const gestiones: GestionLead[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from("lead_calls")
      .select("lead_id,kairo_user_id,occurred_at")
      .eq("store_id", storeId)
      .not("kairo_user_id", "is", null)
      .not("kind", "in", "(system,undo)")
      .gte("occurred_at", fromIso)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`leerRecibidosPorAsesora (gestiones): ${error.message}`);
    const filas = (data ?? []) as GestionLead[];
    gestiones.push(...filas);
    if (filas.length < PAGE) break;
  }
  return resumirRecibidos(leads, gestiones);
}
