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
import ProductivityPanel from "@/components/ProductivityPanel";
import CustomerPanel from "@/components/CustomerPanel";
import LeadChatPanel from "@/components/LeadChatPanel";
import CallButton from "@/components/CallButton";
import { hideWebphone } from "@/lib/webphone";
import ZadarmaWebphone from "@/components/ZadarmaWebphone";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FINANCE_STORES, getFinanceStoreById, type FinanceStoreCode } from "@/lib/store-config";
import { useSelectedStore } from "@/lib/use-selected-store";
import {
  BOARD_STAGE_PRIORITY,
  getStatusDef,
  isNoAnswerStatus,
  schedulesFollowup,
  type BoardStage,
} from "@/lib/leads-classify";
import {
  boardFacets,
  SEGMENT_META,
  SEGMENT_ORDER,
  WORK_STATE_META,
  type LeadSegment,
  type LeadWorkState,
} from "@/lib/leads-segment";
import { buildWorkQueue, isTrabajoDeHoy, QUEUE_STAGES } from "@/lib/leads-queue";
import {
  buildUncalledLeadBuckets,
  isUncalledLeadOnDate,
  isUncalledLeadOlderThanWindow,
  matchesLocalDateRange,
} from "@/lib/leads-metrics";

const UNCALLED_CHART_DAYS = 14;

// Tarjetas por tanda. La asesora trabaja de arriba hacia abajo (la Cola ya
// viene en orden de atencion), asi que lo que importa es que la primera pantalla
// aparezca al instante; el resto se pide con "Mostrar mas".
const LEADS_PER_PAGE = 50;

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


// La fila de tabs responde UNA sola pregunta: que estoy mirando.
//
//   Hoy          lo que hay que llamar, ya ordenado (lib/leads-queue.ts)
//   Seguimiento  lo ya trabajado que no vence hoy: se busca y se filtra
//   Cerrado      adonde se fue lo que ya compro
//   Descartados  detras del toggle
//
// Antes habia SIETE tabs y varios se solapaban: Cola, Agenda y Por cerrar
// viven DENTRO de Sin llamar + En seguimiento, asi que ninguno de los numeros
// en pantalla contestaba "esto es lo que llamo hoy". Agenda y Por cerrar
// pasaron a ser los dos primeros grupos dentro de Hoy, que es donde se actuan.
type BoardTab = "hoy" | "seguimiento" | "cerrado" | "descartado";

const TAB_META: Record<BoardTab, { label: string; emoji: string; hint: string }> = {
  hoy: {
    label: "Hoy",
    emoji: "🎯",
    hint: "Pagos → recontactos vencidos → por cerrar → sin llamar (carrito primero)",
  },
  seguimiento: {
    label: "Seguimiento",
    emoji: "💬",
    hint: "Ya trabajados, sin recontacto pendiente para hoy",
  },
  cerrado: { label: "Cerrado", emoji: "✅", hint: "Ya tienen pedido" },
  descartado: { label: "Descartados", emoji: "🚫", hint: "Terminales" },
};

const TABS_VISIBLES: BoardTab[] = ["hoy", "seguimiento", "cerrado"];

// Color de la etiqueta segun cuanto convierte el segmento (ver la medicion en
// lib/leads-segment.ts): carrito 41,4% · enganchado 15,8% · converso 1,5% ·
// solo saludo 1,0%.
const SEGMENT_VARIANT: Record<LeadSegment, BadgeVariant> = {
  carrito: "info",
  enganchado: "destructive",
  converso: "secondary",
  solo_saludo: "muted",
};

interface LeadRow {
  id: number;
  store_id: number;
  phone: string;
  name: string | null;
  status: string;
  category: string;
  status_source: "auto" | "manual";
  auto_reason: string | null;
  board_stage: BoardStage;
  work_state: LeadWorkState;
  segment: LeadSegment;
  in_call_queue: boolean;
  labels: string[];
  last_message_text: string | null;
  last_message_sender: string | null;
  unread_count: number;
  chatbot_disabled: boolean;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  needs_attention: boolean;
  has_order: boolean;
  cart_value: number | null;
  cart_item_count: number | null;
  cart_summary: string | null;
  shopify_cart_open: boolean;
  shopify_draft_cart_count: number;
  crm_conversation_id: string | null;
  first_seen_at: string | null;
  created_at: string;
}

interface BoardCounts {
  total: number;
  byStage: Record<BoardStage, number>;
}

export default function LeadsBoard() {
  const [store, setStore] = useSelectedStore();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<BoardCounts | null>(null);
  const [activeStage, setActiveStage] = useState<BoardTab>("hoy");
  // Eje 2 (cuanta intencion). null = "Todos": filtra DENTRO del tab activo.
  const [activeSegment, setActiveSegment] = useState<LeadSegment | null>(null);
  const [search, setSearch] = useState("");
  const [interactionFrom, setInteractionFrom] = useState("");
  const [interactionTo, setInteractionTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showProductivity, setShowProductivity] = useState(false);
  const [includeOld, setIncludeOld] = useState(false);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [syncingShopifyCarts, setSyncingShopifyCarts] = useState(false);
  const [cartSyncMessage, setCartSyncMessage] = useState<string | null>(null);
  const [drawerLead, setDrawerLead] = useState<LeadRow | null>(null);
  const [selectedUncalledBucket, setSelectedUncalledBucket] = useState<string | null>(null);
  // Cerrados y Descartados se cargan aparte: son mas de la mitad de la tabla y
  // nadie los trabaja, asi que traerlos de entrada solo desplazaba de la
  // pantalla a los leads que si hay que llamar. null = todavia no se pidieron.
  const [archive, setArchive] = useState<LeadRow[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  // Lo que devolvio el servidor para la busqueda actual. null = no se busco.
  const [searchResults, setSearchResults] = useState<LeadRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  // La busqueda exacta no encontro nada y lo que se muestra son telefonos
  // parecidos (un digito mal tecleado). Hay que decirlo o se leen como exactos.
  const [searchAproximado, setSearchAproximado] = useState(false);

  // El "ya lo pedi" vive en una ref, NO en el estado. Cuando dependia de
  // archiveLoading, ponerlo en true re-ejecutaba este efecto, su limpieza
  // cancelaba la peticion que acababa de salir, y la respuesta se descartaba
  // siempre: el archivo no llegaba nunca y la busqueda quedaba colgada.
  // `id` distingue la carga actual, para ignorar la respuesta de una peticion
  // vieja si mientras tanto se cambio de tienda o se refresco.
  const archivePedido = useRef({ id: 0, pedido: false });

  const load = useCallback(async () => {
    // Invalida el archivo de la carga anterior ANTES de pedir nada: lo que
    // venga en camino de la tienda vieja se descarta al llegar.
    archivePedido.current = { id: archivePedido.current.id + 1, pedido: false };
    setArchiveLoading(false);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads?store=${store}${includeOld ? "&all=1" : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar leads");
      setLeads(data.leads ?? []);
      setCounts(data.counts ?? null);
      setArchive(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar leads");
      setLeads([]);
      setCounts(null);
      setArchive(null);
    } finally {
      setLoading(false);
    }
  }, [store, includeOld]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedUncalledBucket(null);
    setCartSyncMessage(null);
  }, [store]);

  const syncShopifyCarts = useCallback(async () => {
    setSyncingShopifyCarts(true);
    setCartSyncMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/shopify/draft-orders?store=${store}`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Error al sincronizar Borradores de Shopify");
      }
      setCartSyncMessage(
        `${data.drafts_open ?? 0} borradores abiertos, ${data.leads_with_open_drafts ?? 0} clientes`
      );
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al sincronizar Borradores de Shopify"
      );
    } finally {
      setSyncingShopifyCarts(false);
    }
  }, [load, store]);

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

  // El archivo se trae la primera vez que hace falta de verdad: al abrir
  // Cerrados o Descartados, o al buscar (el buscador promete "en todas las
  // etapas", y sin esto solo miraba lo cargado).
  // El archivo ya NO se pide para buscar: la busqueda la resuelve Postgres
  // (ver el efecto de abajo). Solo hace falta para mirar esas dos pestañas.
  const needsArchive = activeStage === "cerrado" || activeStage === "descartado";

  /** El archivo hace falta y todavia no llego. La lista NO se bloquea por esto. */
  const esperandoArchivo = needsArchive && archive === null;

  // Busqueda contra toda la tabla de la tienda. El filtro en memoria sigue
  // existiendo y da resultados al instante sobre lo ya cargado; esto agrega lo
  // que no esta en pantalla: cerrados, descartados y cualquier cosa fuera de la
  // ventana de 30 dias. Antes eso exigia bajarse el archivo entero.
  useEffect(() => {
    if (!searching) {
      setSearchResults(null);
      setSearchAproximado(false);
      setSearchLoading(false);
      return;
    }
    const busqueda = q;
    let cancelado = false;
    setSearchLoading(true);
    // Espera a que la asesora termine de escribir el telefono.
    const t = setTimeout(() => {
      fetch(`/api/leads?store=${store}&q=${encodeURIComponent(busqueda)}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Error al buscar");
          if (!cancelado) {
            setSearchResults(data.leads ?? []);
            setSearchAproximado(Boolean(data.aproximado));
          }
        })
        .catch((err) => {
          if (!cancelado) {
            setError(err instanceof Error ? err.message : "Error al buscar");
            setSearchResults([]);
            setSearchAproximado(false);
          }
        })
        .finally(() => {
          if (!cancelado) setSearchLoading(false);
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [searching, q, store]);

  useEffect(() => {
    if (!needsArchive || archivePedido.current.pedido) return;
    const { id } = archivePedido.current;
    archivePedido.current = { id, pedido: true };
    const vigente = () => archivePedido.current.id === id;
    setArchiveLoading(true);
    fetch(`/api/leads?store=${store}&scope=archivo${includeOld ? "&all=1" : ""}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar cerrados");
        if (vigente()) setArchive(data.leads ?? []);
      })
      .catch((err) => {
        if (vigente()) {
          setError(err instanceof Error ? err.message : "Error al cargar cerrados");
          setArchive([]);
        }
      })
      .finally(() => {
        if (vigente()) setArchiveLoading(false);
      });
  }, [needsArchive, store, includeOld]);

  // Lo cargado + lo que sumen el archivo y la busqueda, sin repetir: un mismo
  // lead puede venir por dos caminos (esta en pantalla Y lo devolvio el
  // servidor), y se veria dos veces en la lista.
  const allLeads = useMemo(() => {
    const extra = [...(archive ?? []), ...(searchResults ?? [])];
    if (!extra.length) return leads;
    const porId = new Map(leads.map((l) => [l.id, l]));
    for (const lead of extra) if (!porId.has(lead.id)) porId.set(lead.id, lead);
    return Array.from(porId.values());
  }, [leads, archive, searchResults]);

  // Cuantas tarjetas se dibujan. Antes se dibujaban TODAS: con los contadores
  // arreglados la Cola pasa de unos cientos a 2.251 leads en Costa Rica y
  // Cerrados a 3.424, asi que el navegador se quedaba varios segundos armando
  // tarjetas que nadie iba a mirar y la lista no terminaba nunca de bajar.
  const [shownCount, setShownCount] = useState(LEADS_PER_PAGE);

  // Cada vez que cambia LO QUE se esta mirando, se vuelve a empezar por arriba:
  // si no, al saltar de una etapa larga a una corta quedaba abierta de mas.
  useEffect(() => {
    setShownCount(LEADS_PER_PAGE);
  }, [activeStage, q, store, interactionFrom, interactionTo, selectedUncalledBucket, sortDir]);

  const matchesInteractionRange = useCallback(
    (lead: LeadRow) =>
      matchesLocalDateRange(lead.last_interaction_at, interactionFrom, interactionTo),
    [interactionFrom, interactionTo]
  );

  const rangeFilteredLeads = useMemo(
    () => (hasInteractionRange ? allLeads.filter(matchesInteractionRange) : allLeads),
    [hasInteractionRange, allLeads, matchesInteractionRange]
  );

  // Al buscar, los resultados son de TODAS las etapas (busqueda global).
  const searchMatches = useMemo(
    () => (searching ? rangeFilteredLeads.filter((l) => matchesSearch(l, q)) : []),
    [rangeFilteredLeads, q, searching, matchesSearch]
  );

  const [chartNow] = useState(() => new Date());
  const olderBucketKey = `older-than-${UNCALLED_CHART_DAYS}`;

  const matchesSelectedBucket = useCallback(
    (lead: LeadRow) => {
      if (selectedUncalledBucket == null) return true;
      if (selectedUncalledBucket === olderBucketKey) {
        return isUncalledLeadOlderThanWindow(lead, chartNow, UNCALLED_CHART_DAYS);
      }
      return isUncalledLeadOnDate(lead, selectedUncalledBucket);
    },
    [chartNow, olderBucketKey, selectedUncalledBucket]
  );

  const stagePriority = (stage: BoardStage) => {
    const i = BOARD_STAGE_PRIORITY.indexOf(stage);
    return i < 0 ? 99 : i;
  };

  const enHoy = activeStage === "hoy";
  const activeTabLabel = TAB_META[activeStage].label;

  // Eje 2: el segmento filtra DENTRO del tab activo, nunca lo reemplaza.
  const matchesSegment = useCallback(
    (lead: LeadRow) => activeSegment === null || lead.segment === activeSegment,
    [activeSegment]
  );

  // Que leads pertenecen al tab activo. "Hoy" no pasa por aca: lo arma
  // buildWorkQueue, que ademas los devuelve ya ordenados.
  const matchesTab = useCallback(
    (lead: LeadRow) =>
      activeStage === "seguimiento"
        ? lead.in_call_queue &&
          lead.work_state === "seguimiento" &&
          !isTrabajoDeHoy(lead, chartNow.getTime())
        : lead.board_stage === activeStage,
    [activeStage, chartNow]
  );

  const visibleLeads = useMemo(() => {
    if (searching) {
      return searchMatches
        .filter(matchesSelectedBucket)
        .filter(matchesSegment)
        .sort((a, b) => stagePriority(a.board_stage) - stagePriority(b.board_stage));
    }
    if (enHoy) {
      // Ya viene en orden de atencion: pagos -> recontactos vencidos -> por
      // cerrar -> sin llamar por segmento (carrito primero). Ver leads-queue.
      return buildWorkQueue(
        rangeFilteredLeads.filter(matchesSelectedBucket).filter(matchesSegment),
        chartNow
      );
    }
    const byInteraction = (a: LeadRow, b: LeadRow) => {
      const cmp = (a.last_interaction_at ?? "").localeCompare(b.last_interaction_at ?? "");
      return sortDir === "desc" ? -cmp : cmp;
    };
    return rangeFilteredLeads
      .filter(matchesTab)
      .filter(matchesSelectedBucket)
      .filter(matchesSegment)
      .sort(byInteraction);
  }, [
    rangeFilteredLeads,
    enHoy,
    matchesTab,
    searching,
    searchMatches,
    sortDir,
    matchesSelectedBucket,
    matchesSegment,
    chartNow,
  ]);

  const chartContextLeads = useMemo(() => {
    if (searching) return searchMatches.filter(matchesSegment);
    if (enHoy) return buildWorkQueue(rangeFilteredLeads.filter(matchesSegment), chartNow);
    return rangeFilteredLeads.filter(matchesTab).filter(matchesSegment);
  }, [
    enHoy,
    matchesTab,
    matchesSegment,
    rangeFilteredLeads,
    searchMatches,
    searching,
    chartNow,
  ]);

  const uncalledBuckets = useMemo(() => {
    return buildUncalledLeadBuckets(chartContextLeads, chartNow, UNCALLED_CHART_DAYS);
  }, [chartContextLeads, chartNow]);

  const maxUncalled = Math.max(1, ...uncalledBuckets.map((bucket) => bucket.count));
  const uncalledTotal = uncalledBuckets.reduce((total, bucket) => total + bucket.count, 0);

  const facetedLeads = useMemo(() => {
    let result = searching ? searchMatches : rangeFilteredLeads;
    if (selectedUncalledBucket) result = result.filter(matchesSelectedBucket);
    return result;
  }, [matchesSelectedBucket, rangeFilteredLeads, searchMatches, searching, selectedUncalledBucket]);

  // Conteo por etapa: refleja los resultados de busqueda cuando hay query.
  // Salta la faceta de segmento a proposito (regla de abajo).
  const stageCount = (stage: BoardStage) =>
    searching || selectedUncalledBucket || hasInteractionRange
      ? facetedLeads.filter((l) => l.board_stage === stage).length
      : counts?.byStage[stage] ?? 0;

  // Contadores de los dos ejes. Cada faceta se cuenta sobre el conjunto
  // filtrado por todo MENOS por ella misma:
  //
  //   - Los segmentos aplican el tab activo -> suman su total exacto.
  //   - Los tabs del eje 1 ignoran el segmento -> no se encogen al filtrar,
  //     asi no se pierde la referencia de donde uno esta parado.
  const facets = useMemo(
    () => boardFacets(facetedLeads, activeStage === "seguimiento" ? "seguimiento" : null),
    [facetedLeads, activeStage]
  );

  // Agenda: seguimientos programados y cuantos ya vencieron.
  const agenda = useMemo(() => {
    const now = Date.now();
    const scheduled = facetedLeads.filter((l) => l.next_followup_at != null);
    const due = scheduled.filter((l) => new Date(l.next_followup_at as string).getTime() <= now).length;
    return { total: scheduled.length, due };
  }, [facetedLeads]);

  const queueTotal = useMemo(
    () => facetedLeads.filter((l) => QUEUE_STAGES.includes(l.board_stage)).length,
    [facetedLeads]
  );

  // Vencidos globales (sin filtros): alimenta el banner rojo de recontactos.
  //
  // Son DOS trabajos distintos y el banner los contaba como uno solo, con el
  // nombre del que menos pesa: en Costa Rica, de 174 vencidos solo 15 eran
  // clientes que pidieron la llamada; los otros 159 eran "no contesto" a los
  // que el sistema les agendo el reintento de 24h. Decirle a la asesora que
  // 174 clientes le pidieron que los llamara era, sencillamente, falso.
  const overdue = useMemo(() => {
    const now = Date.now();
    const vencidos = leads.filter(
      (l) => l.next_followup_at != null && new Date(l.next_followup_at).getTime() <= now
    );
    return {
      total: vencidos.length,
      // Prometio el cliente ("llamame el jueves"): es una cita, no un reintento.
      prometidos: vencidos.filter((l) => schedulesFollowup(l.status)).length,
      // Los agendo el sistema al marcar buzon / no responde / cuelga.
      reintentos: vencidos.filter((l) => isNoAnswerStatus(l.status)).length,
    };
  }, [leads]);

  // Descartados solo aparece con el toggle; el resto son fijos.
  const tabs: BoardTab[] = showHidden ? [...TABS_VISIBLES, "descartado"] : TABS_VISIBLES;

  // Conteo de cada tab. "Hoy" y "Seguimiento" salen de la misma poblacion (la
  // cola de llamadas) partida por si es trabajo de hoy o no, asi que juntos
  // suman el total de la cola sin repetir a nadie.
  const tabCount = (tab: BoardTab): number => {
    if (tab === "hoy") return buildWorkQueue(facetedLeads, chartNow).length;
    if (tab === "seguimiento") {
      return facetedLeads.filter(
        (l) =>
          l.in_call_queue &&
          l.work_state === "seguimiento" &&
          !isTrabajoDeHoy(l, chartNow.getTime())
      ).length;
    }
    return searching || selectedUncalledBucket || hasInteractionRange
      ? facetedLeads.filter((l) => l.board_stage === tab).length
      : counts?.byStage[tab] ?? 0;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Telefono web: registra el navegador como la extension de la asesora
          para que "Llamar" suene aqui y no en un telefono aparte. */}
      <ZadarmaWebphone />
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
                    Por antigüedad: acumulado anterior y detalle de los últimos {UNCALLED_CHART_DAYS} días
                    {searching ? " en esta busqueda" : ` en ${activeTabLabel}`}
                    {activeSegment !== null && ` · ${SEGMENT_META[activeSegment].label}`}.
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums text-foreground">{uncalledTotal}</p>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">sin llamar</p>
                {uncalledTotal !== chartContextLeads.length && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                    de {chartContextLeads.length} {searching ? "en la búsqueda" : `en ${activeTabLabel}`}
                  </p>
                )}
              </div>
            </div>

            <div className="overflow-x-auto px-3 pb-3 pt-4">
              <div
                className="grid min-w-[720px] grid-cols-[repeat(15,minmax(0,1fr))] gap-2"
                role="group"
                aria-label="Leads sin llamar por antigüedad"
              >
                {uncalledBuckets.map((bucket) => {
                  const selected = selectedUncalledBucket === bucket.key;
                  const barHeight = bucket.count === 0 ? 3 : Math.max(12, Math.round((bucket.count / maxUncalled) * 92));
                  const bucketLabel = bucket.kind === "older" ? `+${UNCALLED_CHART_DAYS} d` : fmtDayLabel(bucket.date as string);
                  const bucketAriaLabel = bucket.kind === "older"
                    ? `${bucket.count} lead${bucket.count === 1 ? "" : "s"} sin llamar con más de ${UNCALLED_CHART_DAYS} días de antigüedad`
                    : `${bucket.count} lead${bucket.count === 1 ? "" : "s"} sin llamar el ${fmtDayLabel(bucket.date as string, true)}`;
                  return (
                    <button
                      key={bucket.key}
                      type="button"
                      disabled={bucket.count === 0}
                      aria-pressed={selected}
                      aria-label={bucketAriaLabel}
                      onClick={() => setSelectedUncalledBucket(selected ? null : bucket.key)}
                      className={`group flex h-40 flex-col items-center justify-end rounded-md border px-1 pb-1.5 pt-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        selected
                          ? "border-primary bg-primary/10"
                          : bucket.count > 0
                            ? "border-transparent hover:border-primary/35 hover:bg-accent/60"
                            : "cursor-default border-transparent opacity-45"
                      }`}
                    >
                      <span className={`mb-1 text-xs font-medium tabular-nums ${selected ? "text-primary" : "text-muted-foreground"}`}>
                        {bucket.count}
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
                        {bucketLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedUncalledBucket && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-primary/5 px-4 py-2.5 text-xs">
                <span>
                  Mostrando <strong className="font-medium text-foreground">{visibleLeads.length}</strong> lead{visibleLeads.length === 1 ? "" : "s"} sin llamar
                  {selectedUncalledBucket === olderBucketKey
                    ? ` con más de ${UNCALLED_CHART_DAYS} días de antigüedad.`
                    : ` del ${fmtDayLabel(selectedUncalledBucket, true)}.`}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedUncalledBucket(null)}
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

        {/* Recontactos vencidos: la promesa al cliente ("llamame el 1 de
            agosto") no puede depender de que alguien la recuerde. Ahora ya
            estan arriba de todo en Hoy, asi que el banner solo dice cuantos
            son y lleva ahi. */}
        {overdue.total > 0 && !enHoy && (
          <button
            type="button"
            onClick={() => setActiveStage("hoy")}
            className="mb-4 flex w-full items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/20"
          >
            <CalendarClock className="h-4 w-4 shrink-0" />
            <span>
              <strong>{overdue.total}</strong> recontacto{overdue.total === 1 ? "" : "s"} vencido
              {overdue.total === 1 ? "" : "s"} — están primero en Hoy.
            </span>
          </button>
        )}

        {/* Fila de tabs: que estoy mirando. Ver BoardTab. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabs.map((tab) => {
            const meta = TAB_META[tab];
            const active = activeStage === tab && !searching;
            const count = tabCount(tab);
            return (
              <button
                key={tab}
                onClick={() => setActiveStage(tab)}
                title={meta.hint}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                {tab === "hoy" && overdue.total > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">
                    {overdue.total} vencidos
                  </span>
                )}
                <span
                  className={`rounded-full px-1.5 text-xs ${active ? "bg-primary-foreground/20" : "bg-muted"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {showHidden ? "Ocultar descartados" : "Ver descartados"}
          </button>
          <button
            onClick={() => setIncludeOld((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            title="Por defecto se ocultan leads con más de 30 días sin actividad"
          >
            {includeOld ? "Ocultar antiguos (+30 días)" : "Incluir antiguos (+30 días)"}
          </button>
        </div>

        {/* Eje 2: intencion de compra. Filtra DENTRO del tab activo, no lo
            reemplaza — por eso los conteos suman el total del tab. Un lead con
            carrito abierto y ya contactado aparece en "En seguimiento" Y en
            "Carrito" a la vez, que era justo lo que el tablero viejo no podia
            representar. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Intención
          </span>
          <button
            onClick={() => setActiveSegment(null)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              activeSegment === null
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            Todos
            <span className="rounded-full bg-muted px-1.5 tabular-nums">
              {SEGMENT_ORDER.reduce((sum, s) => sum + facets.bySegment[s], 0)}
            </span>
          </button>
          {SEGMENT_ORDER.map((seg) => {
            const meta = SEGMENT_META[seg];
            const count = facets.bySegment[seg];
            const active = activeSegment === seg;
            // Distrito y Conversó siguen vacíos hasta que se pueble district e
            // inbound_count; no se muestran para no ofrecer un filtro que no
            // puede hacer nada.
            if (count === 0 && !active) return null;
            return (
              <button
                key={seg}
                onClick={() => setActiveSegment(active ? null : seg)}
                title={meta.hint}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-accent"
                }`}
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
                <span className="rounded-full bg-muted px-1.5 tabular-nums">{count}</span>
              </button>
            );
          })}
          {activeSegment !== null && (
            <button
              onClick={() => setActiveSegment(null)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Quitar filtro
            </button>
          )}
        </div>

        {!searching && activeSegment === "carrito" && (
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            {cartSyncMessage && (
              <span className="text-xs text-muted-foreground">{cartSyncMessage}</span>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={syncShopifyCarts}
              disabled={syncingShopifyCarts}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${syncingShopifyCarts ? "animate-spin" : ""}`}
              />
              {syncingShopifyCarts ? "Sincronizando..." : "Sincronizar Shopify"}
            </Button>
          </div>
        )}

        {/* El archivo (Cerrados + Descartados) pesa varios miles de leads y se
            trae aparte. Al buscar NO se espera: se muestra al instante lo que
            ya esta cargado y los cerrados se suman cuando llegan. Bloquear la
            lista mientras tanto dejaba el buscador "colgado" en cada busqueda,
            aunque el lead buscado ya estuviera a la vista. */}
        {loading ? (
          <p className="py-12 text-center text-muted-foreground">Cargando...</p>
        ) : visibleLeads.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {searching
              ? searchLoading
                ? "Buscando en toda la base..."
                : "Sin resultados para la búsqueda."
              : esperandoArchivo
                ? "Cargando..."
                : selectedUncalledBucket
                  ? "No hay leads sin llamar para la barra seleccionada en este filtro."
                  : hasInteractionRange
                    ? "No hay leads con última interacción en este rango y etapa."
                    : "No hay leads en esta etapa."}
          </p>
        ) : (
          <>
            {searching && searchAproximado && !searchLoading && (
              <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                No hay ninguna coincidencia exacta con <strong>{search.trim()}</strong>. Estos
                números se parecen — revisá si alguno es el que buscabas.
              </p>
            )}
            {(esperandoArchivo || searchLoading) && (
              <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                {searchLoading ? "Buscando en toda la base..." : "Cargando Cerrados y Descartados..."}
              </p>
            )}
            {!searching && !enHoy && (
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
            {!searching && enHoy && (
              <p className="mb-2 text-xs text-muted-foreground">
                Orden de atención: 💰 pagos por verificar → 📅 recontactos vencidos → 🔥 por
                cerrar → y después los que nadie llamó, empezando por 🛒 carrito (41% llega a
                cerrar) → 🔥 enganchado → 💬 conversó → ❄️ frío. Se trabaja de arriba hacia abajo.
              </p>
            )}
            <div className="space-y-2">
              {visibleLeads.slice(0, shownCount).map((lead, index) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  onOpen={() => setDrawerLead(lead)}
                  queuePosition={!searching && enHoy ? index + 1 : undefined}
                />
              ))}
            </div>
            {visibleLeads.length > shownCount && (
              <div className="mt-3 flex flex-col items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShownCount((n) => n + LEADS_PER_PAGE)}
                >
                  Mostrar {Math.min(LEADS_PER_PAGE, visibleLeads.length - shownCount)} más
                </Button>
                <p className="text-xs text-muted-foreground">
                  Mostrando {shownCount} de {visibleLeads.length}
                </p>
              </div>
            )}
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

function LeadCard({
  lead,
  onOpen,
  queuePosition,
}: {
  lead: LeadRow;
  onOpen: () => void;
  queuePosition?: number;
}) {
  // La etiqueta muestra el SEGMENTO, que es lo que decide el orden de la cola
  // y lo que dicen los chips de arriba.
  //
  // Antes mostraba el board_stage y se contradecia con el filtro: un lead con
  // 22 mensajes salia en el chip "Enganchado" pero con la etiqueta "Frío",
  // porque `status = frio` lo pone el bot por INACTIVIDAD, no por cuantos
  // mensajes escribio. Son dos cosas distintas y la tarjeta mostraba la que no
  // explicaba por que estaba ahi.
  const meta = SEGMENT_META[lead.segment];
  const isNext = queuePosition === 1;
  return (
    <Card className={`transition-colors hover:border-primary/50 ${isNext ? "border-primary/70 bg-primary/5" : ""}`}>
      <CardContent className="flex items-center gap-3 py-3">
        {queuePosition != null && (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
              isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
            title={isNext ? "Siguiente en la cola" : `Posición ${queuePosition} en la cola`}
          >
            {queuePosition}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{lead.name || "Sin nombre"}</span>
            <Badge variant={SEGMENT_VARIANT[lead.segment]} className="shrink-0" title={meta.hint}>
              {meta.emoji} {meta.label}
            </Badge>
            {lead.status_source === "manual" && (
              // Que marco la asesora, no solo que la hubo. En Seguimiento la
              // diferencia entre "No responde" y "Volver a llamar" decide si
              // se vuelve a marcar hoy o no.
              <Badge variant="outline" className="shrink-0">
                {getStatusDef(lead.status)?.label ?? "gestión manual"}
              </Badge>
            )}
            {lead.unread_count > 0 && (
              <Badge variant="info" className="shrink-0">
                {lead.unread_count} sin leer
              </Badge>
            )}
            {lead.has_order && (
              <Badge variant="success" className="shrink-0" title="Ya tiene pedido: fuera de la cola de venta">
                ya tiene pedido
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
          {lead.board_stage === "carrito" && lead.cart_summary && (
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {lead.shopify_cart_open && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  Shopify {lead.shopify_draft_cart_count || 1}
                </Badge>
              )}
              <span className="truncate">{lead.cart_summary}</span>
            </div>
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
  const [showOrder, setShowOrder] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // Al cerrar la ficha se lleva el telefono. Va en el desmontaje y no en el
  // boton de cerrar para cubrir todas las salidas: la X y el clic en el fondo.
  useEffect(() => () => hideWebphone(), []);

  // El drawer opera SIEMPRE con la tienda del propio lead, no con la del
  // selector del tablero. Si al cambiar de tienda el tablero alcanza a mostrar
  // un lead de la tienda anterior (carrera de re-carga), los paneles (chat,
  // pedidos, carritos, crear pedido) usaban el store equivocado: los endpoints
  // filtran el lead por (store_id, id) y devolvian 404 ("lead no encontrado"),
  // y peor aun, "Crear pedido" habria escrito el pedido en la otra tienda.
  const leadStore = getFinanceStoreById(lead.store_id)?.code ?? store;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      {/* Drawer SIEMPRE ancho: columna izquierda solo chat, derecha el panel
          del cliente. "Crear pedido" se superpone sobre la derecha y al
          terminar vuelve al panel. */}
      {/* 70rem = dos columnas del ancho que tenia el chat (~35rem cada una).
          Mitad y mitad: ninguna necesita mas espacio que la otra. */}
      <div
        className="flex h-full w-full max-w-[70rem] flex-col border-l border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{lead.name || "Sin nombre"}</p>
            <div className="text-xs text-muted-foreground">
              <PhoneWithCopy phone={lead.phone} />
            </div>
          </div>
          <CallButton leadId={lead.id} store={leadStore} />
          <Button size="sm" variant={showOrder ? "outline" : "default"} onClick={() => setShowOrder((v) => !v)}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            {showOrder ? "Ocultar pedido" : "Crear pedido"}
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Columna izquierda: SOLO el chat + composer */}
          <div className="flex min-h-0 flex-col md:w-1/2 md:border-r md:border-border">
            <LeadChatPanel
              lead={{
                id: lead.id,
                name: lead.name,
                phone: lead.phone,
                labels: lead.labels,
                hasConversation: Boolean(lead.crm_conversation_id),
              }}
              store={leadStore}
              onActivity={() => {
                setHistoryKey((k) => k + 1);
              }}
            />
          </div>

          {/* Columna derecha: historial del cliente. "Crear pedido" se
              superpone encima y al crearse vuelve solo al panel. */}
          <div className="relative min-h-0 flex-1 border-t border-border md:border-t-0">
            <CustomerPanel
              leadId={lead.id}
              store={leadStore}
              historyKey={historyKey}
              onGestionDone={() => {
                onRefresh();
                setHistoryKey((k) => k + 1);
              }}
            />
            {showOrder && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-card">
                <CreateOrderPanel
                  lead={{ id: lead.id, name: lead.name, phone: lead.phone }}
                  store={leadStore}
                  onCreated={() => {
                    onRefresh();
                    setHistoryKey((k) => k + 1);
                    // Pedido creado: volver al historial, que ya lo incluye.
                    setShowOrder(false);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
