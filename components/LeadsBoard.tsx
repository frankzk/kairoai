"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, MessageSquare, Phone, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FINANCE_STORES, type FinanceStoreCode } from "@/lib/store-config";
import { useSelectedStore } from "@/lib/use-selected-store";
import { BOARD_VIEWS, type BoardStage } from "@/lib/leads-classify";

// Formato de presentacion CR: 506######## -> +506 6123-4567
function formatPhone(phone: string): string {
  if (/^506\d{8}$/.test(phone)) {
    const n = phone.slice(3);
    return `+506 ${n.slice(0, 4)}-${n.slice(4)}`;
  }
  return phone;
}

function PhoneWithCopy({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(phone);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard no disponible (contexto no seguro): ignora en silencio.
      }
    },
    [phone]
  );
  return (
    <span className="inline-flex items-center gap-1">
      <Phone className="h-3 w-3" />
      <span className="tabular-nums">{formatPhone(phone)}</span>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copiado" : "Copiar numero"}
        aria-label="Copiar numero"
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

const STAGE_META: Record<BoardStage, { label: string; variant: BadgeVariant; emoji: string }> = {
  pago_verificar: { label: "Pago por verificar", variant: "warning", emoji: "💰" },
  por_cerrar: { label: "Por cerrar", variant: "destructive", emoji: "🔥" },
  carrito: { label: "Carrito", variant: "info", emoji: "🛒" },
  seguimiento: { label: "Seguimiento", variant: "secondary", emoji: "💬" },
  frio: { label: "Frio", variant: "muted", emoji: "❄️" },
  ganado: { label: "Ganado", variant: "success", emoji: "✅" },
  descartado: { label: "Descartado", variant: "outline", emoji: "🚫" },
};

interface LeadRow {
  id: number;
  phone: string;
  name: string | null;
  status: string;
  category: string;
  status_source: "auto" | "manual";
  auto_reason: string | null;
  board_stage: BoardStage;
  labels: string[];
  last_message_text: string | null;
  last_message_sender: string | null;
  unread_count: number;
  chatbot_disabled: boolean;
  last_interaction_at: string | null;
  crm_conversation_id: string | null;
}

interface BoardCounts {
  total: number;
  byStage: Record<BoardStage, number>;
}

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  timestamp: number;
  text?: string;
  mediaKind?: string;
  mediaUrl?: string;
  caption?: string;
}

export default function LeadsBoard() {
  const [store, setStore] = useSelectedStore();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<BoardCounts | null>(null);
  const [activeStage, setActiveStage] = useState<BoardStage>("por_cerrar");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [drawerLead, setDrawerLead] = useState<LeadRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads?store=${store}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar leads");
      setLeads(data.leads ?? []);
      setCounts(data.counts ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar leads");
      setLeads([]);
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    load();
  }, [load]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al sincronizar");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }, [store, load]);

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads
      .filter((l) => l.board_stage === activeStage)
      .filter((l) =>
        q
          ? (l.name ?? "").toLowerCase().includes(q) ||
            l.phone.includes(q) ||
            (l.last_message_text ?? "").toLowerCase().includes(q)
          : true
      );
  }, [leads, activeStage, search]);

  const views = showHidden ? BOARD_VIEWS : BOARD_VIEWS.filter((v) => !v.hiddenByDefault);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-xl font-semibold">Leads de WhatsApp</h1>
          <div className="ml-auto flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={store}
              onChange={(e) => setStore(e.target.value as FinanceStoreCode)}
            >
              {FINANCE_STORES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button onClick={sync} disabled={syncing} size="sm">
              <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <Card className="mb-4 border-destructive/50">
            <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {/* Pestañas por bucket */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {views.map((v) => {
            const meta = STAGE_META[v.key];
            const count = counts?.byStage[v.key] ?? 0;
            const active = activeStage === v.key;
            return (
              <button
                key={v.key}
                onClick={() => setActiveStage(v.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className={`rounded-full px-1.5 text-xs ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>
                  {count}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showHidden ? "Ocultar ganados/descartados" : "Ver ganados/descartados"}
          </button>
        </div>

        <div className="mb-4">
          <Input
            placeholder="Buscar por nombre, telefono o mensaje..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <p className="py-12 text-center text-muted-foreground">Cargando...</p>
        ) : visibleLeads.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            No hay leads en esta etapa. {counts && counts.total === 0 ? "Pulsa Sincronizar para traer los chats de Icomfly." : ""}
          </p>
        ) : (
          <div className="space-y-2">
            {visibleLeads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onOpen={() => setDrawerLead(lead)} />
            ))}
          </div>
        )}
      </main>

      {drawerLead && (
        <LeadDrawer lead={drawerLead} store={store} onClose={() => setDrawerLead(null)} />
      )}
    </div>
  );
}

function LeadCard({ lead, onOpen }: { lead: LeadRow; onOpen: () => void }) {
  const meta = STAGE_META[lead.board_stage];
  return (
    <Card className="transition-colors hover:border-primary/50">
      <CardContent className="flex items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{lead.name || "Sin nombre"}</span>
            <Badge variant={meta.variant} className="shrink-0">
              {meta.emoji} {meta.label}
            </Badge>
            {lead.status_source === "manual" && (
              <Badge variant="outline" className="shrink-0">
                gestion manual
              </Badge>
            )}
            {lead.unread_count > 0 && (
              <Badge variant="info" className="shrink-0">
                {lead.unread_count} sin leer
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <PhoneWithCopy phone={lead.phone} />
            {lead.last_message_text && (
              <span className="truncate">· {lead.last_message_text}</span>
            )}
          </div>
          {lead.auto_reason && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{lead.auto_reason}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onOpen}>
          <MessageSquare className="mr-2 h-4 w-4" />
          Ver chat
        </Button>
      </CardContent>
    </Card>
  );
}

function LeadDrawer({
  lead,
  store,
  onClose,
}: {
  lead: LeadRow;
  store: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/leads/${lead.id}/messages?store=${store}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al leer el chat");
        if (alive) setMessages(data.messages ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Error al leer el chat");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [lead.id, store]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{lead.name || "Sin nombre"}</p>
            <div className="text-xs text-muted-foreground">
              <PhoneWithCopy phone={lead.phone} />
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {lead.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 border-b border-border p-3">
            {lead.labels.map((l) => (
              <Badge key={l} variant="muted" className="text-[10px]">
                {l}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {loading ? (
            <p className="text-center text-sm text-muted-foreground">Cargando chat...</p>
          ) : error ? (
            <p className="text-center text-sm text-destructive">{error}</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Sin mensajes.</p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.direction === "inbound"
                    ? "bg-muted"
                    : "ml-auto bg-primary text-primary-foreground"
                }`}
              >
                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                {m.mediaUrl && (
                  <p className="mt-1 text-xs italic opacity-80">[{m.mediaKind || "media"}]</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
