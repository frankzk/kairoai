"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, RefreshCw, ShoppingBag, X } from "lucide-react";
import { getStatusDef } from "@/lib/leads-classify";
import { formatLeadPhone } from "@/lib/phone-cr";
import { resumenTipos } from "@/lib/leads-productividad-leads";

/** La ficha que viaja con cada lead: la misma forma que el tablero (LeadRow). */
export interface LeadParaAbrir {
  id: number;
  store_id: number;
  phone: string;
  name: string | null;
  status: string;
  labels: string[];
  has_order: boolean;
  [campo: string]: unknown;
}

export interface LeadDeLista {
  lead_id: number;
  gestiones: number;
  pedidos: number;
  primera: string | null;
  ultima: string | null;
  tipos: Record<string, number>;
  lead: LeadParaAbrir | null;
}

export interface RespuestaLeadsDeAsesora {
  total: number;
  gestiones: number;
  incompleto: boolean;
  max_leads: number;
  leads: LeadDeLista[];
}

/** Hora (o dia y hora si el periodo tiene mas de un dia) en la zona de la tienda. */
export function horaDeGestion(iso: string | null, timeZone: string, conDia: boolean): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CR", {
      timeZone,
      ...(conDia ? { day: "2-digit", month: "2-digit" } : {}),
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** La lista, sin efectos (se renderiza en los tests y en la vista previa). */
export function ListaLeadsDeAsesora({
  data,
  esperado,
  timeZone,
  conDia,
  abriendo,
  onOpen,
  rowRefs,
}: {
  data: RespuestaLeadsDeAsesora;
  /** El numero que se apreto en la tabla. */
  esperado: number;
  timeZone: string;
  conDia: boolean;
  abriendo: number | null;
  onOpen: (lead: LeadParaAbrir) => void;
  rowRefs?: React.MutableRefObject<Map<number, HTMLButtonElement>>;
}) {
  const recortada = data.total > data.leads.length;
  return (
    <>
      {data.total !== esperado ? (
        <p role="status" className="mx-4 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          La tabla decía {esperado} y ahora hay {data.total}: se registraron o deshicieron gestiones desde que se cargó. Usa Actualizar en Productividad.
        </p>
      ) : null}
      {data.incompleto ? (
        <p role="status" className="mx-4 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          El período tiene demasiadas gestiones: se muestran las más recientes. Acorta el rango para verlas todas.
        </p>
      ) : null}
      {recortada ? (
        <p className="mx-4 mb-2 text-xs text-muted-foreground">
          Se muestran los {data.leads.length} de gestión más reciente, de {data.total}.
        </p>
      ) : null}
      {data.leads.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin gestiones suyas en este período.</p>
      ) : (
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {data.leads.map((item) => {
            const lead = item.lead;
            const nombre = lead?.name?.trim() || "Sin nombre";
            const estado = lead ? getStatusDef(lead.status)?.label ?? lead.status : null;
            const tipos = resumenTipos(item.tipos);
            const mismaHora = item.primera === item.ultima;
            const cuerpo = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{lead ? nombre : `Lead #${item.lead_id}`}</span>
                    {lead ? <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatLeadPhone(lead.phone)}</span> : null}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {estado ? <span className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-foreground/90">{estado}</span> : null}
                    {lead?.has_order ? (
                      <span className="inline-flex items-center gap-1 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
                        <ShoppingBag className="h-3 w-3" aria-hidden="true" /> Con pedido
                      </span>
                    ) : null}
                    {(lead?.labels ?? []).slice(0, 2).map((label) => (
                      <span key={label} className="rounded-sm border border-border px-1.5 py-0.5 text-muted-foreground">{label}</span>
                    ))}
                    {!lead ? <span className="text-muted-foreground">Ya no está en la tienda</span> : null}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    <span className="tabular-nums">
                      {mismaHora
                        ? horaDeGestion(item.ultima, timeZone, conDia)
                        : `${horaDeGestion(item.primera, timeZone, conDia)} a ${horaDeGestion(item.ultima, timeZone, conDia)}`}
                    </span>
                    {tipos ? <> · {tipos}</> : null}
                  </span>
                </span>
                {lead ? (
                  <span className="flex shrink-0 items-center gap-1 self-center text-xs text-muted-foreground">
                    {abriendo === lead.id ? "Abriendo…" : <span className="hidden sm:inline">Abrir</span>}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={item.lead_id}>
                {lead ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (!rowRefs) return;
                      if (el) rowRefs.current.set(lead.id, el);
                      else rowRefs.current.delete(lead.id);
                    }}
                    onClick={() => onOpen(lead)}
                    aria-label={`Abrir ${nombre}, ${formatLeadPhone(lead.phone)}${estado ? `, ${estado}` : ""}`}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {cuerpo}
                  </button>
                ) : (
                  <div className="flex w-full items-start gap-3 px-4 py-3">{cuerpo}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Los leads detras del numero "Leads" de una asesora en Productividad.
 *
 * Se pide UNA vez al abrirse (nunca al cargar la pagina). Cada fila abre la
 * ficha del tablero por el mismo camino que una tarjeta (`onOpenLead`), asi
 * que la reserva de 10 minutos y el aviso de "lead ocupado" siguen mandando.
 * Mientras la ficha (o el aviso) esta abierta, esta ventana se esconde sin
 * perder la lista, y al cerrarla vuelve con el foco en el lead que se abrio.
 */
export default function ProductivityLeadsModal({
  store,
  staffId,
  nombre,
  esperado,
  fromIso,
  toIso,
  periodoLabel,
  timeZone,
  suspendido,
  onOpenLead,
  onClose,
}: {
  store: string;
  staffId: number;
  nombre: string;
  esperado: number;
  fromIso: string;
  toIso: string;
  periodoLabel: string;
  timeZone: string;
  /** La ficha o el aviso de reserva estan abiertos encima. */
  suspendido: boolean;
  onOpenLead?: (lead: LeadParaAbrir) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const ultimoAbierto = useRef<number | null>(null);
  const [data, setData] = useState<RespuestaLeadsDeAsesora | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [abriendo, setAbriendo] = useState<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const conDia = Date.parse(toIso) - Date.parse(fromIso) > 86_400_000 + 60_000;

  const cargar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ store, staff: String(staffId), from: fromIso, to: toIso });
      const res = await fetch(`/api/leads/productivity/leads?${params}`, { cache: "no-store", signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudieron cargar los leads.");
      if (!Array.isArray(body.leads)) throw new Error("Respuesta incompleta.");
      setData(body as RespuestaLeadsDeAsesora);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "No se pudieron cargar los leads.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [store, staffId, fromIso, toIso]);

  useEffect(() => {
    const controller = new AbortController();
    void cargar(controller.signal);
    return () => controller.abort();
  }, [cargar]);

  // Al cerrar, el foco vuelve al numero que se apreto.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  // Foco adentro; al volver de la ficha, en el lead que se abrio.
  useEffect(() => {
    if (suspendido) {
      setAbriendo(null);
      return;
    }
    const fila = ultimoAbierto.current != null ? rowRefs.current.get(ultimoAbierto.current) : null;
    (fila ?? closeRef.current)?.focus();
  }, [suspendido]);

  // Dialogo de verdad: Esc cierra, Tab no se escapa, y las teclas no llegan a
  // los atajos del tablero de atras (j/k/Enter// en LeadsBoard).
  useEffect(() => {
    if (suspendido) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") {
        e.stopPropagation();
        return;
      }
      const box = boxRef.current;
      if (!box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!box.contains(active) || active === box) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [suspendido]);

  const abrir = (lead: LeadParaAbrir) => {
    if (!onOpenLead) return;
    ultimoAbierto.current = lead.id;
    setAbriendo(lead.id);
    onOpenLead(lead);
  };

  return (
    <div
      hidden={suspendido}
      className={`fixed inset-0 z-50 ${suspendido ? "hidden" : "flex"} items-end justify-center bg-[rgb(15_15_30/0.36)] p-0 sm:items-center sm:p-4 dark:bg-black/60`}
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[10px] border border-border bg-card shadow-[0_12px_32px_-8px_rgb(20_20_31/0.18),0_2px_6px_rgb(20_20_31/0.06)] outline-none sm:max-h-[80vh] sm:rounded-[10px]"
      >
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold leading-snug text-foreground">
              Leads que gestionó {nombre}
            </h2>
            <p id={descId} className="mt-1 text-xs leading-[1.45] text-muted-foreground">
              {periodoLabel} · {data ? `${data.total} ${data.total === 1 ? "lead" : "leads"}, ${data.gestiones} ${data.gestiones === 1 ? "gestión" : "gestiones"}` : `${esperado} ${esperado === 1 ? "lead" : "leads"}`}.
              {" "}Cuenta cada lead con al menos una gestión suya (resultado, WhatsApp o pedido); abrir la ficha sin registrar nada no cuenta.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2" aria-busy={loading}>
          {loading && !data ? (
            <ul aria-hidden="true" className="divide-y divide-border/60 border-t border-border/60">
              {Array.from({ length: Math.min(Math.max(esperado, 1), 5) }, (_, i) => (
                <li key={i} className="px-4 py-3">
                  <span className="block h-3 w-40 rounded-sm bg-muted" />
                  <span className="mt-2 block h-3 w-24 rounded-sm bg-muted" />
                </li>
              ))}
            </ul>
          ) : error ? (
            <div role="alert" className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={() => void cargar()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" /> Reintentar
              </button>
            </div>
          ) : data ? (
            <ListaLeadsDeAsesora
              data={data}
              esperado={esperado}
              timeZone={timeZone}
              conDia={conDia}
              abriendo={abriendo}
              onOpen={abrir}
              rowRefs={rowRefs}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
