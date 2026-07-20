"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DISPOSITION_OPTIONS, DISPOSITION_QUICK } from "@/lib/leads-classify";

const VENDEDORA_KEY = "kairo:leads-vendedora";

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
  const [saving, setSaving] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/finance/payroll-staff`);
        const data = await res.json();
        const list: Staff[] = (data.staff ?? []).filter((s: Staff) => s.active !== false);
        setStaff(list);
        const saved = Number(window.localStorage.getItem(VENDEDORA_KEY));
        if (saved && list.some((s) => s.id === saved)) setVendedoraId(saved);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const selectVendedora = (id: number) => {
    setVendedoraId(id);
    try {
      window.localStorage.setItem(VENDEDORA_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  async function register(status: string) {
    if (!status) return;
    if (!vendedoraId) {
      setError("Selecciona quien eres antes de gestionar.");
      return;
    }
    setSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/disposition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, vendedora_id: vendedoraId, status, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al gestionar");
      setSavedStatus(status);
      setNote("");
      onDone(status);
      setTimeout(() => setSavedStatus(null), 2500);
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
    </div>
  );
}
