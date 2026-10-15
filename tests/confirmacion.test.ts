// La cola de confirmacion de los pedidos pendientes: subetapa y plazo.
//
// POR QUE ESTE TEST EXISTE: la cola decide a quien llama el equipo hoy. Si un
// recordatorio vencido cae en "Vencidos", las asesoras encuentran ahi los
// pedidos que acaban de llamar y leen "Vencidos" como abandonados (le paso al
// equipo que diseño esta logica). Si los dias de gestion cuentan llamadas en
// vez de dias, un pedido llega a "Ultimo intento" en una tarde.
//
// Horas en Costa Rica (UTC-6): 16:00Z = 10:00 local.

import { describe, expect, it } from "vitest";
import {
  configDeTienda,
  diasDeGestion,
  estadoConfirmacion,
  fechaLocal,
  problemaFechaPactada,
  recordatorioPara,
  sumarHorasHabiles,
  type EventoConfirmacion,
  type PedidoConfirmacion,
} from "../lib/confirmacion";

const TZ = "America/Costa_Rica";
const CONFIG = { activacion: "2026-09-15", cicloDias: 3, tz: TZ };
const AHORA = new Date("2026-10-15T16:00:00Z"); // jueves 15/10, 10:00 en CR
const PEDIDO: PedidoConfirmacion = { creadoAt: "2026-10-14T18:00:00Z", confirmadoIcomfly: false, pagado: false };

const local = (fechaHora: string) => new Date(`${fechaHora}-06:00`).toISOString();
const intento = (cuando: string, outcome = "no_contesta", extra: Partial<EventoConfirmacion> = {}): EventoConfirmacion => ({
  kind: "contacto",
  outcome,
  created_at: local(cuando),
  ...extra,
});

const estado = (eventos: EventoConfirmacion[], pedido: Partial<PedidoConfirmacion> = {}) =>
  estadoConfirmacion({ ...PEDIDO, ...pedido }, eventos, CONFIG, AHORA);

describe("días de gestión", () => {
  it("tres llamadas el mismo día cuentan uno", () => {
    expect(diasDeGestion([intento("2026-10-14T09:00"), intento("2026-10-14T13:00"), intento("2026-10-14T20:00")], TZ)).toBe(1);
  });
  it("llamadas el 20, 22 y 25 son 3 días, no 6", () => {
    expect(diasDeGestion([intento("2026-09-20T09:00"), intento("2026-09-22T09:00"), intento("2026-09-25T09:00")], TZ)).toBe(3);
  });
  it("cuenta en el calendario de la tienda, no en UTC", () => {
    // 21:00 del 14 en CR son las 03:00Z del 15: sigue siendo el 14.
    expect(fechaLocal(local("2026-10-14T21:00"), TZ)).toBe("2026-10-14");
  });
});

describe("recordatorio de 2 horas hábiles (08:00 a 22:00)", () => {
  const en = (fechaHora: string) => fechaLocal(sumarHorasHabiles(new Date(local(fechaHora)), 2, TZ), TZ) + " " +
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(sumarHorasHabiles(new Date(local(fechaHora)), 2, TZ));
  it("dentro del horario suma 2 horas", () => {
    expect(en("2026-10-15T10:00")).toBe("2026-10-15 12:00");
  });
  it("un No contestó a las 21:30 vence al día siguiente a las 09:30", () => {
    expect(en("2026-10-15T21:30")).toBe("2026-10-16 09:30");
  });
  it("de noche o de madrugada cuenta desde las 08:00", () => {
    expect(en("2026-10-15T23:00")).toBe("2026-10-16 10:00");
    expect(en("2026-10-15T06:00")).toBe("2026-10-15 10:00");
  });
  it("solo No contestó y Se deja mensaje ponen recordatorio", () => {
    expect(recordatorioPara("no_contesta", AHORA, TZ)).toBe("2026-10-15T18:00:00.000Z");
    expect(recordatorioPara("buzon", AHORA, TZ)).not.toBeNull();
    expect(recordatorioPara("contesto", AHORA, TZ)).toBeNull();
    expect(recordatorioPara("reagendar", AHORA, TZ)).toBeNull();
  });
});

describe("subetapa (la primera que aplica gana)", () => {
  it("nunca llamado y creado desde la activación: Sin llamar, y es trabajo de hoy", () => {
    expect(estado([])).toMatchObject({ subetapa: "sin_llamar", plazo: "hoy", diasGestion: 0 });
  });
  it("nunca llamado y creado antes de la activación: Histórico sin gestión, fuera de la cola", () => {
    expect(estado([], { creadoAt: "2026-08-02T15:00:00Z" })).toMatchObject({ subetapa: "historico", plazo: null });
  });
  it("un histórico que alguien llama entra a la cola", () => {
    expect(estado([intento("2026-10-15T09:00", "contesto")], { creadoAt: "2026-08-02T15:00:00Z" }).subetapa).toBe("por_confirmar");
  });
  it("contactado y lo último sin fecha pactada: Por confirmar", () => {
    expect(estado([intento("2026-10-14T09:00", "contesto")]).subetapa).toBe("por_confirmar");
  });
  it("lo último es una fecha pactada: Volver a contactar", () => {
    const e = estado([intento("2026-10-14T09:00"), intento("2026-10-14T15:00", "reagendar", { fecha_pactada: "2026-10-17" })]);
    expect(e).toMatchObject({ subetapa: "volver_a_contactar", plazo: "proximos", vence: { tipo: "pactada", fecha: "2026-10-17" } });
  });
  it("Pendiente de abono también es un acuerdo con fecha", () => {
    expect(estado([intento("2026-10-14T15:00", "pendiente_abono", { fecha_pactada: "2026-10-15" })])).toMatchObject({
      subetapa: "volver_a_contactar",
      plazo: "hoy",
    });
  });
  it("si después se llama sin pactar otra fecha, vuelve a Por confirmar: el compromiso viejo ya no vale", () => {
    const e = estado([
      intento("2026-10-13T15:00", "reagendar", { fecha_pactada: "2026-10-20" }),
      intento("2026-10-14T10:00", "no_contesta", { recordatorio_at: local("2026-10-14T12:00") }),
    ]);
    expect(e.subetapa).toBe("por_confirmar");
  });
  it("a la misma hora, gana la fecha pactada", () => {
    const e = estado([
      intento("2026-10-14T10:00", "reagendar", { fecha_pactada: "2026-10-16" }),
      intento("2026-10-14T10:00", "no_contesta"),
    ]);
    expect(e.subetapa).toBe("volver_a_contactar");
  });
  it("una nota es gestión: saca de Sin llamar y vuelve a los N días de la nota", () => {
    // Así trabajaba el equipo antes de los botones: "se llamó 3 veces, se le dejó msj".
    const nota = { kind: "nota", outcome: "", created_at: local("2026-10-14T17:00") };
    expect(estado([nota])).toMatchObject({ subetapa: "por_confirmar", plazo: "proximos", diasGestion: 1, vence: { tipo: "ciclo", fecha: "2026-10-17" } });
    expect(estado([nota], { creadoAt: "2026-08-02T15:00:00Z" }).subetapa).toBe("por_confirmar");
  });
  it("una nota no rompe la fecha pactada ni el recordatorio que acompaña", () => {
    const nota = (cuando: string) => ({ kind: "nota", outcome: "", created_at: local(cuando) });
    expect(
      estado([intento("2026-10-14T10:00", "reagendar", { fecha_pactada: "2026-10-18" }), nota("2026-10-14T10:01")])
    ).toMatchObject({ subetapa: "volver_a_contactar", vence: { tipo: "pactada", fecha: "2026-10-18" } });
    expect(
      estado([intento("2026-10-15T09:30", "no_contesta", { recordatorio_at: local("2026-10-15T11:30") }), nota("2026-10-15T09:31")])
    ).toMatchObject({ plazo: "proximos", vence: { tipo: "recordatorio" } });
  });
  it("7 días DISTINTOS de gestión: Último intento", () => {
    const dias = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
    const seis = dias.slice(0, 6).flatMap((d) => [intento(`${d}T09:00`), intento(`${d}T15:00`)]);
    expect(estado(seis).subetapa).toBe("por_confirmar");
    expect(estado([...seis, intento(`${dias[6]}T09:00`)]).subetapa).toBe("ultimo_intento");
  });
  it("Último intento también se puede marcar a mano", () => {
    const e = estado([intento("2026-10-14T09:00"), { kind: "decision", outcome: "ultimo_intento", created_at: local("2026-10-14T09:05") }]);
    expect(e.subetapa).toBe("ultimo_intento");
  });
  it("Confirmado: lo registra una asesora, iComfly ya lo confirmó o Shopify lo cobró. Sale de los plazos", () => {
    expect(estado([intento("2026-10-14T09:00", "confirmado")])).toMatchObject({ subetapa: "confirmado", plazo: null });
    expect(estado([], { confirmadoIcomfly: true }).subetapa).toBe("confirmado");
    expect(estado([], { pagado: true, creadoAt: "2026-08-02T15:00:00Z" }).subetapa).toBe("confirmado");
  });
});

describe("plazo: solo una promesa rota va a Vencidos", () => {
  it("fecha pactada que ya pasó: Vencidos", () => {
    expect(estado([intento("2026-10-12T10:00", "reagendar", { fecha_pactada: "2026-10-14" })]).plazo).toBe("vencidos");
  });
  it("fecha pactada hoy: Hoy", () => {
    expect(estado([intento("2026-10-12T10:00", "reagendar", { fecha_pactada: "2026-10-15" })]).plazo).toBe("hoy");
  });
  it("recordatorio todavía en el futuro: Próximos", () => {
    expect(estado([intento("2026-10-15T09:30", "no_contesta", { recordatorio_at: local("2026-10-15T11:30") })]).plazo).toBe("proximos");
  });
  it("recordatorio vencido, aunque sea de hace días: Hoy, nunca Vencidos", () => {
    expect(estado([intento("2026-10-09T10:00", "no_contesta", { recordatorio_at: local("2026-10-09T12:00") })]).plazo).toBe("hoy");
  });
  it("sin fecha pactada vuelve a los N días del último contacto (3 por defecto)", () => {
    expect(estado([intento("2026-10-14T10:00", "contesto")])).toMatchObject({ plazo: "proximos", vence: { tipo: "ciclo", fecha: "2026-10-17" } });
    expect(estado([intento("2026-10-12T10:00", "contesto")]).plazo).toBe("hoy");
    expect(estado([intento("2026-10-01T10:00", "contesto")]).plazo).toBe("hoy");
  });
});

describe("al registrar", () => {
  it("la fecha pactada no puede ser anterior a hoy", () => {
    expect(problemaFechaPactada("2026-10-14", AHORA, TZ)).toMatch(/anterior a hoy/);
    expect(problemaFechaPactada("2026-10-15", AHORA, TZ)).toBeNull();
    expect(problemaFechaPactada("", AHORA, TZ)).toMatch(/fecha pactada/);
  });
  it("configuración por tienda: ciclo entre 1 y 30, activación válida", () => {
    expect(configDeTienda("mireva-hn", { confirmacion: { ciclo_dias: 5, activacion: "2026-10-01" } })).toEqual({
      activacion: "2026-10-01",
      cicloDias: 5,
      tz: "America/Tegucigalpa",
    });
    expect(configDeTienda("mireva-cr", { confirmacion: { ciclo_dias: 90 } })).toMatchObject({ activacion: "2026-09-15", cicloDias: 3 });
  });
});
