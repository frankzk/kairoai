import { NextRequest, NextResponse } from "next/server";
import { identidadActual } from "@/lib/identidad";
import { getRequiredStoreFromBody, getRequiredStoreFromSearchParams } from "@/lib/stores";
import { esMoneda, esQuincena, quincenaDeFecha } from "@/lib/planilla";
import {
  agregarAjuste,
  agregarPersona,
  anularAbono,
  cambiarBase,
  cerrarQuincena,
  crearQuincena,
  guardarSalario,
  leerQuincena,
  listarPersonas,
  listarQuincenas,
  PlanillaError,
  quitarAjuste,
  quitarPersona,
  reabrirQuincena,
  registrarAbono,
} from "@/lib/planilla-db";

// Planilla quincenal (Gestión › Planilla). Solo Finanzas (lib/permisos.ts).
// GET ?store&quincena=YYYY-MM-1|2 -> la quincena con personas, ajustes, abonos,
// totales y bitacora, mas el personal (salarios) y las quincenas existentes.
// POST { store, accion, ... } -> un cambio; cada uno queda en la bitacora.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const money = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : NaN;
};
const id = (v: unknown) => {
  const x = Number(v);
  return Number.isInteger(x) && x > 0 ? x : 0;
};

function responder(err: unknown) {
  if (err instanceof PlanillaError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("planilla", err);
  return NextResponse.json({ error: "No se pudo completar la acción de planilla. Vuelve a intentarlo." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const store = getRequiredStoreFromSearchParams(params);
  if (!store) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  const quincena = params.get("quincena") || quincenaDeFecha(new Date().toISOString().slice(0, 10));
  if (!esQuincena(quincena)) return NextResponse.json({ error: "quincena inválida (YYYY-MM-1 o YYYY-MM-2)" }, { status: 400 });
  try {
    const [datos, personas, quincenas] = await Promise.all([leerQuincena(store.id, quincena), listarPersonas(), listarQuincenas(store.id)]);
    return NextResponse.json({ quincena, ...datos, personas, quincenas });
  } catch (err) {
    return responder(err);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const store = getRequiredStoreFromBody(body);
  if (!store || !body) return NextResponse.json({ error: "store requerido" }, { status: 400 });
  const actor = identidadActual()?.nombre || "Sistema";
  const accion = String(body.accion ?? "");
  try {
    switch (accion) {
      case "crear_quincena": {
        if (!esQuincena(body.quincena)) return NextResponse.json({ error: "Quincena inválida." }, { status: 400 });
        await crearQuincena(store.id, body.quincena, actor);
        break;
      }
      case "salario": {
        const staffId = id(body.staff_id);
        const salario = money(body.salario_quincenal);
        if (!staffId || !(salario >= 0) || !esMoneda(body.moneda))
          return NextResponse.json({ error: "Indica la persona, un salario válido y la moneda." }, { status: 400 });
        await guardarSalario(staffId, {
          salario_quincenal: salario,
          moneda: String(body.moneda),
          metodo_pago: text(body.metodo_pago, 60),
          cuenta_pago: text(body.cuenta_pago, 120),
        });
        break;
      }
      case "agregar_persona": {
        if (!id(body.period_id) || !id(body.staff_id)) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
        await agregarPersona(store.id, id(body.period_id), id(body.staff_id), actor);
        break;
      }
      case "quitar_persona": {
        if (!id(body.line_id)) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
        await quitarPersona(store.id, id(body.line_id), actor);
        break;
      }
      case "base": {
        const base = money(body.base);
        if (!id(body.line_id) || !(base >= 0)) return NextResponse.json({ error: "Indica un salario base válido." }, { status: 400 });
        await cambiarBase(store.id, id(body.line_id), base, body.notes === undefined ? undefined : text(body.notes, 500), actor);
        break;
      }
      case "ajuste": {
        const amount = money(body.amount);
        if (!id(body.line_id) || !(amount > 0)) return NextResponse.json({ error: "Indica un monto mayor a cero." }, { status: 400 });
        await agregarAjuste(store.id, id(body.line_id), body.kind, amount, text(body.description), actor);
        break;
      }
      case "quitar_ajuste": {
        if (!id(body.ajuste_id)) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
        await quitarAjuste(store.id, id(body.ajuste_id), actor);
        break;
      }
      case "abono": {
        const amount = money(body.amount);
        const paidOn = text(body.paid_on, 10);
        const rate = body.exchange_rate == null || body.exchange_rate === "" ? null : Number(body.exchange_rate);
        if (!id(body.line_id) || !(amount > 0) || !DATE_RE.test(paidOn))
          return NextResponse.json({ error: "Indica el monto y la fecha del abono." }, { status: 400 });
        if (rate != null && !(Number.isFinite(rate) && rate > 0))
          return NextResponse.json({ error: "Tipo de cambio inválido." }, { status: 400 });
        await registrarAbono(
          store.id,
          id(body.line_id),
          { amount, paid_on: paidOn, method: text(body.method, 60), reference: text(body.reference, 120), note: text(body.note, 500), exchange_rate: rate },
          actor
        );
        break;
      }
      case "anular_abono": {
        const motivo = text(body.motivo, 300);
        if (!id(body.abono_id) || !motivo) return NextResponse.json({ error: "Indica el motivo de la anulación." }, { status: 400 });
        await anularAbono(store.id, id(body.abono_id), motivo, actor);
        break;
      }
      case "cerrar": {
        if (!id(body.period_id)) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
        await cerrarQuincena(store.id, id(body.period_id), actor);
        break;
      }
      case "reabrir": {
        const motivo = text(body.motivo, 300);
        if (!id(body.period_id) || !motivo) return NextResponse.json({ error: "Indica por qué se reabre." }, { status: 400 });
        await reabrirQuincena(store.id, id(body.period_id), motivo, actor);
        break;
      }
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return responder(err);
  }
}
