// Leads recibidos por asesora en un periodo (Leads › Productividad): cuantos le
// asigno el reparto automatico, cuantos trabajo, cuantos ya se cerraron y
// cuantos siguen sin tocar. Antes la unica cifra era "Mis leads" del tablero
// (lo que ahora esta en la cola) y se leia como "lo que me cayo hoy": el 17/11
// el tablero decia 3 y a Leonor le habian asignado 111.
//
// - Recibidos: leads con claimed_by = ella y claimed_at dentro del periodo. Si
//   el reparto se lo paso a otra despues, cuenta para la otra.
// - Trabajados: con una gestion suya (lead_calls) desde que se lo asignaron.
// - Cerrados: hoy estan en la etapa Cerrado (con pedido o cierre manual).
// - Sin tocar: recibidos sin ninguna gestion suya.
//
// Puro: se prueba en tests/leads-recibidos.test.ts.

export interface LeadRecibido {
  id: number;
  claimed_by: number;
  claimed_at: string;
  /** true si hoy esta en la etapa Cerrado (leadBoardStage). */
  cerrado: boolean;
  descartado: boolean;
}

export interface GestionLead {
  lead_id: number;
  kairo_user_id: number;
  occurred_at: string;
}

export interface RecibidosAsesora {
  recibidos: number;
  trabajados: number;
  cerrados: number;
  sinTocar: number;
}

export function resumirRecibidos(leads: LeadRecibido[], gestiones: GestionLead[]): Record<number, RecibidosAsesora> {
  const porLead = new Map<number, GestionLead[]>();
  for (const g of gestiones) {
    const lista = porLead.get(g.lead_id) ?? [];
    lista.push(g);
    porLead.set(g.lead_id, lista);
  }
  const out: Record<number, RecibidosAsesora> = {};
  for (const l of leads) {
    const r = (out[l.claimed_by] ??= { recibidos: 0, trabajados: 0, cerrados: 0, sinTocar: 0 });
    r.recibidos += 1;
    const trabajado = (porLead.get(l.id) ?? []).some((g) => g.kairo_user_id === l.claimed_by && g.occurred_at >= l.claimed_at);
    if (trabajado) r.trabajados += 1;
    else r.sinTocar += 1;
    if (l.cerrado) r.cerrados += 1;
  }
  return out;
}
