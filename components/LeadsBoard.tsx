"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CalendarRange,
  Check,
  Copy,
  MessageSquare,
  Phone,
  PhoneOff,
  RefreshCw,
  ShoppingCart,
  X,
} from "lucide-react";
import CreateOrderPanel from "@/components/CreateOrderPanel";
import GestionBar from "@/components/GestionBar";
import ProductivityPanel from "@/components/ProductivityPanel";
import LeadHistory from "@/components/LeadHistory";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FINANCE_STORES, type FinanceStoreCode } from "@/lib/store-config";
import { useSelectedStore } from "@/lib/use-selected-store";
import { BOARD_VIEWS, BOARD_STAGE_PRIORITY, type BoardStage } from "@/lib/leads-classify";
import {
  buildUncalledLeadSeries,
  isUncalledLeadOnDate,
  matchesLocalDateRange,
} from "@/lib/leads-metrics";

const UNCALLED_CHART_DAYS = 14;

// Fecha/hora del ultimo mensaje en hora CR (dd/mm hh:mm).
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// Formato de presentacion CR: 506######## -> +506 6123-4567
function formatPhone(phone: string): string {
  if (/^506\d{8}$/.test(phone)) {
    const n = phone.slice(3);
    return `+506 ${n.slice(0, 4)}-${n.slice(4)}`;
  }
  return phone;
}

function fmtDayLabel(dateKey: string, long = false): string {
  try {
    return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString("es-CR", {
      timeZone: "UTC",
      weekday: long ? "long" : "short",
      day: "numeric",
      month: long ? "long" : undefined,
    });
  } catch {
    return dateKey;
  }
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
      <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
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
  tibios: { label: "Tibios", variant: "warning", emoji: "🌡️" },
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
  next_followup_at: string | null;
  needs_attention: boolean;
  crm_conversation_id: string | null;
  first_seen_at: string | null;
  created_at: string;
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
  const [activeStage, setActiveStage] = useState<BoardStage | "agenda">("por_cerrar");
  const [search, setSearch] = useState("");
  const [interactionFrom, setInteractionFrom] = useState("");
  const [interactionTo, setInteractionTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showProductivity, setShowProductivity] = useState(false);
  const [includeOld, setIncludeOld] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [drawerLead, setDrawerLead] = useState<LeadRow | null>(null);
  const [selectedUncalledDate, setSelectedUncalledDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads?store=${store}${includeOld ? "&all=1" : ""}`);
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
  }, [store, includeOld]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedUncalledDate(null);
  }, [store]);

  const matchesSearch = useCallback(
    (l: LeadRow, q: string) =>
      q
        ? (l.name ?? "").toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          (l.last_message_text ?? "").toLowerCase().includes(q)
        : true,
    []
  );

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const hasInteractionRange = interactionFrom.length > 0 || interactionTo.length > 0;

  const matchesInteractionRange = useCallback(
    (lead: LeadRow) =>
      matchesLocalDateRange(lead.last_interaction_at, interactionFrom, interactionTo),
    [interactionFrom, interactionTo]
  );

  const rangeFilteredLeads = useMemo(
    () => (hasInteractionRange ? leads.filter(matchesInteractionRange) : leads),
    [hasInteractionRange, leads, matchesInteractionRange]
  );

  // Al buscar, los resultados son de TODAS las etapas (busqueda global).
  const searchMatches = useMemo(
    () => (searching ? rangeFilteredLeads.filter((l) => matchesSearch(l, q)) : []),
    [rangeFilteredLeads, q, searching, matchesSearch]
  );

  const matchesSelectedDate = useCallback(
    (lead: LeadRow) =>
      selectedUncalledDate == null ||
      isUncalledLeadOnDate(lead, selectedUncalledDate),
    [selectedUncalledDate]
  );

  const stagePriority = (stage: BoardStage) => {
    const i = BOARD_STAGE_PRIORITY.indexOf(stage);
    return i < 0 ? 99 : i;
  };

  const visibleLeads = useMemo(() => {
    if (searching) {
      return searchMatches
        .filter(matchesSelectedDate)
        .sort((a, b) => stagePriority(a.board_stage) - stagePriority(b.board_stage));
    }
    if (activeStage === "agenda") {
      return rangeFilteredLeads
        .filter((l) => l.next_followup_at != null)
        .filter(matchesSelectedDate)
        .sort((a, b) => (a.next_followup_at ?? "").localeCompare(b.next_followup_at ?? ""));
    }
    const byInteraction = (a: LeadRow, b: LeadRow) => {
      const cmp = (a.last_interaction_at ?? "").localeCompare(b.last_interaction_at ?? "");
      return sortDir === "desc" ? -cmp : cmp;
    };
    return rangeFilteredLeads
      .filter((l) => l.board_stage === activeStage)
      .filter(matchesSelectedDate)
      .sort(byInteraction);
  }, [rangeFilteredLeads, activeStage, searching, searchMatches, sortDir, matchesSelectedDate]);

  const chartContextLeads = useMemo(() => {
    if (searching) return searchMatches;
    if (activeStage === "agenda") return rangeFilteredLeads.filter((l) => l.next_followup_at != null);
    return rangeFilteredLeads.filter((l) => l.board_stage === activeStage);
  }, [activeStage, rangeFilteredLeads, searchMatches, searching]);

  const uncalledSeries = useMemo(() => {
    return buildUncalledLeadSeries(chartContextLeads, new Date(), UNCALLED_CHART_DAYS);
  }, [chartContextLeads]);

  const maxUncalled = Math.max(1, ...uncalledSeries.map((day) => day.count));
  const uncalledTotal = uncalledSeries.reduce((total, day) => total + day.count, 0);

  const facetedLeads = useMemo(() => {
    let result = searching ? searchMatches : rangeFilteredLeads;
    if (selectedUncalledDate) result = result.filter(matchesSelectedDate);
    return result;
  }, [matchesSelectedDate, rangeFilteredLeads, searchMatches, searching, selectedUncalledDate]);

  // Conteo por etapa: refleja los resultados de busqueda cuando hay query.
  const stageCount = (stage: BoardStage) =>
    searching || selectedUncalledDate || hasInteractionRange
      ? facetedLeads.filter((l) => l.board_stage === stage).length
      : counts?.byStage[stage] ?? 0;

  // Agenda: seguimientos programados y cuantos ya vencieron.
  const agenda = useMemo(() => {
    const now = Date.now();
    const scheduled = facetedLeads.filter((l) => l.next_followup_at != null);
    const due = scheduled.filter((l) => new Date(l.next_followup_at as string).getTime() <= now).length;
    return { total: scheduled.length, due };
  }, [facetedLeads]);

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
            <Button
              onClick={load}
              disabled={loading}
              size="sm"
              title="Los leads se sincronizan y afinan solos cada pocos minutos; esto refresca la vista"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Actualizando..." : "Actualizar"}
            </Button>
            <Button
              onClick={() => setShowProductivity((v) => !v)}
              size="sm"
              variant={showProductivity ? "default" : "outline"}
              title="Resumen de gestiones y pedidos por asesora"
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Productividad
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

        {showProductivity && <ProductivityPanel store={store} />}

        <Card className="mb-4 overflow-hidden border-border/80 bg-card/80">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-start gap-3 border-b border-border/70 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="mt-0.5 rounded-md border border-primary/25 bg-primary/10 p-2 text-primary">
                  <PhoneOff className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-medium">Leads sin llamar</h2>
                  <p className="text-xs text-muted-foreground">
                    Nuevos por día durante los últimos {UNCALLED_CHART_DAYS} días
                    {searching ? " en esta busqueda" : activeStage === "agenda" ? " en Agenda" : ` en ${STAGE_META[activeStage].label}`}.
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums text-foreground">{uncalledTotal}</p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">pendientes</p>
              </div>
            </div>

            <div className="overflow-x-auto px-3 pb-3 pt-4">
              <div
                className="grid min-w-[680px] grid-cols-[repeat(14,minmax(0,1fr))] gap-2"
                role="group"
                aria-label="Leads sin llamar por día"
              >
                {uncalledSeries.map((day) => {
                  const selected = selectedUncalledDate === day.date;
                  const barHeight = day.count === 0 ? 3 : Math.max(12, Math.round((day.count / maxUncalled) * 92));
                  return (
                    <button
                      key={day.date}
                      type="button"
                      disabled={day.count === 0}
                      aria-pressed={selected}
                      aria-label={`${day.count} lead${day.count === 1 ? "" : "s"} sin llamar el ${fmtDayLabel(day.date, true)}`}
                      onClick={() => setSelectedUncalledDate(selected ? null : day.date)}
                      className={`group flex h-40 flex-col items-center justify-end rounded-md border px-1 pb-1.5 pt-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        selected
                          ? "border-primary bg-primary/10"
                          : day.count > 0
                            ? "border-transparent hover:border-primary/35 hover:bg-accent/60"
                            : "cursor-default border-transparent opacity-45"
                      }`}
                    >
                      <span className={`mb-1 text-xs font-medium tabular-nums ${selected ? "text-primary" : "text-muted-foreground"}`}>
                        {day.count}
                      </span>
                      <span className="flex h-[92px] w-full items-end justify-center">
                        <span
                          className={`block w-full max-w-7 rounded-t-sm transition-[height,background-color] duration-200 ${
                            selected ? "bg-primary" : "bg-primary/55 group-hover:bg-primary/80"
                          }`}
                          style={{ height: `${barHeight}px` }}
                        />
                      </span>
                      <span className={`mt-1 text-[10px] capitalize ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                        {fmtDayLabel(day.date)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedUncalledDate && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-primary/5 px-4 py-2.5 text-xs">
                <span>
                  Mostrando <strong className="font-medium text-foreground">{visibleLeads.length}</strong> lead{visibleLeads.length === 1 ? "" : "s"} sin llamar del {fmtDayLabel(selectedUncalledDate, true)}.
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedUncalledDate(null)}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-primary hover:bg-primary/10"
                >
                  <X className="h-3.5 w-3.5" />
                  Quitar filtro
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Buscador + rango de última interacción */}
        <div className="mb-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <Input
              className="min-w-0 flex-1"
              placeholder="Buscar por nombre, telefono o mensaje... (en todas las etapas)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-input bg-background px-2 py-1 lg:flex-nowrap">
              <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Desde</span>
                <input
                  type="date"
                  aria-label="Fecha inicial de última interacción"
                  value={interactionFrom}
                  max={interactionTo || undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    setInteractionFrom(next);
                    if (next && interactionTo && next > interactionTo) setInteractionTo(next);
                  }}
                  className="h-7 w-[132px] rounded border border-input bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              <span className="text-muted-foreground/50" aria-hidden="true">—</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Hasta</span>
                <input
                  type="date"
                  aria-label="Fecha final de última interacción"
                  value={interactionTo}
                  min={interactionFrom || undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    setInteractionTo(next);
                    if (next && interactionFrom && next < interactionFrom) setInteractionFrom(next);
                  }}
                  className="h-7 w-[132px] rounded border border-input bg-card px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
              {hasInteractionRange && (
                <button
                  type="button"
                  onClick={() => {
                    setInteractionFrom("");
                    setInteractionTo("");
                  }}
                  aria-label="Quitar rango de última interacción"
                  title="Quitar rango"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {(searching || hasInteractionRange) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {searching
                ? `${visibleLeads.length} resultado${visibleLeads.length === 1 ? "" : "s"} en todas las etapas`
                : "Rango aplicado sobre la fecha de última interacción"}
              {hasInteractionRange && searching ? " · rango de última interacción aplicado" : ""}
              {" · los números de cada etapa muestran las coincidencias"}
            </p>
          )}
        </div>

        {/* Pestañas por bucket */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveStage("agenda")}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              activeStage === "agenda"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent"
            }`}
            title="Seguimientos programados (volver a llamar)"
          >
            <CalendarClock className="h-4 w-4" />
            <span>Agenda</span>
            {agenda.due > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                {agenda.due} hoy
              </span>
            )}
            <span
              className={`rounded-full px-1.5 text-xs ${
                activeStage === "agenda" ? "bg-primary-foreground/20" : "bg-muted"
              }`}
            >
              {agenda.total}
            </span>
          </button>
          {views.map((v) => {
            const meta = STAGE_META[v.key];
            const count = stageCount(v.key);
            const active = activeStage === v.key && !searching;
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
          <button
            onClick={() => setIncludeOld((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            title="Por defecto se ocultan leads con más de 30 días sin actividad"
          >
            {includeOld ? "Ocultar antiguos (+30 días)" : "Incluir antiguos (+30 días)"}
          </button>
        </div>

        {loading ? (
          <p className="py-12 text-center text-muted-foreground">Cargando...</p>
        ) : visibleLeads.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {searching
              ? "Sin resultados para la búsqueda."
              : selectedUncalledDate
                ? "No hay leads sin llamar para la fecha seleccionada en este filtro."
                : hasInteractionRange
                  ? "No hay leads con última interacción en este rango y etapa."
                  : "No hay leads en esta etapa."}
          </p>
        ) : (
          <>
            {!searching && activeStage !== "agenda" && (
              <div className="mb-2 flex justify-end">
                <button
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  title="Ordenar por fecha del último mensaje"
                >
                  Última interacción {sortDir === "desc" ? "↓ reciente primero" : "↑ antiguo primero"}
                </button>
              </div>
            )}
            <div className="space-y-2">
              {visibleLeads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} onOpen={() => setDrawerLead(lead)} />
              ))}
            </div>
          </>
        )}
      </main>

      {drawerLead && (
        <LeadDrawer
          lead={drawerLead}
          store={store}
          onClose={() => setDrawerLead(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

function FollowupBadge({ iso }: { iso: string }) {
  const overdue = new Date(iso).getTime() <= Date.now();
  const when = (() => {
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
  })();
  return (
    <Badge variant={overdue ? "destructive" : "warning"} className="shrink-0 gap-1">
      <CalendarClock className="h-3 w-3" />
      {overdue ? "Seguir hoy" : "Seguir"} · {when}
    </Badge>
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
            {lead.next_followup_at && <FollowupBadge iso={lead.next_followup_at} />}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <PhoneWithCopy phone={lead.phone} />
          </div>
          {lead.auto_reason && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{lead.auto_reason}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground" title="Fecha del último mensaje">
            {fmtDateTime(lead.last_interaction_at)}
          </span>
          <Button variant="outline" size="sm" onClick={onOpen}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Ver chat
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadDrawer({
  lead,
  store,
  onClose,
  onRefresh,
}: {
  lead: LeadRow;
  store: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrder, setShowOrder] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Al cargar el chat, mostrar el ULTIMO mensaje (scroll al fondo, como WhatsApp).
  useEffect(() => {
    if (!loading && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [loading, messages]);

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
        className={`flex h-full w-full flex-col border-l border-border bg-card transition-[max-width] ${
          showOrder ? "max-w-4xl" : "max-w-md"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{lead.name || "Sin nombre"}</p>
            <div className="text-xs text-muted-foreground">
              <PhoneWithCopy phone={lead.phone} />
            </div>
          </div>
          <Button size="sm" variant={showOrder ? "outline" : "default"} onClick={() => setShowOrder((v) => !v)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            {showOrder ? "Ocultar pedido" : "Crear pedido"}
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Dos columnas: chat (izquierda) + pedido (derecha) */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className={`flex min-h-0 flex-col ${showOrder ? "md:w-1/2 md:border-r md:border-border" : "w-full"}`}>
            {lead.labels.length > 0 && (
              <div className="flex flex-wrap gap-1 border-b border-border p-3">
                {lead.labels.map((l) => (
                  <Badge key={l} variant="muted" className="text-[10px]">
                    {l}
                  </Badge>
                ))}
              </div>
            )}
            <LeadHistory leadId={lead.id} store={store} refreshKey={historyKey} />
            <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
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
                    className={`max-w-[80%] select-text rounded-lg px-3 py-2 text-sm ${
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
            <GestionBar
              leadId={lead.id}
              store={store}
              onDone={() => {
                onRefresh();
                setHistoryKey((k) => k + 1);
              }}
            />
          </div>

          {showOrder && (
            <div className="min-h-0 flex-1 border-t border-border md:w-1/2 md:border-t-0">
              <CreateOrderPanel
                lead={{ id: lead.id, name: lead.name, phone: lead.phone }}
                store={store}
                onCreated={() => {
                  onRefresh();
                  setHistoryKey((k) => k + 1);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
