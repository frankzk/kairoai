"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { getStatusDef } from "@/lib/leads-classify";

interface HistoryRow {
  id: number;
  kind: string;
  new_status: string | null;
  note: string | null;
  vendedora_name: string | null;
  occurred_at: string;
}

const KIND_LABEL: Record<string, string> = {
  sale: "Pedido creado",
  state_change: "Cambio de estado",
  call: "Llamada",
  note: "Nota",
  system: "Sistema",
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// key para forzar recarga cuando cambia (p.ej. tras una gestion)
export default function LeadHistory({
  leadId,
  store,
  refreshKey = 0,
}: {
  leadId: number;
  store: string;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/${leadId}/history?store=${store}`);
        const data = await res.json();
        if (alive) setRows(data.history ?? []);
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leadId, store, refreshKey]);

  if (!loading && rows.length === 0) return null;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="h-3.5 w-3.5" />
        <span>Historial de gestiones{rows.length ? ` (${rows.length})` : ""}</span>
        {open ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="max-h-48 space-y-2 overflow-y-auto px-4 pb-3">
          {rows.map((r) => {
            const statusLabel = r.new_status ? getStatusDef(r.new_status)?.label ?? r.new_status : null;
            return (
              <div key={r.id} className="border-l-2 border-border pl-2 text-xs">
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span>{fmt(r.occurred_at)}</span>
                </div>
                {statusLabel && <div className="font-medium">{statusLabel}</div>}
                {r.vendedora_name && <div className="text-muted-foreground">por {r.vendedora_name}</div>}
                {r.note && <div className="italic text-muted-foreground/80">“{r.note}”</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
