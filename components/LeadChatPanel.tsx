"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import { Badge } from "@/components/ui/badge";
import {
  formatChatDayLabel,
  formatChatTime,
  needsDaySeparator,
} from "@/lib/chat-time";
import { FINANCE_STORES } from "@/lib/store-config";
import type { ChatLeadSummary, ConversationMessage } from "@/lib/leads-types";

function MediaAttachment({
  message,
  store,
  compact,
}: {
  message: ConversationMessage;
  store: string;
  compact: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!message.mediaUrl) return null;

  const src = `/api/leads/media?store=${store}&url=${encodeURIComponent(message.mediaUrl)}`;
  const kind = message.mediaKind ?? "media";
  const maxHeight = compact ? "max-h-48" : "max-h-64";

  if (failed || kind === "document") {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[11px] italic underline underline-offset-2 opacity-80"
      >
        [{kind}] abrir
      </a>
    );
  }
  if (kind === "image" || kind === "sticker") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element -- media efimera del chat, dimensiones desconocidas */}
        <img
          src={src}
          alt={message.caption || "Imagen del chat"}
          loading="lazy"
          onError={() => setFailed(true)}
          className={`${maxHeight} max-w-full rounded-md object-contain`}
        />
      </a>
    );
  }
  if (kind === "audio") {
    return (
      <div className="mt-1">
        <audio
          controls
          preload="metadata"
          src={src}
          onError={() => setFailed(true)}
          className="w-full min-w-48 max-w-full"
        />
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] underline underline-offset-2 opacity-70 hover:opacity-100"
        >
          abrir audio
        </a>
      </div>
    );
  }
  if (kind === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={src}
        onError={() => setFailed(true)}
        className={`mt-1 ${maxHeight} max-w-full rounded-md`}
      />
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mt-1 block text-[11px] italic underline underline-offset-2 opacity-80"
    >
      [{kind}] abrir
    </a>
  );
}

export default function LeadChatPanel({
  lead,
  store,
  compact = false,
  title,
  onActivity,
}: {
  lead: ChatLeadSummary;
  store: string;
  compact?: boolean;
  title?: string;
  onActivity?: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const loadMessages = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/messages?store=${store}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al leer el chat");
      if (requestId !== requestIdRef.current) return;
      setMessages(data.messages ?? []);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Error al leer el chat");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [lead.id, store]);

  useEffect(() => {
    setMessages([]);
    void loadMessages();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadMessages]);

  useEffect(() => {
    if (!loading && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [loading, messages]);

  const storeConfig = FINANCE_STORES.find((item) => item.code === store);
  const textSize = compact ? "text-xs" : "text-sm";

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label={title || "Chat de WhatsApp"}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide">{title}</h3>
              <p className="truncate text-[10px] text-muted-foreground">
                {lead.name || "Cliente"} · WhatsApp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadMessages()}
            disabled={loading}
            title="Actualizar conversación"
            aria-label="Actualizar conversación"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      )}

      {lead.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {lead.labels.map((label) => (
            <Badge key={label} variant="muted" className="text-[10px]">
              {label}
            </Badge>
          ))}
        </div>
      )}

      <div
        ref={chatScrollRef}
        className={`flex-1 space-y-2 overflow-y-auto ${compact ? "p-2.5" : "p-4"}`}
      >
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Cargando chat...</p>
        ) : error ? (
          <div className="space-y-2 py-6 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <button
              type="button"
              onClick={() => void loadMessages()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              Reintentar
            </button>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Sin mensajes.</p>
        ) : (
          messages.map((message, index) => {
            const time = formatChatTime(message.timestamp);
            const separator = needsDaySeparator(messages[index - 1]?.timestamp ?? null, message.timestamp)
              ? formatChatDayLabel(message.timestamp)
              : "";
            return (
              <Fragment key={message.id}>
                {separator && (
                  <p className="py-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
                    {separator}
                  </p>
                )}
                <div
                  className={`max-w-[88%] select-text rounded-lg ${
                    compact ? "px-2.5 py-1.5" : "px-3 py-2"
                  } ${textSize} ${
                    message.direction === "inbound"
                      ? "bg-muted"
                      : "ml-auto bg-primary text-primary-foreground"
                  }`}
                >
                  {message.text && (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
                  )}
                  {message.mediaUrl && (
                    <MediaAttachment message={message} store={store} compact={compact} />
                  )}
                  {message.caption && (
                    <p className="mt-0.5 text-[10px] opacity-80">{message.caption}</p>
                  )}
                  {time && (
                    <p
                      className={`mt-0.5 text-[10px] leading-none opacity-60 ${
                        message.direction === "inbound" ? "" : "text-right"
                      }`}
                    >
                      {time}
                    </p>
                  )}
                </div>
              </Fragment>
            );
          })
        )}
      </div>

      {lead.hasConversation ? (
        <ChatComposer
          leadId={lead.id}
          leadName={lead.name}
          store={store}
          storeLabel={storeConfig?.shortLabel ?? ""}
          catalogUrl={storeConfig?.catalogUrl}
          compact={compact}
          onSent={(text) => {
            setMessages((previous) => [
              ...previous,
              {
                id: `local-${Date.now()}`,
                direction: "outbound",
                timestamp: Date.now(),
                text,
              },
            ]);
            onActivity?.();
          }}
        />
      ) : (
        <p className="border-t border-border px-3 py-3 text-[11px] text-muted-foreground">
          Este lead no tiene una conversación enlazada en iComfly.
        </p>
      )}
    </section>
  );
}
