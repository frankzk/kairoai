// Planilla quincenal: lectura y cambios en la base. Solo servidor.
// Tablas en supabase/migrations/20261114120000_planilla_quincenas.sql.
//
// Toda accion deja su fila en payroll_events (quien, que, antes y despues).
// Una quincena cerrada no acepta cambios: hay que reabrirla (y eso tambien
// queda en la bitacora). Los abonos no se borran: se anulan con motivo.
import { getDB } from "./db";
import {
  esAjusteTipo,
  etiquetaAjuste,
  montoEnColones,
  nombreQuincena,
  notaGasto,
  quincenaDe,
  totalesLinea,
  type AjusteTipo,
  type TotalesLinea,
} from "./planilla";

export class PlanillaError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "PlanillaError";
  }
}

const PENDIENTE_MIGRACION = "Pendiente: aplicar la migración de la planilla (20261114120000_planilla_quincenas.sql).";
const isMissing = (error: { code?: string } | null | undefined) =>
  ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error?.code));

function fail(error: { code?: string; message?: string } | null, what: string): never {
  if (isMissing(error)) throw new PlanillaError(PENDIENTE_MIGRACION, 503);
  throw new Error(`${what}: ${error?.message ?? "error"}`);
}

export interface Periodo {
  id: number;
  store_id: number;
  period_key: string;
  starts_on: string;
  ends_on: string;
  status: "abierta" | "cerrada";
  created_by: string;
  created_at: string;
  closed_by: string | null;
  closed_at: string | null;
}

export interface Ajuste {
  id: number;
  line_id: number;
  kind: AjusteTipo;
  amount: number;
  description: string;
  created_by: string;
  created_at: string;
}

export interface Abono {
  id: number;
  line_id: number;
  amount: number;
  exchange_rate: number | null;
  amount_crc: number;
  paid_on: string;
  method: string;
  reference: string;
  note: string;
  expense_id: number | null;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface Linea {
  id: number;
  period_id: number;
  staff_id: number;
  staff_name: string;
  staff_role: string;
  base: number;
  moneda: string;
  notes: string;
  ajustes: Ajuste[];
  abonos: Abono[];
  totales: TotalesLinea;
  metodo_pago: string;
  cuenta_pago: string;
}

export interface Evento {
  id: number;
  period_id: number;
  line_id: number | null;
  action: string;
  detail: Record<string, unknown>;
  actor: string;
  created_at: string;
}

export interface PersonaPlanilla {
  id: number;
  name: string;
  role: string;
  active: boolean;
  salario_quincenal: number;
  moneda: string;
  metodo_pago: string;
  cuenta_pago: string;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

async function evento(periodId: number, lineId: number | null, action: string, detail: Record<string, unknown>, actor: string) {
  const { error } = await getDB().from("payroll_events").insert({ period_id: periodId, line_id: lineId, action, detail, actor });
  if (error) fail(error, "payroll_events");
}

export async function listarPersonas(): Promise<PersonaPlanilla[]> {
  const { data, error } = await getDB()
    .from("payroll_staff")
    .select("id,name,role,active,salario_quincenal,moneda,metodo_pago,cuenta_pago")
    .order("name");
  if (error) fail(error, "payroll_staff");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: n(r.id),
    name: String(r.name ?? ""),
    role: String(r.role ?? ""),
    active: Boolean(r.active),
    salario_quincenal: n(r.salario_quincenal),
    moneda: String(r.moneda ?? "PEN"),
    metodo_pago: String(r.metodo_pago ?? ""),
    cuenta_pago: String(r.cuenta_pago ?? ""),
  }));
}

export async function guardarSalario(
  staffId: number,
  datos: { salario_quincenal: number; moneda: string; metodo_pago: string; cuenta_pago: string }
): Promise<void> {
  const { error } = await getDB()
    .from("payroll_staff")
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq("id", staffId);
  if (error) fail(error, "guardarSalario");
}

export async function listarQuincenas(storeId: number): Promise<Array<Pick<Periodo, "id" | "period_key" | "status">>> {
  const { data, error } = await getDB()
    .from("payroll_periods")
    .select("id,period_key,status")
    .eq("store_id", storeId)
    .order("starts_on", { ascending: false })
    .limit(48);
  if (error) fail(error, "payroll_periods");
  return (data ?? []) as Array<Pick<Periodo, "id" | "period_key" | "status">>;
}

async function periodoPorId(id: number): Promise<Periodo> {
  const { data, error } = await getDB().from("payroll_periods").select("*").eq("id", id).maybeSingle();
  if (error) fail(error, "payroll_periods");
  if (!data) throw new PlanillaError("La quincena no existe.", 404);
  return data as Periodo;
}

async function lineaPorId(id: number): Promise<{ linea: Record<string, unknown>; periodo: Periodo }> {
  const { data, error } = await getDB().from("payroll_lines").select("*").eq("id", id).maybeSingle();
  if (error) fail(error, "payroll_lines");
  if (!data) throw new PlanillaError("La persona no está en esta quincena.", 404);
  return { linea: data as Record<string, unknown>, periodo: await periodoPorId(n((data as { period_id: unknown }).period_id)) };
}

function abierta(periodo: Periodo, storeId: number) {
  if (periodo.store_id !== storeId) throw new PlanillaError("La quincena es de otra tienda.", 403);
  if (periodo.status !== "abierta") throw new PlanillaError("La quincena está cerrada: reábrela para hacer cambios.", 409);
}

/** Quincena completa: personas con sus ajustes, abonos y totales, y la bitácora. */
export async function leerQuincena(storeId: number, periodKey: string) {
  const { data: periodo, error } = await getDB()
    .from("payroll_periods")
    .select("*")
    .eq("store_id", storeId)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (error) fail(error, "payroll_periods");
  if (!periodo) return { periodo: null, lineas: [] as Linea[], eventos: [] as Evento[] };
  const p = periodo as Periodo;
  const { data: lineas, error: e1 } = await getDB().from("payroll_lines").select("*").eq("period_id", p.id).order("staff_name");
  if (e1) fail(e1, "payroll_lines");
  const ids = ((lineas ?? []) as Array<{ id: number }>).map((l) => l.id);
  const staffIds = ((lineas ?? []) as Array<{ staff_id: number }>).map((l) => l.staff_id);
  const [ajustes, abonos, eventos, staff] = await Promise.all([
    ids.length ? getDB().from("payroll_adjustments").select("*").in("line_id", ids).order("created_at") : Promise.resolve({ data: [], error: null }),
    ids.length ? getDB().from("payroll_payments").select("*").in("line_id", ids).order("paid_on").order("created_at") : Promise.resolve({ data: [], error: null }),
    getDB().from("payroll_events").select("*").eq("period_id", p.id).order("created_at", { ascending: false }).limit(300),
    staffIds.length ? getDB().from("payroll_staff").select("id,metodo_pago,cuenta_pago").in("id", staffIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [ajustes, abonos, eventos, staff]) if (r.error) fail(r.error, "planilla");
  const pago = new Map(((staff.data ?? []) as Array<{ id: number; metodo_pago: string | null; cuenta_pago: string | null }>).map((s) => [s.id, s]));
  const porLinea = <T extends { line_id: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.line_id, [...(m.get(r.line_id) ?? []), r]);
    return m;
  };
  const aj = porLinea(((ajustes.data ?? []) as Ajuste[]).map((a) => ({ ...a, amount: n(a.amount) })));
  const ab = porLinea(
    ((abonos.data ?? []) as Abono[]).map((a) => ({
      ...a,
      amount: n(a.amount),
      amount_crc: n(a.amount_crc),
      exchange_rate: a.exchange_rate == null ? null : n(a.exchange_rate),
    }))
  );
  const resultado: Linea[] = ((lineas ?? []) as Array<Record<string, unknown>>).map((l) => {
    const id = n(l.id);
    const base = n(l.base);
    const ajustesL = aj.get(id) ?? [];
    const abonosL = ab.get(id) ?? [];
    const s = pago.get(n(l.staff_id));
    return {
      id,
      period_id: n(l.period_id),
      staff_id: n(l.staff_id),
      staff_name: String(l.staff_name ?? ""),
      staff_role: String(l.staff_role ?? ""),
      base,
      moneda: String(l.moneda ?? "PEN"),
      notes: String(l.notes ?? ""),
      ajustes: ajustesL,
      abonos: abonosL,
      totales: totalesLinea(base, ajustesL, abonosL),
      metodo_pago: String(s?.metodo_pago ?? ""),
      cuenta_pago: String(s?.cuenta_pago ?? ""),
    };
  });
  return { periodo: p, lineas: resultado, eventos: (eventos.data ?? []) as Evento[] };
}

/** Crea la quincena con todo el personal activo y su salario base de hoy. */
export async function crearQuincena(storeId: number, periodKey: string, actor: string): Promise<void> {
  const q = quincenaDe(periodKey);
  if (!q) throw new PlanillaError("Quincena inválida.");
  const { data: periodo, error } = await getDB()
    .from("payroll_periods")
    .insert({ store_id: storeId, period_key: periodKey, starts_on: q.startsOn, ends_on: q.endsOn, created_by: actor })
    .select()
    .single();
  if (error) {
    if (String(error.code) === "23505") throw new PlanillaError("Esa quincena ya existe.", 409);
    fail(error, "crearQuincena");
  }
  const p = periodo as Periodo;
  const personas = (await listarPersonas()).filter((x) => x.active);
  if (personas.length) {
    const { error: e2 } = await getDB().from("payroll_lines").insert(
      personas.map((x) => ({ period_id: p.id, staff_id: x.id, staff_name: x.name, staff_role: x.role, base: x.salario_quincenal, moneda: x.moneda }))
    );
    if (e2) fail(e2, "crearQuincena lineas");
  }
  await evento(p.id, null, "quincena_creada", { quincena: nombreQuincena(periodKey), personas: personas.length }, actor);
}

export async function agregarPersona(storeId: number, periodId: number, staffId: number, actor: string): Promise<void> {
  const periodo = await periodoPorId(periodId);
  abierta(periodo, storeId);
  const persona = (await listarPersonas()).find((x) => x.id === staffId);
  if (!persona) throw new PlanillaError("Esa persona no está en el personal.", 404);
  const { data, error } = await getDB()
    .from("payroll_lines")
    .insert({ period_id: periodId, staff_id: staffId, staff_name: persona.name, staff_role: persona.role, base: persona.salario_quincenal, moneda: persona.moneda })
    .select("id")
    .single();
  if (error) {
    if (String(error.code) === "23505") throw new PlanillaError("Esa persona ya está en la quincena.", 409);
    fail(error, "agregarPersona");
  }
  await evento(periodId, n((data as { id: unknown }).id), "persona_agregada", { persona: persona.name, base: persona.salario_quincenal, moneda: persona.moneda }, actor);
}

export async function quitarPersona(storeId: number, lineId: number, actor: string): Promise<void> {
  const { linea, periodo } = await lineaPorId(lineId);
  abierta(periodo, storeId);
  const { data: pagos, error } = await getDB().from("payroll_payments").select("id,voided_at").eq("line_id", lineId);
  if (error) fail(error, "quitarPersona");
  if (((pagos ?? []) as Array<{ voided_at: string | null }>).some((x) => !x.voided_at))
    throw new PlanillaError("Tiene abonos registrados: anúlalos antes de quitarla de la quincena.", 409);
  if ((pagos ?? []).length) throw new PlanillaError("Tiene abonos anulados en su historial: se mantiene en la quincena para no perder la trazabilidad.", 409);
  const { error: e2 } = await getDB().from("payroll_lines").delete().eq("id", lineId);
  if (e2) fail(e2, "quitarPersona");
  await evento(periodo.id, null, "persona_quitada", { persona: String(linea.staff_name), base: n(linea.base) }, actor);
}

export async function cambiarBase(storeId: number, lineId: number, base: number, notes: string | undefined, actor: string): Promise<void> {
  const { linea, periodo } = await lineaPorId(lineId);
  abierta(periodo, storeId);
  const antes = n(linea.base);
  const cambios: Record<string, unknown> = { base, updated_at: new Date().toISOString() };
  if (notes !== undefined) cambios.notes = notes;
  const { error } = await getDB().from("payroll_lines").update(cambios).eq("id", lineId);
  if (error) fail(error, "cambiarBase");
  await evento(periodo.id, lineId, "base_cambiada", { persona: String(linea.staff_name), antes, despues: base }, actor);
}

export async function agregarAjuste(
  storeId: number,
  lineId: number,
  kind: unknown,
  amount: number,
  description: string,
  actor: string
): Promise<void> {
  if (!esAjusteTipo(kind)) throw new PlanillaError("Tipo de ajuste inválido.");
  const { linea, periodo } = await lineaPorId(lineId);
  abierta(periodo, storeId);
  const { error } = await getDB().from("payroll_adjustments").insert({ line_id: lineId, kind, amount, description, created_by: actor });
  if (error) fail(error, "agregarAjuste");
  await evento(periodo.id, lineId, "ajuste_agregado", { persona: String(linea.staff_name), tipo: etiquetaAjuste(kind), monto: amount, moneda: String(linea.moneda), detalle: description }, actor);
}

export async function quitarAjuste(storeId: number, ajusteId: number, actor: string): Promise<void> {
  const { data, error } = await getDB().from("payroll_adjustments").select("*").eq("id", ajusteId).maybeSingle();
  if (error) fail(error, "quitarAjuste");
  if (!data) throw new PlanillaError("El ajuste no existe.", 404);
  const a = data as Ajuste;
  const { linea, periodo } = await lineaPorId(a.line_id);
  abierta(periodo, storeId);
  const { error: e2 } = await getDB().from("payroll_adjustments").delete().eq("id", ajusteId);
  if (e2) fail(e2, "quitarAjuste");
  await evento(periodo.id, a.line_id, "ajuste_quitado", { persona: String(linea.staff_name), tipo: etiquetaAjuste(a.kind), monto: n(a.amount), detalle: a.description }, actor);
}

/**
 * Registra un abono y su gasto de planilla en colones (Gastos y Cierre mensual
 * lo toman de ahi). Si el abono no se puede guardar, se borra el gasto.
 */
export async function registrarAbono(
  storeId: number,
  lineId: number,
  datos: { amount: number; paid_on: string; method: string; reference: string; note: string; exchange_rate: number | null },
  actor: string
): Promise<void> {
  const { linea, periodo } = await lineaPorId(lineId);
  abierta(periodo, storeId);
  const moneda = String(linea.moneda ?? "PEN");
  const tipoCambio = moneda === "CRC" ? null : datos.exchange_rate;
  if (moneda !== "CRC" && (!tipoCambio || tipoCambio <= 0))
    throw new PlanillaError(`Indica el tipo de cambio ${moneda} a colones.`);
  const amountCrc = montoEnColones(moneda, datos.amount, tipoCambio);
  const persona = String(linea.staff_name);
  const { data: gasto, error: eg } = await getDB()
    .from("business_expenses")
    .insert({
      type: "payroll",
      store_id: storeId,
      expense_date: datos.paid_on,
      month: datos.paid_on.slice(0, 7),
      platform: persona,
      category: "Sueldo quincena",
      description: `${String(linea.staff_role || "Planilla")} · quincena ${nombreQuincena(periodo.period_key)}`,
      amount: amountCrc,
      currency: "CRC",
      notes: notaGasto(moneda, datos.amount, tipoCambio, `Abono de planilla${datos.reference ? ` · ${datos.reference}` : ""}`),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (eg) fail(eg, "registrarAbono gasto");
  const expenseId = n((gasto as { id: unknown }).id);
  const { data: abono, error } = await getDB()
    .from("payroll_payments")
    .insert({
      line_id: lineId,
      amount: datos.amount,
      exchange_rate: tipoCambio,
      amount_crc: amountCrc,
      paid_on: datos.paid_on,
      method: datos.method,
      reference: datos.reference,
      note: datos.note,
      expense_id: expenseId,
      created_by: actor,
    })
    .select("id")
    .single();
  if (error) {
    await getDB().from("business_expenses").delete().eq("id", expenseId);
    fail(error, "registrarAbono");
  }
  await evento(
    periodo.id,
    lineId,
    "abono_registrado",
    { persona, abono_id: n((abono as { id: unknown }).id), monto: datos.amount, moneda, tipo_cambio: tipoCambio, colones: amountCrc, fecha: datos.paid_on, metodo: datos.method, referencia: datos.reference, gasto_id: expenseId },
    actor
  );
}

/** Anula un abono (queda en el historial) y borra su gasto de planilla. */
export async function anularAbono(storeId: number, abonoId: number, motivo: string, actor: string): Promise<void> {
  const { data, error } = await getDB().from("payroll_payments").select("*").eq("id", abonoId).maybeSingle();
  if (error) fail(error, "anularAbono");
  if (!data) throw new PlanillaError("El abono no existe.", 404);
  const a = data as Abono;
  if (a.voided_at) throw new PlanillaError("Ese abono ya estaba anulado.", 409);
  const { linea, periodo } = await lineaPorId(a.line_id);
  abierta(periodo, storeId);
  const { error: e2 } = await getDB()
    .from("payroll_payments")
    .update({ voided_at: new Date().toISOString(), voided_by: actor, void_reason: motivo })
    .eq("id", abonoId);
  if (e2) fail(e2, "anularAbono");
  if (a.expense_id) await getDB().from("business_expenses").delete().eq("id", a.expense_id).eq("store_id", storeId);
  await evento(periodo.id, a.line_id, "abono_anulado", { persona: String(linea.staff_name), abono_id: abonoId, monto: n(a.amount), moneda: String(linea.moneda), motivo, gasto_borrado: a.expense_id }, actor);
}

export async function cerrarQuincena(storeId: number, periodId: number, actor: string): Promise<void> {
  const periodo = await periodoPorId(periodId);
  abierta(periodo, storeId);
  const { lineas } = await leerQuincena(storeId, periodo.period_key);
  const pendientes = lineas.filter((l) => l.totales.saldo > 0);
  if (pendientes.length)
    throw new PlanillaError(`No se puede cerrar: ${pendientes.length} ${pendientes.length === 1 ? "persona tiene" : "personas tienen"} saldo pendiente.`, 409);
  const { error } = await getDB()
    .from("payroll_periods")
    .update({ status: "cerrada", closed_by: actor, closed_at: new Date().toISOString() })
    .eq("id", periodId);
  if (error) fail(error, "cerrarQuincena");
  const totales = lineas.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.moneda]: (acc[l.moneda] ?? 0) + l.totales.abonado }), {});
  await evento(periodId, null, "quincena_cerrada", { personas: lineas.length, abonado: totales }, actor);
}

export async function reabrirQuincena(storeId: number, periodId: number, motivo: string, actor: string): Promise<void> {
  const periodo = await periodoPorId(periodId);
  if (periodo.store_id !== storeId) throw new PlanillaError("La quincena es de otra tienda.", 403);
  if (periodo.status !== "cerrada") throw new PlanillaError("La quincena ya está abierta.", 409);
  const { error } = await getDB().from("payroll_periods").update({ status: "abierta", closed_by: null, closed_at: null }).eq("id", periodId);
  if (error) fail(error, "reabrirQuincena");
  await evento(periodId, null, "quincena_reabierta", { motivo }, actor);
}
