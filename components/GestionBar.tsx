"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Undo2 } from "lucide-react";
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
  // La gestion que se acaba de registrar, para poder deshacerla. Se guarda el
  // id de ESA fila y no "la ultima": entre el clic equivocado y el clic en
  // Deshacer la ultima pudo cambiar.
  const [undoableCallId, setUndoableCallId] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
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
      setUndoableCallId(typeof data.call_id === "number" ? data.call_id : null);
      setUndone(false);
      setNote("");
      setFollowupAt("");
      onDone(status);
      // 30 s y no 4: este mensaje ahora lleva colgado el unico "Deshacer" de
      // la pantalla, y cuatro segundos no alcanzan para darse cuenta de que se
      // apreto el boton equivocado, leerlo y decidir. El servidor acepta
      // deshacer hasta 10 minutos despues, asi que la oferta nunca miente.
      setTimeout(() => {
        setSavedStatus(null);
        setSavedFollowup(null);
        setUndoableCallId(null);
      }, 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al gestionar");
    } finally {
      setSaving(null);
    }
  }

  async function undo(callId: number) {
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/disposition/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, vendedora_id: vendedoraId, call_id: callId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al deshacer");
      setUndone(true);
      setUndoableCallId(null);
      setSavedFollowup(null);
      // Refrescar el historial y el tablero: el lead volvio a su estado
      // anterior y probablemente vuelve a la cola de hoy.
      onDone(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al deshacer");
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">Resultado de la llamada</p>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {undone && !savedStatus && (
        <p className="text-xs text-muted-foreground" role="status">
          Gestión deshecha: el lead volvió a como estaba.
        </p>
      )}
      {savedStatus && (
        <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-emerald-400" role="status">
          <Check className="h-3 w-3" /> {undone ? "Deshecho" : "Guardado"}
          {savedFollowup && !undone && (
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
          {/* El unico Deshacer de la pantalla.
              Gestionar escribe siete campos del lead con un clic sin
              confirmar —y el desplegable de 19 estados lo hace con `onChange`,
              o sea que navegarlo con el teclado ya compromete el estado,
              `lista_negra` incluido—. La salida tiene que estar donde ella
              esta mirando: pegada al "Guardado", no en un menu. */}
          {undoableCallId != null && !undone && (
            <button
              type="button"
              onClick={() => undo(undoableCallId)}
              disabled={undoing}
              className="ml-1 inline-flex h-6 items-center gap-1 border border-border px-2 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
            >
              {undoing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              Deshacer
            </button>
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
