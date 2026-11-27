// Reserva de leads: una asesora a la vez, máximo 10 minutos (lib/lead-holds.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  blockedNoticeText,
  blockingHold,
  canTakeOverHold,
  decideAcquire,
  formatHoldTime,
  heldByMeText,
  holdActive,
  holderFirstName,
  holdLostText,
  HOLD_EXPIRED_TEXT,
  LEAD_HOLD_MINUTES,
  LEAD_HOLD_MS,
  LEAD_HOLD_TTL_SECONDS,
  minutesLeft,
  parseLeadHold,
  writeConflictText,
  type LeadHold,
} from "../lib/lead-holds";
import { parseAcquireResponse, parseCheckResponse } from "../lib/lead-holds-client";
import { LeadHoldNotice } from "../components/LeadHoldModal";

const CR = "America/Costa_Rica";
// 14:05 en Costa Rica (UTC−6).
const t0 = Date.parse("2026-11-28T20:05:00Z");
const ana = { id: 7, name: "Ana Pérez" };
const bea = { id: 9, name: "Beatriz Mora" };
const holdOf = (who: { id: number; name: string }, at = t0, changes: Partial<LeadHold> = {}): LeadHold => ({
  lead_id: 41,
  holder_user_id: who.id,
  holder_name: who.name,
  acquired_at: new Date(at).toISOString(),
  expires_at: new Date(at + LEAD_HOLD_MS).toISOString(),
  ...changes,
});

describe("Reglas de la reserva (las mismas que lead_hold_acquire)", () => {
  it("son 10 minutos, en un solo lugar", () => {
    expect(LEAD_HOLD_MINUTES).toBe(10);
    expect(LEAD_HOLD_MS).toBe(600_000);
    expect(LEAD_HOLD_TTL_SECONDS).toBe(600);
  });

  it("sin reserva: la toma quien abre, por 10 minutos", () => {
    const d = decideAcquire(null, ana, 41, t0, false);
    expect(d.kind).toBe("acquired");
    expect(d.hold.holder_user_id).toBe(7);
    expect(Date.parse(d.hold.expires_at) - Date.parse(d.hold.acquired_at)).toBe(LEAD_HOLD_MS);
  });

  it("reserva vigente de otra persona: bloquea y dice quién la tiene", () => {
    const d = decideAcquire(holdOf(ana), bea, 41, t0 + 60_000, false);
    expect(d).toEqual({ kind: "blocked", hold: holdOf(ana) });
  });

  it("la misma asesora vuelve a abrir: se mantiene y NO se alarga", () => {
    const d = decideAcquire(holdOf(ana), ana, 41, t0 + 9 * 60_000, false);
    expect(d.kind).toBe("kept");
    expect(d.hold.expires_at).toBe(holdOf(ana).expires_at);
    // Ni siquiera con "abrir de todos modos" sobre la suya.
    expect(decideAcquire(holdOf(ana), ana, 41, t0 + 9 * 60_000, true).kind).toBe("kept");
  });

  it("vencida: cualquiera la toma de cero, también quien la tenía", () => {
    const after = t0 + LEAD_HOLD_MS;
    const otra = decideAcquire(holdOf(ana), bea, 41, after, false);
    expect(otra.kind).toBe("acquired");
    expect(otra.hold.holder_user_id).toBe(9);
    const misma = decideAcquire(holdOf(ana), ana, 41, after + 5_000, false);
    expect(misma.kind).toBe("acquired");
    expect(misma.hold.acquired_at).toBe(new Date(after + 5_000).toISOString());
  });

  it("supervisión quita la reserva vigente de otra persona", () => {
    const d = decideAcquire(holdOf(ana), bea, 41, t0 + 60_000, true);
    expect(d.kind).toBe("taken_over");
    if (d.kind !== "taken_over") throw new Error("esperaba taken_over");
    expect(d.previous.holder_user_id).toBe(7);
    expect(d.hold.holder_user_id).toBe(9);
  });

  it("vence justo a la hora indicada (no un milisegundo después)", () => {
    expect(holdActive(holdOf(ana), t0 + LEAD_HOLD_MS - 1)).toBe(true);
    expect(holdActive(holdOf(ana), t0 + LEAD_HOLD_MS)).toBe(false);
    expect(holdActive(holdOf(ana, t0, { expires_at: "no es fecha" }), t0)).toBe(false);
  });

  it("solo supervisión de Leads puede abrir de todos modos", () => {
    expect(canTakeOverHold(["leads", "leads_equipo"])).toBe(true);
    expect(canTakeOverHold(["leads"])).toBe(false);
    expect(canTakeOverHold(["leads", "leads_productividad"])).toBe(false);
  });
});

describe("Quién puede escribir en el lead", () => {
  it("otra persona con reserva vigente bloquea", () => {
    expect(blockingHold(holdOf(ana), 9, t0 + 1_000)?.holder_name).toBe("Ana Pérez");
  });
  it("sin fila, vencida o propia: se escribe como siempre", () => {
    expect(blockingHold(null, 9, t0)).toBeNull();
    expect(blockingHold(holdOf(ana), 9, t0 + LEAD_HOLD_MS)).toBeNull();
    expect(blockingHold(holdOf(ana), 7, t0 + 1_000)).toBeNull();
  });
});

describe("Textos y horas (zona de la tienda)", () => {
  it("el aviso dice quién, desde y hasta cuándo, con los minutos que faltan", () => {
    expect(blockedNoticeText(holdOf(ana), t0 + 3 * 60_000 + 30_000, CR)).toBe(
      "Este lead lo tiene abierto Ana Pérez desde las 14:05. Se libera a las 14:15 (en 7 min)."
    );
    expect(blockedNoticeText(holdOf(ana), t0 + LEAD_HOLD_MS - 20_000, CR)).toContain("(en 1 min)");
    expect(blockedNoticeText(holdOf(ana), t0 + LEAD_HOLD_MS, CR)).toBe(
      "Este lead lo tiene abierto Ana Pérez desde las 14:05. Se libera a las 14:15."
    );
  });

  it("24 horas y sin AM/PM; Honduras también con su zona", () => {
    expect(formatHoldTime("2026-11-28T06:07:00Z", CR)).toBe("00:07");
    expect(formatHoldTime("2026-11-28T20:05:00Z", "America/Tegucigalpa")).toBe("14:05");
    expect(formatHoldTime("x", CR)).toBe("--:--");
  });

  it("minutos que faltan: hacia arriba, nunca negativos", () => {
    expect(minutesLeft(new Date(t0 + 30_000).toISOString(), t0)).toBe(1);
    expect(minutesLeft(new Date(t0 + 600_000).toISOString(), t0)).toBe(10);
    expect(minutesLeft(new Date(t0 - 1).toISOString(), t0)).toBe(0);
    expect(minutesLeft("x", t0)).toBe(0);
  });

  it("indicador, vencimiento, pérdida y 409", () => {
    expect(heldByMeText(holdOf(ana), CR)).toBe("Lo tienes reservado hasta las 14:15");
    expect(HOLD_EXPIRED_TEXT).toBe("Tu reserva terminó: otra asesora ya puede abrir este lead");
    expect(holdLostText(holdOf(bea, t0 + LEAD_HOLD_MS), CR)).toBe(
      "Beatriz Mora abrió este lead a las 14:15: tus cambios ya no se guardan. Cierra la ficha."
    );
    expect(writeConflictText(holdOf(ana), t0, CR)).toMatch(/Ana Pérez.*No se guardó tu cambio\.$/);
  });

  it("primer nombre para el candado; sin nombre no queda vacío", () => {
    expect(holderFirstName("  Ana   Pérez ")).toBe("Ana");
    expect(holderFirstName("")).toBe("Otra persona");
    expect(blockedNoticeText(holdOf({ id: 3, name: " " }), t0, CR)).toContain("Otra persona");
  });
});

describe("El navegador no confía en la forma de la respuesta", () => {
  it("parseLeadHold rechaza filas incompletas", () => {
    expect(parseLeadHold(holdOf(ana))).toEqual(holdOf(ana));
    expect(parseLeadHold(null)).toBeNull();
    expect(parseLeadHold({ ...holdOf(ana), lead_id: "x" })).toBeNull();
    expect(parseLeadHold({ ...holdOf(ana), expires_at: "mañana" })).toBeNull();
    expect(parseLeadHold({ ...holdOf(ana), holder_user_id: -1 })).toBeNull();
  });

  it("acquire: bloqueado solo con reserva válida; cualquier otra cosa abre (falla suave)", () => {
    const serverNow = new Date(Date.now() + 5_000).toISOString();
    const b = parseAcquireResponse(true, { status: "blocked", hold: holdOf(ana), can_take_over: true, server_now: serverNow });
    expect(b.kind).toBe("blocked");
    if (b.kind === "blocked") {
      expect(b.canTakeOver).toBe(true);
      expect(Math.abs(b.offsetMs - 5_000)).toBeLessThan(1_000);
    }
    expect(parseAcquireResponse(true, { status: "held", hold: holdOf(ana) })).toMatchObject({ kind: "open", hold: holdOf(ana) });
    expect(parseAcquireResponse(true, { status: "unavailable" })).toEqual({ kind: "open", hold: null, offsetMs: 0 });
    expect(parseAcquireResponse(true, { status: "blocked", hold: { roto: true } })).toEqual({ kind: "open", hold: null, offsetMs: 0 });
    expect(parseAcquireResponse(false, { error: "x" })).toEqual({ kind: "open", hold: null, offsetMs: 0 });
  });

  it("consulta al vencer: otra persona, libre o sin datos", () => {
    expect(parseCheckResponse(true, { status: "other", hold: holdOf(bea) }).status).toBe("other");
    expect(parseCheckResponse(true, { status: "free" }).status).toBe("free");
    expect(parseCheckResponse(true, { status: "other" }).status).toBe("unavailable");
    expect(parseCheckResponse(false, null).status).toBe("unavailable");
  });
});

describe("Aviso de lead ocupado (modal)", () => {
  const render = (props: Partial<Parameters<typeof LeadHoldNotice>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(LeadHoldNotice, {
        hold: holdOf(ana),
        timeZone: CR,
        now: t0 + 3 * 60_000,
        freed: false,
        canTakeOver: false,
        onClose: () => undefined,
        onOpen: () => undefined,
        onTakeOver: () => undefined,
        ...props,
      })
    );
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  it("dice quién lo tiene, desde y hasta cuándo; la asesora solo tiene Entendido", () => {
    const html = render();
    expect(html).toContain('<strong class="font-semibold text-foreground">Ana Pérez</strong>');
    expect(text(html)).toContain("Este lead lo tiene abierto Ana Pérez desde las 14:05. Se libera a las 14:15 (en 7 min).");
    expect(text(html)).toContain("Entendido");
    expect(html).not.toContain("Abrir de todos modos");
  });

  it("supervisión ve Abrir de todos modos y lo que significa", () => {
    const html = render({ canTakeOver: true });
    expect(html).toContain("Abrir de todos modos");
    expect(text(html)).toContain("Ana ya no podrá guardar cambios");
  });

  it("si se liberó con el aviso abierto, deja abrirlo", () => {
    const html = render({ freed: true, canTakeOver: true, now: t0 + LEAD_HOLD_MS + 2_000 });
    expect(text(html)).toContain("Este lead ya está libre");
    expect(text(html)).toContain("La reserva de Ana Pérez terminó a las 14:15. Ya puedes abrirlo.");
    expect(html).toContain("Abrir lead");
    expect(html).not.toContain("Abrir de todos modos");
  });
});

describe("La migración aplica las mismas reglas", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261128120000_lead_holds.sql", import.meta.url), "utf8");
  it("toma atómica: on conflict … where vencida o supervisión sobre otra persona", () => {
    expect(sql).toMatch(/on conflict on constraint lead_holds_pkey do update set/);
    expect(sql).toMatch(/where h\.expires_at <= stamp\s+or \(p_takeover and h\.holder_user_id <> p_user_id\)/);
  });
  it("el TTL de la app cabe en el que acepta la función; solo service role", () => {
    expect(LEAD_HOLD_TTL_SECONDS).toBeGreaterThanOrEqual(60);
    expect(LEAD_HOLD_TTL_SECONDS).toBeLessThanOrEqual(3600);
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/revoke all on function public\.lead_hold_acquire[\s\S]*from public, anon, authenticated/);
    expect(sql).toContain("set search_path = ''");
  });
});
