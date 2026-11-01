import { MAX_ACTIVITY_AGE_MS, PRESENCE_HEARTBEAT_MS, PRESENCE_IDLE_MS, type PresenceSignal } from "./leads-presence";

/** Mount once per board/store. No content, keystrokes or customer data is sent. */
export function startLeadsPresence(store: string, onFailure: (failed: boolean) => void): () => void {
  const url = `/api/leads/presence?store=${encodeURIComponent(store)}`;
  const tabId = crypto.randomUUID();
  let sequence = 0;
  let stopped = false;
  let authorized = true;
  let pending = false;
  let pageClosed = false;
  const visible = () => document.visibilityState === "visible" && document.hasFocus();
  // Opening/returning to Leads counts as activity, polling does not.
  let lastActivity: number | null = visible() ? performance.now() : null;
  let lastSent = -Infinity;
  const signal = (closed = false): PresenceSignal => ({
    tab_id: tabId, sequence: ++sequence, visible: visible() && !closed, closed,
    activity_age_ms: lastActivity === null ? null : Math.min(MAX_ACTIVITY_AGE_MS, Math.floor(performance.now() - lastActivity)),
  });
  const send = async () => {
    if (stopped || !authorized || pending || pageClosed) return;
    pending = true;
    lastSent = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signal()), cache: "no-store", signal: controller.signal });
      if (res.status === 401 || res.status === 403) authorized = false;
      if (!stopped) onFailure(!res.ok);
    } catch {
      if (!stopped) onFailure(true);
    } finally { clearTimeout(timeout); pending = false; }
  };
  const close = () => {
    if (pageClosed || !authorized) return;
    pageClosed = true;
    const body = JSON.stringify(signal(true));
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  };
  const activity = (event: Event) => {
    if (!event.isTrusted || !visible()) return;
    const wasIdle = lastActivity === null || performance.now() - lastActivity >= PRESENCE_IDLE_MS;
    lastActivity = performance.now();
    // Resume immediately after idling; throttle the rest and include the latest
    // interaction in the next heartbeat if the user stops before another event.
    if (wasIdle || performance.now() - lastSent >= 5_000) void send();
  };
  const visibility = () => {
    if (visible()) lastActivity = performance.now();
    void send();
  };
  const restore = () => { pageClosed = false; visibility(); };
  const reconnect = () => { void send(); };
  const events = ["pointerdown", "keydown", "scroll", "touchstart"];
  for (const event of events) window.addEventListener(event, activity, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", visibility);
  window.addEventListener("blur", visibility);
  window.addEventListener("pagehide", close);
  window.addEventListener("pageshow", restore);
  window.addEventListener("online", reconnect);
  const interval = setInterval(() => void send(), PRESENCE_HEARTBEAT_MS);
  void send();
  return () => {
    stopped = true;
    clearInterval(interval);
    for (const event of events) window.removeEventListener(event, activity, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", visibility);
    window.removeEventListener("blur", visibility);
    window.removeEventListener("pagehide", close);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("online", reconnect);
    close();
  };
}
