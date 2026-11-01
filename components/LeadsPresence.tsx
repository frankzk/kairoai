"use client";

import { useEffect, useState } from "react";
import { activityAgo, presenceStatus, PRESENCE_POLL_MS, PRESENCE_OFFLINE_MS, type PresenceRow } from "@/lib/leads-presence";
import { startLeadsPresence } from "@/lib/leads-presence-client";

const STATUS = {
  active: { label: "Activa", color: "bg-emerald-400", text: "text-emerald-300" },
  idle: { label: "Inactiva", color: "bg-amber-400", text: "text-amber-300" },
  offline: { label: "Desconectada", color: "bg-slate-500", text: "text-muted-foreground" },
};

export default function LeadsPresence({ store }: { store: string }) {
  const [rows, setRows] = useState<PresenceRow[] | null>(null);
  const [team, setTeam] = useState(false);
  const [readError, setReadError] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [clock, setClock] = useState({ server: 0, local: 0, elapsed: 0 });

  useEffect(() => startLeadsPresence(store, setWriteError), [store]);
  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    let anchor = { server: 0, local: 0 };
    const load = async () => {
      if (disposed || pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const res = await fetch(`/api/leads/presence?store=${encodeURIComponent(store)}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.server_time))) throw new Error();
        if (disposed) return;
        anchor = { server: Date.parse(data.server_time), local: performance.now() };
        setRows(data.rows);
        setTeam(data.team === true);
        setReadError(false);
        setClock({ ...anchor, elapsed: 0 });
      } catch { if (!disposed) setReadError(true); }
      finally { clearTimeout(timeout); pending = false; }
    };
    const resume = () => { if (document.visibilityState === "visible") void load(); };
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load(); }, PRESENCE_POLL_MS);
    const tick = setInterval(() => {
      if (anchor.server) setClock({ ...anchor, elapsed: performance.now() - anchor.local });
    }, 5_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void load();
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [store]);

  const now = clock.server + clock.elapsed;
  const stale = readError || clock.elapsed > PRESENCE_OFFLINE_MS;
  const activeCount = (rows ?? []).filter((r) => presenceStatus(r, now) === "active").length;
  return (
    <section aria-label="Presencia en Leads" className="mb-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{team ? "Equipo en Leads" : "Tu actividad en Leads"}</h2>
        <span className="text-xs text-muted-foreground">{rows && !stale ? `${activeCount} activa${activeCount === 1 ? "" : "s"} · actualización cada 15 s` : "Consultando presencia…"}</span>
      </div>
      {(readError || writeError || stale && rows !== null) && <p role="status" className="mt-2 text-xs text-amber-300">{stale ? "No se pudo actualizar la presencia. Los estados están sin confirmar; reintentando…" : "No se pudo enviar tu señal de presencia; reintentando…"}</p>}
      {rows === null ? <p className="mt-3 text-xs text-muted-foreground">Cargando equipo…</p> : rows.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">No hay usuarios individuales de Leads para esta tienda.</p> : (
        <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const status = STATUS[presenceStatus(row, now)];
            return (
              <li key={row.user_id} className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${stale ? "bg-slate-500" : status.color}`} />
                  <span className="truncate font-medium" title={row.name}>{row.name}</span>
                  <span className={`ml-auto shrink-0 text-xs ${stale ? "text-muted-foreground" : status.text}`}>{stale ? "Sin confirmar" : status.label}</span>
                </div>
                <p className="mt-1 pl-4 text-xs text-muted-foreground" title={row.last_activity_at ? new Date(row.last_activity_at).toLocaleString("es-CR") : undefined}>
                  {row.last_activity_at ? `Última actividad: ${activityAgo(row.last_activity_at, now)}` : "Sin actividad registrada en Leads"}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Activa: interacción en los últimos 2 min y Leads visible. Inactiva: abierta sin interacción reciente o en segundo plano. Desconectada: cerrada o sin señal durante 90 s.</p>
    </section>
  );
}
