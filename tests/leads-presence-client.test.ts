import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLeadsPresence } from "../lib/leads-presence-client";

type Listener = (event: { isTrusted?: boolean }) => void;
function surface(extra: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    visibilityState: "visible",
    ...extra,
    addEventListener: (name: string, fn: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: Listener) => listeners.get(name)?.delete(fn),
    emit: (name: string, trusted = true) => { for (const fn of Array.from(listeners.get(name) ?? [])) fn({ isTrusted: trusted }); },
    count: () => Array.from(listeners.values()).reduce((n, s) => n + s.size, 0),
  };
}
let focus: boolean;
let win: ReturnType<typeof surface>;
let doc: ReturnType<typeof surface>;
let fetcher: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;
let clean: (() => void) | null;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const signals = () => fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] });
  focus = true;
  win = surface(); doc = surface({ visibilityState: "visible", hasFocus: () => focus });
  fetcher = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  beacon = vi.fn().mockReturnValue(true);
  vi.stubGlobal("window", win); vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { sendBeacon: beacon }); vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("crypto", { randomUUID: () => "7f1b3893-81d3-4893-8344-00c5164d8050" });
  clean = null;
});
afterEach(() => { clean?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Señales del navegador", () => {
  it("los latidos no renuevan la última interacción", async () => {
    clean = startLeadsPresence("mireva-cr", vi.fn()); await flush();
    await vi.advanceTimersByTimeAsync(150_000);
    expect(signals()[0]).toMatchObject({ activity_age_ms: 0, visible: true, closed: false });
    expect(signals().at(-1)).toMatchObject({ activity_age_ms: 150_000 });
    expect(signals()).toHaveLength(6);
  });
  it("una interacción real renueva la actividad; eventos sintéticos no", async () => {
    clean = startLeadsPresence("mireva-cr", vi.fn()); await flush();
    await vi.advanceTimersByTimeAsync(150_000);
    win.emit("keydown", false); await flush();
    await vi.advanceTimersByTimeAsync(6_000);
    win.emit("pointerdown"); await flush();
    expect(signals().at(-1)).toMatchObject({ activity_age_ms: 0 });
  });
  it("recuperar la red no inventa una interacción de la asesora", async () => {
    clean = startLeadsPresence("mireva-cr", vi.fn()); await flush();
    await vi.advanceTimersByTimeAsync(150_000);
    win.emit("online"); await flush();
    expect(signals().at(-1)).toMatchObject({ activity_age_ms: 150_000 });
  });
  it("estar en segundo plano conserva conexión, pero no actividad ni contenido", async () => {
    doc.visibilityState = "hidden"; focus = false;
    clean = startLeadsPresence("mireva-cr", vi.fn()); await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signals().at(-1)).toMatchObject({ visible: false, activity_age_ms: null });
    win.emit("keydown"); await flush();
    expect(signals()).toHaveLength(2);
    doc.visibilityState = "visible"; focus = true; doc.emit("visibilitychange"); await flush();
    expect(signals().at(-1)).toMatchObject({ visible: true, activity_age_ms: 0 });
    expect(Object.keys(signals().at(-1)).sort()).toEqual(["activity_age_ms", "closed", "sequence", "tab_id", "visible"]);
  });
  it("cierra la pestaña con secuencia posterior y se recupera del historial bfcache", async () => {
    clean = startLeadsPresence("mireva-cr", vi.fn()); await flush();
    win.emit("pagehide");
    const blob = beacon.mock.calls[0][1] as Blob;
    const closed = JSON.parse(await blob.text());
    expect(closed).toMatchObject({ sequence: 2, visible: false, closed: true });
    await vi.advanceTimersByTimeAsync(60_000); expect(signals()).toHaveLength(1);
    win.emit("pageshow"); await flush();
    expect(signals().at(-1)).toMatchObject({ sequence: 3, closed: false });
  });
  it("limpia escuchas y temporizadores al salir o cambiar de tienda", async () => {
    clean = startLeadsPresence("mireva-hn", vi.fn()); await flush();
    const stop = clean; clean = null; stop();
    expect(beacon.mock.calls[0][0]).toBe("/api/leads/presence?store=mireva-hn");
    expect(win.count()).toBe(0); expect(doc.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000); expect(signals()).toHaveLength(1);
  });
  it("avisa fallos de red y deja de escribir si la sesión ya no está autorizada", async () => {
    const failed = vi.fn();
    fetcher.mockRejectedValueOnce(new Error("offline"));
    clean = startLeadsPresence("mireva-cr", failed); await flush();
    expect(failed).toHaveBeenLastCalledWith(true);
    fetcher.mockResolvedValue({ ok: false, status: 401 });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
