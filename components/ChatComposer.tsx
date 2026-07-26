"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";

const VENDEDORA_KEY = "kairo:leads-vendedora";

// Composer del drawer: escribir y enviar WhatsApp sin salir de Kairo. El
// mensaje sale por el mismo numero que usa el bot en Icomfly.
export default function ChatComposer({
  leadId,
  store,
  catalogUrl,
  onSent,
}: {
  leadId: number;
  store: string;
  catalogUrl?: string;
  onSent: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La asesora se elige en GestionBar; aca solo se lee la misma preferencia.
  useEffect(() => {
    setError(null);
  }, [leadId]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    const vendedoraId = Number(window.localStorage.getItem(VENDEDORA_KEY) || 0);
    if (!vendedoraId) {
      setError("Selecciona quién eres (abajo) antes de enviar.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, vendedora_id: vendedoraId, message: body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al enviar");
      setText("");
      onSent(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t border-border bg-card p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {catalogUrl && (
        <button
          type="button"
          disabled={sending}
          onClick={() => setText((t) => (t ? `${t}\n${catalogUrl}` : `Este es nuestro catálogo: ${catalogUrl}`))}
          className="rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          + Catálogo
        </button>
      )}
      <div className="flex items-end gap-2">
        <textarea
          rows={2}
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter hace salto de linea (como WhatsApp Web).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escribe un mensaje… (Enter envía, Shift+Enter salta línea)"
          className="min-h-[38px] flex-1 resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          title="Enviar por WhatsApp"
          aria-label="Enviar por WhatsApp"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
