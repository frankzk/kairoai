import { NextRequest, NextResponse } from "next/server";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";
import { getLeadsDeAsesora, leadBoardStage, type LeadRecord } from "@/lib/leads";
import { identidadActual } from "@/lib/identidad";
import { canSeePresenceTeam } from "@/lib/leads-presence-server";
import { isInCallQueue, leadSegment, leadWorkState } from "@/lib/leads-segment";
import { MAX_LEADS_LISTA, periodoExacto } from "@/lib/leads-productividad-leads";

export const runtime = "nodejs";
export const maxDuration = 30;

// GET: los leads que cuenta la columna "Leads" de Productividad para UNA
// asesora: ?store=…&staff=<payroll_staff.id>&from=<ISO>&to=<ISO>. El periodo
// es el EXACTO que devolvio /api/leads/productivity (from/to), para que la
// lista tenga tantos leads como el numero que se apreto.
//
// Permisos: los mismos que la tabla. Supervision ("ver productividad del
// equipo" o usuarios) ve la lista de cualquiera; el resto, solo la suya (la
// unica fila que ve). La tienda se valida contra las permitidas de la sesion.
// Solo se llama al apretar el numero: nunca al cargar la pagina.
export async function GET(req: NextRequest) {
  const yo = identidadActual();
  if (!yo) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(sp);
  if (!store) {
    return NextResponse.json({ error: "store requerido: usa mireva-cr o mireva-hn" }, { status: 400 });
  }
  const staff = Number(sp.get("staff"));
  if (!Number.isSafeInteger(staff) || staff <= 0) {
    return NextResponse.json({ error: "staff requerido" }, { status: 400 });
  }
  if (!canSeePresenceTeam(yo) && staff !== yo.staffId) {
    return NextResponse.json({ error: "Solo puedes ver tus propios leads." }, { status: 403 });
  }
  const periodo = periodoExacto(sp.get("from"), sp.get("to"));
  if (!periodo) {
    return NextResponse.json({ error: "Periodo invalido." }, { status: 400 });
  }

  try {
    const r = await getLeadsDeAsesora(store.id, staff, periodo.fromIso, periodo.toIso);
    return NextResponse.json(
      {
        staff_id: staff,
        from: periodo.fromIso,
        to: periodo.toIso,
        total: r.total,
        gestiones: r.gestiones,
        incompleto: r.incompleto,
        max_leads: MAX_LEADS_LISTA,
        // Cada lead con la misma forma que el tablero (los dos ejes), para
        // abrir su ficha con la reserva de siempre (lib/lead-holds.ts).
        leads: r.leads.map((item) => {
          const lead = item.lead as unknown as LeadRecord | null;
          return {
            ...item,
            lead: lead
              ? {
                  ...lead,
                  labels: Array.isArray(lead.labels) ? lead.labels : [],
                  board_stage: leadBoardStage(lead),
                  work_state: leadWorkState(lead),
                  segment: leadSegment(lead),
                  in_call_queue: isInCallQueue(lead),
                }
              : null,
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer los leads";
    return NextResponse.json({ leads: [], error: message }, { status: 500 });
  }
}
