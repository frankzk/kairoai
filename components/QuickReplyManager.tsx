"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { renderQuickReply, type QuickReply } from "@/lib/quick-replies-format";

// Popup de respuestas rapidas: buscar, usar (insertar en el composer), enviar
// directo, crear, editar y borrar. Se abre desde el composer del drawer.
export default function QuickReplyManager({
  store,
  storeLabel,
  leadName,
  replies,
  loading,
  onClose,
  onUse,
  onSend,
  onChanged,
}: {
  store: string;
  storeLabel: string;
  leadName: string | null;
  replies: QuickReply[];
  loading: boolean;
  onClose: () => void;
  /** Inserta el texto en el composer para editarlo antes de enviar. */
  onUse: (reply: QuickReply, rendered: string) => void;
  /** Envia el mensaje de una vez, sin pasar por el composer. */
  onSend: (reply: QuickReply, rendered: string) => Promise<void>;
  /** Recarga la lista tras crear/editar/borrar. */
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const vars = { nombre: leadName, tienda: storeLabel };
  const q = search.trim().toLowerCase();
  const filtered = q
    ? replies.filter(
        (r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)
      )
    : replies;

  function startNew() {
    setEditingId("new");
    setTitle("");
    setBody("");
    setError(null);
  }
  function startEdit(reply: QuickReply) {
    setEditingId(reply.id);
    setTitle(reply.title);
    setBody(reply.body);
    setError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setTitle("");
    setBody("");
  }

  async function save() {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setError("Nombre y mensaje son obligatorios.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const res = await fetch(isNew ? "/api/quick-replies" : `/api/quick-replies/${editingId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, title: t, body: b }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al guardar");
      cancelEdit();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function remove(reply: QuickReply) {
    if (!window.confirm(`¿Borrar la respuesta "${reply.title}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/quick-replies/${reply.id}?store=${store}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al borrar");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al borrar");
    } finally {
      setBusy(false);
    }
  }

  async function sendNow(reply: QuickReply) {
    setSendingId(reply.id);
    setError(null);
    try {
      await onSend(reply, renderQuickReply(reply.body, vars));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-replies-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 id="quick-replies-title" className="text-base font-semibold">
              Respuestas rápidas
            </h3>
            <p className="text-xs text-muted-foreground">
              Usar inserta el texto para editarlo; Enviar lo manda de una.{" "}
              <code className="rounded bg-muted px-1">{"{nombre}"}</code> se reemplaza por el del cliente.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        <div className="mb-3 flex gap-2">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar respuesta…"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={startNew}
            disabled={busy}
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nueva
          </button>
        </div>

        {editingId != null && (
          <div className="mb-3 space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nombre corto (ej. Precio, Envío, Garantía)"
              maxLength={40}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Mensaje… puedes usar {nombre} y {tienda}"
              className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                Guardar
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={busy}
                className="h-8 rounded-md border border-border px-3 text-xs hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? "Sin resultados." : "Aún no hay respuestas rápidas. Creá la primera con “Nueva”."}
            </p>
          ) : (
            filtered.map((reply) => (
              <div key={reply.id} className="rounded-md border border-border bg-background p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {reply.title}
                      {reply.usage_count > 0 && (
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                          usada {reply.usage_count}×
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                      {renderQuickReply(reply.body, vars)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onUse(reply, renderQuickReply(reply.body, vars))}
                      className="h-7 rounded-md border border-border px-2 text-xs hover:bg-accent"
                      title="Insertar en el mensaje para editarlo"
                    >
                      Usar
                    </button>
                    <button
                      type="button"
                      onClick={() => sendNow(reply)}
                      disabled={sendingId != null}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      title="Enviar ahora por WhatsApp"
                    >
                      {sendingId === reply.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      Enviar
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(reply)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                      title="Editar"
                      aria-label={`Editar ${reply.title}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(reply)}
                      disabled={busy}
                      className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      title="Borrar"
                      aria-label={`Borrar ${reply.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
