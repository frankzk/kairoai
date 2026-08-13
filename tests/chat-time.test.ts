import { describe, expect, it } from "vitest";
import {
  chatDayKey,
  formatChatDayLabel,
  formatChatTime,
  hasChatTime,
  needsDaySeparator,
} from "../lib/chat-time";

// 12/08/2026 17:54 UTC = 11:54 a.m. en Costa Rica (UTC-6, sin horario de verano).
const MIERCOLES_1154 = Date.parse("2026-08-12T17:54:00Z");
const MIERCOLES_2030 = Date.parse("2026-08-12T20:30:00Z"); // 2:30 p.m. CR
const JUEVES_0015 = Date.parse("2026-08-13T06:15:00Z"); // 12:15 a.m. CR del jueves

describe("hasChatTime", () => {
  it("descarta lo que normalizeMessage no pudo parsear", () => {
    // icomfly-chat.ts deja 0 cuando el mensaje no trae fecha utilizable.
    expect(hasChatTime(0)).toBe(false);
    expect(hasChatTime(null)).toBe(false);
    expect(hasChatTime(undefined)).toBe(false);
    expect(hasChatTime(Number.NaN)).toBe(false);
    expect(hasChatTime(MIERCOLES_1154)).toBe(true);
  });
});

describe("formatChatTime", () => {
  it("da la hora local compacta, como la muestra iComfly", () => {
    expect(formatChatTime(MIERCOLES_1154)).toBe("11:54 a.m.");
    expect(formatChatTime(MIERCOLES_2030)).toBe("2:30 p.m.");
  });

  it("cruza bien la medianoche local", () => {
    expect(formatChatTime(JUEVES_0015)).toBe("12:15 a.m.");
  });

  it("no inventa una hora cuando no hay fecha", () => {
    expect(formatChatTime(0)).toBe("");
    expect(formatChatTime(null)).toBe("");
  });
});

describe("chatDayKey", () => {
  it("agrupa por dia local, no por dia UTC", () => {
    // 06:15 UTC del jueves sigue siendo miercoles en Costa Rica.
    expect(chatDayKey(JUEVES_0015)).toBe("2026-08-13");
    expect(chatDayKey(Date.parse("2026-08-13T05:00:00Z"))).toBe("2026-08-12");
  });

  it("devuelve vacio sin fecha", () => {
    expect(chatDayKey(0)).toBe("");
  });
});

describe("formatChatDayLabel", () => {
  it("usa Hoy y Ayer relativos al momento dado", () => {
    expect(formatChatDayLabel(MIERCOLES_1154, MIERCOLES_2030)).toBe("Hoy");
    expect(formatChatDayLabel(MIERCOLES_1154, JUEVES_0015)).toBe("Ayer");
  });

  it("para fechas mas viejas da el dia sin año si es el mismo año", () => {
    const enero = Date.parse("2026-01-05T18:00:00Z");
    expect(formatChatDayLabel(enero, MIERCOLES_1154)).toBe("lun 5 ene");
  });

  it("incluye el año cuando es de otro año", () => {
    const anioPasado = Date.parse("2025-12-30T18:00:00Z");
    expect(formatChatDayLabel(anioPasado, MIERCOLES_1154)).toBe("30 dic 2025");
  });

  it("devuelve vacio sin fecha", () => {
    expect(formatChatDayLabel(0, MIERCOLES_1154)).toBe("");
  });
});

describe("needsDaySeparator", () => {
  it("marca el primer mensaje con fecha", () => {
    expect(needsDaySeparator(null, MIERCOLES_1154)).toBe(true);
  });

  it("no repite separador dentro del mismo dia", () => {
    expect(needsDaySeparator(MIERCOLES_1154, MIERCOLES_2030)).toBe(false);
  });

  it("separa cuando cambia el dia local", () => {
    expect(needsDaySeparator(MIERCOLES_2030, JUEVES_0015)).toBe(true);
  });

  it("un mensaje sin fecha no corta la conversacion", () => {
    expect(needsDaySeparator(MIERCOLES_1154, 0)).toBe(false);
  });

  it("tras un mensaje sin fecha, el siguiente con fecha si separa", () => {
    expect(needsDaySeparator(0, MIERCOLES_1154)).toBe(true);
  });
});
