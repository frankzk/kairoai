"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarRange, RefreshCw, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ProductivityTable, { type ProductivityTotals } from "@/components/ProductivityTable";
import { localDateKey, RANGE_LABELS, type RangeKey } from "@/lib/leads-metrics";
import { PRESENCE_OFFLINE_MS, PRESENCE_POLL_MS } from "@/lib/leads-presence";
import type { ConnectedProductivityRow } from "@/lib/leads-productivity-presence";

const RANGES: RangeKey[] = ["hoy", "ayer", "7d", "30d", "mes"];
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";

export default function ProductivityPanel({ store }: { store: string }) {
  const [range, setRange] = useState<RangeKey>("hoy");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const custom = Boolean(fromDate || toDate);
  const today = localDateKey(new Date()) ?? undefined;
  const [rows, setRows] = useState<ConnectedProductivityRow[]>([]);
  const [totals, setTotals] = useState<ProductivityTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const clock = useRef({ server: 0, local: 0 });
  const request = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    request.current += 1;
    pending.current?.abort();
    pending.current = null;
  }, []);

  const load = useCallback(async (foreground = true) => {
    const id = ++request.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    if (foreground) setLoading(true);
    try {
      const params = new URLSearchParams({ store });
      if (custom) {
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
      } else params.set("range", range);
      const res = await fetch(`/api/leads/productivity?${params}`, { cache: "no-store", signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar la productividad.");
      if (!Array.isArray(data.rows) || !Number.isFinite(Date.parse(data.server_time))) throw new Error("Respuesta de productividad incompleta.");
      if (id !== request.current) return;
      clock.current = { server: Date.parse(data.server_time), local: performance.now() };
      setNow(clock.current.server);
      setRows(data.rows);
      setTotals(data.totals ?? null);
      setError(null);
    } catch (err) {
      if (id === request.current) setError(err instanceof Error && err.name !== "AbortError" ? err.message : "La consulta tardó demasiado. Reintentando…");
    } finally {
      clearTimeout(timeout);
      if (id === request.current) { pending.current = null; setLoading(false); }
    }
  }, [store, range, custom, fromDate, toDate]);

  useEffect(() => {
    setRows([]); setTotals(null); setError(null); clock.current = { server: 0, local: 0 };
    void load();
    const resume = () => { if (document.visibilityState === "visible" && !pending.current) void load(false); };
    const poll = setInterval(resume, PRESENCE_POLL_MS);
    const tick = setInterval(() => {
      if (clock.current.server) setNow(clock.current.server + performance.now() - clock.current.local);
    }, 5_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      cancel();
      clearInterval(poll); clearInterval(tick);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [load, cancel]);

  const stale = Boolean(error) || Boolean(clock.current.server && now - clock.current.server > PRESENCE_OFFLINE_MS);
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-sm font-semibold">Productividad</h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Período de productividad">
            {RANGES.map((r) => <button key={r} type="button" onClick={() => { setRange(r); setFromDate(""); setToDate(""); }}
              aria-pressed={!custom && range === r}
              className={`border px-2 py-1 text-xs transition-colors ${FOCUS} ${!custom && range === r ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
              {RANGE_LABELS[r]}
            </button>)}
          </div>
          <div className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 ${custom ? "border-primary" : "border-input"}`}>
            <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Desde
              <input type="date" aria-label="Productividad: fecha inicial" value={fromDate} max={toDate || today}
                onChange={(e) => { const next = e.target.value; setFromDate(next); if (next && toDate && next > toDate) setToDate(next); }}
                className={`h-6 w-[128px] rounded-sm bg-background px-1 text-xs text-foreground ${FOCUS}`} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Hasta
              <input type="date" aria-label="Productividad: fecha final" value={toDate} min={fromDate || undefined} max={today}
                onChange={(e) => { const next = e.target.value; setToDate(next); if (next && fromDate && next < fromDate) setFromDate(next); }}
                className={`h-6 w-[128px] rounded-sm bg-background px-1 text-xs text-foreground ${FOCUS}`} />
            </label>
            {custom ? <button type="button" onClick={() => { setFromDate(""); setToDate(""); }} aria-label="Quitar rango de fechas" className={`inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground ${FOCUS}`}><X className="h-3.5 w-3.5" /></button> : null}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={`ml-auto inline-flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 ${FOCUS}`}>
            <RefreshCw className={`h-3 w-3 ${loading ? "motion-safe:animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
          <p>Solo personas conectadas a Leads en el período. El foco indica su estado actual.</p>
          {rows.length ? <span>{rows.length} {rows.length === 1 ? "persona" : "personas"}</span> : null}
        </div>
        {error ? <p role="status" className="mb-3 text-xs text-amber-300">{error}</p> : null}
        <ProductivityTable rows={rows} totals={totals} now={now} loading={loading} stale={stale} />
      </CardContent>
    </Card>
  );
}
