"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Zap } from "lucide-react";
import QuickReplyManager from "@/components/QuickReplyManager";
import { renderQuickReply, type QuickReply } from "@/lib/quick-replies-format";
import { getVendedoraId } from "@/lib/vendedora";

const CHIP_COUNT = 4; // las mas usadas van visibles; el resto por "/" o el popup

// Composer del drawer: escribir y enviar WhatsApp sin salir de Kairo, con
// respuestas rapidas en tres niveles de acceso:
//   1. chips de las mas usadas (1 click inserta)
//   2. atajo "/" en el texto -> buscador filtrable con teclado
//   3. popup de gestion (crear / editar / borrar / enviar directo)
export default function ChatComposer({
  leadId,
  leadName,
  store,
  storeLabel,
  catalogUrl,
  compact = false,
  onSent,
}: {
  leadId: number;
  leadName: string | null;
  store: string;
  storeLabel: string;
  catalogUrl?: string;
  compact?: boolean;
  onSent: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(true);
  const [showManager, setShowManager] = useState(false);
  // Estado del autocompletado por "/": null = cerrado.
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const vars = useMemo(() => ({ nombre: leadName, tienda: storeLabel }), [leadName, storeLabel]);

  const loadReplies = useCallback(async () => {
    setLoadingReplies(true);
    try {
      const res = await fetch(`/api/quick-replies?store=${store}`);
      const data = await res.json();
      setReplies(data.replies ?? []);
    } catch {
      setReplies([]);
    } finally {
      setLoadingReplies(false);
    }
  }, [store]);

  useEffect(() => {
    loadReplies();
  }, [loadReplies]);

  useEffect(() => {
    setError(null);
  }, [leadId]);

  const slashMatches = useMemo(() => {
    if (slashQuery == null) return [];
    const q = slashQuery.trim().toLowerCase();
    const list = q
      ? replies.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q))
      : replies;
    return list.slice(0, 6);
  }, [replies, slashQuery]);

  // Envio real. `quickReplyId` solo alimenta el contador de uso.
  async function postMessage(message: string, quickReplyId?: number) {
    const vendedoraId = getVendedoraId();
    if (!vendedoraId) throw new Error("Selecciona quién eres (abajo) antes de enviar.");
    const res = await fetch(`/api/leads/${leadId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store,
        vendedora_id: vendedoraId,
        message,
        quick_reply_id: quickReplyId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al enviar");
    onSent(message);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await postMessage(body);
      setText("");
      setSlashQuery(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  // Envio directo desde el popup (sin pasar por el textarea).
  async function sendReplyNow(reply: QuickReply, rendered: string) {
    setSending(true);
    setError(null);
    try {
      await postMessage(rendered, reply.id);
      setShowManager(false);
      loadReplies();
    } finally {
      setSending(false);
    }
  }

  /** Inserta el texto de una respuesta en el composer (editable antes de enviar). */
  function insertReply(reply: QuickReply) {
    const rendered = renderQuickReply(reply.body, vars);
    setText((prev) => (prev.trim() ? `${prev.trim()}\n${rendered}` : rendered));
    setSlashQuery(null);
    setShowManager(false);
    textareaRef.current?.focus();
  }

  /** Reemplaza el "/consulta" que se esta escribiendo por la respuesta elegida. */
  function applySlashChoice(reply: QuickReply) {
    const rendered = renderQuickReply(reply.body, vars);
    setText((prev) => {
      const idx = prev.lastIndexOf("/");
      const before = idx >= 0 ? prev.slice(0, idx) : prev;
      return `${before}${rendered}`;
    });
    setSlashQuery(null);
    textareaRef.current?.focus();
  }

  function handleChange(value: string) {
    setText(value);
    // "/" al inicio o tras un espacio/salto abre el buscador; se cierra al
    // escribir un espacio o borrar la barra.
    const match = value.match(/(?:^|\s)\/([^\n/]*)$/);
    if (match) {
      setSlashQuery(match[1]);
      setSlashIndex(0);
    } else {
      setSlashQuery(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashQuery != null && slashMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applySlashChoice(slashMatches[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }
    // Enter envia; Shift+Enter hace salto de linea (como WhatsApp Web).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const chips = replies.slice(0, CHIP_COUNT);
  const chipClass = compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";

  return (
    <div className={`relative space-y-1.5 border-t border-border bg-card ${compact ? "p-2" : "p-3"}`}>
      {error && <p className={compact ? "text-[11px] text-destructive" : "text-xs text-destructive"}>{error}</p>}

      {/* Nivel 1: chips de las mas usadas + acceso al popup */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((reply) => (
          <button
            key={reply.id}
            type="button"
            disabled={sending}
            onClick={() => insertReply(reply)}
            title={renderQuickReply(reply.body, vars).slice(0, 160)}
            className={`rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 ${chipClass}`}
          >
            {reply.title}
          </button>
        ))}
        {catalogUrl && (
          <button
            type="button"
            disabled={sending}
            onClick={() =>
              setText((t) => (t ? `${t}\n${catalogUrl}` : `Este es nuestro catálogo: ${catalogUrl}`))
            }
            className={`rounded-full border border-border bg-background hover:bg-accent disabled:opacity-50 ${chipClass}`}
          >
            + Catálogo
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowManager(true)}
          className={`inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 ${chipClass}`}
          title="Ver todas, crear y editar respuestas rápidas (o escribe / en el mensaje)"
        >
          <Zap className="h-3 w-3" />
          Respuestas
        </button>
      </div>

      {/* Nivel 2: autocompletado con "/" */}
      {slashQuery != null && slashMatches.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 z-10 mb-1 overflow-hidden rounded-md border border-border bg-card shadow-lg">
          {slashMatches.map((reply, i) => (
            <button
              key={reply.id}
              type="button"
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => applySlashChoice(reply)}
              className={`block w-full px-3 py-2 text-left text-xs transition-colors ${
                i === slashIndex ? "bg-primary/10" : "hover:bg-muted/50"
              }`}
            >
              <span className="font-medium">{reply.title}</span>
              <span className="ml-2 text-muted-foreground">
                {renderQuickReply(reply.body, vars).slice(0, 70)}…
              </span>
            </button>
          ))}
          <p className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
            ↑↓ para elegir · Enter inserta · Esc cierra
          </p>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          disabled={sending}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje… (/ para respuestas rápidas · Enter envía)"
          className={`min-h-[38px] flex-1 resize-y rounded-md border border-input bg-background px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring ${compact ? "text-[11px]" : "text-xs"}`}
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

      {/* Nivel 3: popup de gestion */}
      {showManager && (
        <QuickReplyManager
          store={store}
          storeLabel={storeLabel}
          leadName={leadName}
          replies={replies}
          loading={loadingReplies}
          onClose={() => setShowManager(false)}
          onUse={(reply) => insertReply(reply)}
          onSend={sendReplyNow}
          onChanged={loadReplies}
        />
      )}
    </div>
  );
}
