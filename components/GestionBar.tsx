"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DISPOSITION_OPTIONS, DISPOSITION_QUICK } from "@/lib/leads-classify";
import { getVendedoraId, setVendedoraId as persistVendedoraId } from "@/lib/vendedora";

interface Staff {
  id: number;
  name: string;
  active: boolean;
}

export default function GestionBar({
  leadId,
  store,
  onDone,
}: {
  leadId: number;
  store: string;
  onDone: (status: string) => void;
}) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [vendedoraId, setVendedoraId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // "Llamame el 1 de agosto": fecha de recontacto elegida por la asesora
  // (datetime-local, hora local del navegador). Vacio = regla por defecto.
  const [followupAt, setFollowupAt] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  // Fecha de recontacto que quedo agendada (custom o automatica), para que la
  // asesora vea que el reintento existe sin ir a la Agenda.
  const [savedFollowup, setSavedFollowup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/finance/payroll-staff`);
        const data = await res.json();
        const list: Staff[] = (data.staff ?? []).filter((s: Staff) => s.active !== false);
        setStaff(list);
        const saved = getVendedoraId();
        if (saved && list.some((s) => s.id === saved)) setVendedoraId(saved);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const selectVendedora = (id: number) => {
    setVendedoraId(id);
    persistVendedoraId(id);
  };

  async function register(status: string) {
    if (!status) return;
    if (!vendedoraId) {
      setError("Selecciona quien eres antes de gestionar.");
      return;
    }
    if (followupAt && new Date(followupAt).getTime() <= Date.now()) {
      setError("La fecha de recontacto debe ser a futuro.");
      return;
    }
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          vendedora_id: vendedoraId,
          status,
          note: note || undefined,
          next_followup_at: followupAt ? new Date(followupAt).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al gestionar");
      setSavedStatus(status);
      setSavedFollowup(data.next_followup_at ?? null);
      setNote("");
      setFollowupAt("");
      onDone(status);
      setTimeout(() => {
        setSavedStatus(null);
        setSavedFollowup(null);
      }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al gestionar");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-2 border-t border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">Resultado de la llamada</p>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {savedStatus && (
        <p className="flex items-center gap-1 text-xs text-emerald-400">
          <Check className="h-3 w-3" /> Guardado
          {savedFollowup && (
            <span className="text-muted-foreground">
              · reintento agendado el{" "}
              {new Date(savedFollowup).toLocaleString("es-CR", {
                timeZone: "America/Costa_Rica",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </p>
      )}

      {/* ¿Quien eres? */}
      <select
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={vendedoraId ?? ""}
        onChange={(e) => selectVendedora(Number(e.target.value))}
      >
        <option value="" disabled>
          ¿Quién eres? (asesora)
        </option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {/* Botones rapidos */}
      <div className="flex flex-wrap gap-1.5">
        {DISPOSITION_QUICK.map((d) => (
          <button
            key={d.code}
            disabled={saving != null}
            onClick={() => register(d.code)}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            {saving === d.code ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {d.label}
          </button>
        ))}
      </div>

      {/* Desplegable completo + nota */}
      <div className="flex gap-2">
        <select
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          value=""
          disabled={saving != null}
          onChange={(e) => register(e.target.value)}
        >
          <option value="">Más estados… (mantener estado)</option>
          {DISPOSITION_OPTIONS.map((d) => (
            <option key={d.code} value={d.code}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <Input
        className="h-8 text-xs"
        placeholder="Nota (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">Recontactar el</span>
        <input
          type="datetime-local"
          aria-label="Fecha y hora de recontacto"
          value={followupAt}
          onChange={(e) => setFollowupAt(e.target.value)}
          className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        />
        {followupAt && (
          <button
            type="button"
            onClick={() => setFollowupAt("")}
            className="text-muted-foreground hover:text-foreground"
            title="Quitar fecha"
          >
            ×
          </button>
        )}
      </label>
      {followupAt && (
        <p className="text-[10px] text-muted-foreground">
          Se agenda con la próxima gestión que registres y saldrá en la pestaña Agenda.
        </p>
      )}
    </div>
  );
}
