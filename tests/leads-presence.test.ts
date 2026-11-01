import { describe, expect, it } from "vitest";
import { activityAgo, parsePresenceSignal, presenceDeadlines, presenceStatus, type PresenceTab } from "../lib/leads-presence";

const now = Date.parse("2026-10-31T15:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const tab = (changes: Partial<PresenceTab> = {}): PresenceTab => ({ last_seen_at: ago(0), last_activity_at: ago(0), visible: true, closed: false, ...changes });
const status = (tabs: PresenceTab[], at = now) => presenceStatus(presenceDeadlines(tabs, at), at);

describe("Presencia real en Leads", () => {
  it("distingue interacción reciente, página abierta sin interacción y falta de señal", () => {
    expect(status([tab()])).toBe("active");
    expect(status([tab({ last_activity_at: ago(120_000) })])).toBe("idle");
    expect(status([tab({ last_seen_at: ago(90_000) })])).toBe("offline");
    expect(status([])).toBe("offline");
  });
  it("una página oculta no hace activa a la persona aunque haya actividad reciente", () => {
    expect(status([tab({ visible: false })])).toBe("idle");
    expect(status([tab({ last_activity_at: null })])).toBe("idle");
  });
  it("cerrar una de varias pestañas no desconecta a la otra", () => {
    expect(status([tab({ closed: true }), tab()])).toBe("active");
    expect(status([tab({ closed: true })])).toBe("offline");
    expect(status([tab({ closed: true }), tab({ visible: false })])).toBe("idle");
  });
  it("un latido de segundo plano no prolonga la actividad de otra pestaña", () => {
    expect(status([tab({ last_seen_at: ago(90_000) }), tab({ visible: false })])).toBe("idle");
    expect(status([tab({ last_activity_at: ago(125_000) }), tab({ visible: false })])).toBe("idle");
  });
  it("los vencimientos permiten retirar el verde aunque deje de responder la API", () => {
    const row = presenceDeadlines([tab({ last_activity_at: ago(110_000) })], now);
    expect(presenceStatus(row, now + 10_000)).toBe("idle");
    expect(presenceStatus(row, now + 90_000)).toBe("offline");
  });
  it("nunca produce NaN, actividad negativa ni fechas inválidas en pantalla", () => {
    expect(status([tab({ last_seen_at: "invalid" })])).toBe("offline");
    expect(activityAgo(null, now)).toBe("Sin actividad registrada");
    expect(activityAgo("invalid", now)).toBe("Sin actividad registrada");
    expect(activityAgo(ago(-5_000), now)).toBe("hace menos de 1 min");
    expect(activityAgo(ago(180_000), now)).toBe("hace 3 min");
    expect(activityAgo(ago(3_900_000), now)).toBe("hace 1 h 5 min");
    expect(activityAgo(ago(172_800_000), now)).toBe("hace 2 días");
  });
});

const valid = { tab_id: "7f1b3893-81d3-4893-8344-00c5164d8050", sequence: 1, visible: true, closed: false, activity_age_ms: 50 };
describe("Validación de señales", () => {
  it("acepta edad relativa sin confiar en el reloj ni identidad del navegador", () => {
    expect(parsePresenceSignal({ ...valid, user_id: 999, vendedora: 24, last_activity_at: "2099-01-01" })).toEqual(valid);
    expect(parsePresenceSignal({ ...valid, activity_age_ms: null })?.activity_age_ms).toBeNull();
  });
  it.each([
    null, {}, { ...valid, sequence: 0 }, { ...valid, sequence: 1.5 }, { ...valid, sequence: 2 ** 32 },
    { ...valid, activity_age_ms: -1 }, { ...valid, activity_age_ms: "0" }, { ...valid, activity_age_ms: 43_200_001 },
    { ...valid, tab_id: "x" }, { ...valid, visible: "true" }, { ...valid, closed: null },
  ])("rechaza señales inválidas: %j", (input) => expect(parsePresenceSignal(input)).toBeNull());
});
