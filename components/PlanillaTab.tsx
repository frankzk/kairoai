"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Undo2,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AJUSTES,
  ESTADO_PAGO_LABEL,
  etiquetaAjuste,
  formatoMonto,
  METODOS_PAGO,
  MONEDAS,
  montoEnColones,
  moverQuincena,
  nombreQuincena,
  puedeCerrar,
  quincenaDeFecha,
  signoAjuste,
  totalesQuincena,
  type AjusteTipo,
  type EstadoPago,
} from "@/lib/planilla";
import type { Evento, Linea, Periodo, PersonaPlanilla } from "@/lib/planilla-db";
import { cn } from "@/lib/utils";

type Datos = {
  quincena: string;
  periodo: Periodo | null;
  lineas: Linea[];
  eventos: Evento[];
  personas: PersonaPlanilla[];
  quincenas: Array<{ id: number; period_key: string; status: string }>;
};

const ESTADO_VARIANT: Record<EstadoPago, "muted" | "warning" | "info" | "success" | "destructive"> = {
  sin_monto: "muted",
  pendiente: "warning",
  parcial: "info",
  pagado: "success",
  sobrepago: "destructive",
};

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CR", { timeZone: "America/Costa_Rica", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fechaCorta = (d: string) => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day))).replace(".", "");
};

const ACCION_LABEL: Record<string, string> = {
  quincena_creada: "Creó la quincena",
  persona_agregada: "Agregó a",
  persona_quitada: "Quitó a",
  base_cambiada: "Cambió la base de",
  ajuste_agregado: "Agregó un ajuste a",
  ajuste_quitado: "Quitó un ajuste de",
  abono_registrado: "Registró un abono a",
  abono_anulado: "Anuló un abono de",
  quincena_cerrada: "Cerró la quincena",
  quincena_reabierta: "Reabrió la quincena",
};

function describirEvento(e: Evento): string {
  const d = e.detail ?? {};
  const persona = typeof d.persona === "string" ? ` ${d.persona}` : "";
  const moneda = typeof d.moneda === "string" ? d.moneda : "PEN";
  const monto = typeof d.monto === "number" ? ` · ${formatoMonto(d.monto, moneda)}` : "";
  switch (e.action) {
    case "quincena_creada":
      return `Creó la quincena con ${d.personas ?? 0} personas`;
    case "base_cambiada":
      return `Cambió la base de${persona}: ${formatoMonto(Number(d.antes ?? 0), moneda)} → ${formatoMonto(Number(d.despues ?? 0), moneda)}`;
    case "ajuste_agregado":
    case "ajuste_quitado":
      return `${ACCION_LABEL[e.action]}${persona}: ${d.tipo ?? ""}${monto}${d.detalle ? ` (${d.detalle})` : ""}`;
    case "abono_registrado":
      return `Registró un abono a${persona}${monto}${d.metodo ? ` por ${d.metodo}` : ""}${d.referencia ? ` · ref. ${d.referencia}` : ""}${
        typeof d.colones === "number" && moneda !== "CRC" ? ` (${formatoMonto(d.colones, "CRC")} en Gastos)` : ""
      }`;
    case "abono_anulado":
      return `Anuló un abono de${persona}${monto}: ${d.motivo ?? ""}`;
    case "quincena_reabierta":
      return `Reabrió la quincena: ${d.motivo ?? ""}`;
    case "quincena_cerrada":
      return `Cerró la quincena (${d.personas ?? 0} personas)`;
    default:
      return `${ACCION_LABEL[e.action] ?? e.action}${persona}`;
  }
}

async function enviar(store: string, accion: string, datos: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/finance/planilla", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store, accion, ...datos }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? null : json.error || "No se pudo guardar.";
  } catch {
    return "Sin conexión. Vuelve a intentarlo.";
  }
}

/**
 * Planilla quincenal: cuanto se le paga a cada persona (base + extras -
 * rebajos), los abonos registrados y el saldo, con su bitacora. Cada abono
 * crea su gasto de planilla en colones (Gastos y Cierre mensual).
 */
export function PlanillaTab({ storeCode }: { storeCode: string }) {
  const [quincena, setQuincena] = useState(() => quincenaDeFecha(hoy()));
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [verSalarios, setVerSalarios] = useState(false);
  const [verBitacora, setVerBitacora] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/finance/planilla?store=${encodeURIComponent(storeCode)}&quincena=${quincena}`, { cache: "no-store" });
      const json = (await res.json()) as Datos & { error?: string };
      if (!res.ok) throw new Error(json.error || "No se pudo cargar la planilla.");
      setDatos(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la planilla.");
    } finally {
      setCargando(false);
    }
  }, [storeCode, quincena]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const accion = useCallback(
    async (nombre: string, payload: Record<string, unknown>, ok?: string) => {
      setOcupado(true);
      setAviso("");
      const fallo = await enviar(storeCode, nombre, payload);
      setOcupado(false);
      if (fallo) {
        setAviso(fallo);
        return false;
      }
      if (ok) setAviso(ok);
      await cargar();
      return true;
    },
    [storeCode, cargar]
  );

  const periodo = datos?.periodo ?? null;
  const lineas = useMemo(() => datos?.lineas ?? [], [datos]);
  const resumen = useMemo(() => totalesQuincena(lineas), [lineas]);
  const linea = lineas.find((l) => l.id === abierta) ?? null;
  const activos = (datos?.personas ?? []).filter((p) => p.active);
  const editable = periodo?.status === "abierta";

  function exportar() {
    if (!periodo) return;
    const filas = [
      ["Persona", "Función", "Moneda", "Base", "Sumas", "Restas", "Total a pagar", "Abonado", "Saldo", "Estado", "Método", "Cuenta"],
      ...lineas.map((l) => [
        l.staff_name, l.staff_role, l.moneda, l.totales.base, l.totales.sumas, l.totales.restas, l.totales.total,
        l.totales.abonado, l.totales.saldo, ESTADO_PAGO_LABEL[l.totales.estado], l.metodo_pago, l.cuenta_pago,
      ]),
      [],
      ["Abonos"],
      ["Persona", "Fecha", "Monto", "Moneda", "Tipo de cambio", "Colones", "Método", "Referencia", "Registró", "Anulado", "Motivo"],
      ...lineas.flatMap((l) =>
        l.abonos.map((a) => [l.staff_name, a.paid_on, a.amount, l.moneda, a.exchange_rate ?? "", a.amount_crc, a.method, a.reference, a.created_by, a.voided_at ? "Sí" : "", a.void_reason ?? ""])
      ),
    ];
    const csv = filas.map((f) => f.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `planilla-${storeCode}-${periodo.period_key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="space-y-4" aria-labelledby="planilla-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setQuincena((q) => moverQuincena(q, -1))}
              className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Quincena anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 id="planilla-titulo" className="min-w-[13.5rem] px-2 text-center text-[13.5px] font-semibold text-foreground">
              {nombreQuincena(quincena)}
            </h2>
            <button
              type="button"
              onClick={() => setQuincena((q) => moverQuincena(q, 1))}
              className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Quincena siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {periodo && (
            <Badge variant={periodo.status === "abierta" ? "info" : "muted"}>
              {periodo.status === "abierta" ? <LockOpen className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {periodo.status === "abierta" ? "Abierta" : "Cerrada"}
            </Badge>
          )}
          {quincena !== quincenaDeFecha(hoy()) && (
            <button type="button" onClick={() => setQuincena(quincenaDeFecha(hoy()))} className="text-xs text-primary hover:underline">
              Ir a la actual
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar planilla">
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} />
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setVerSalarios(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Personal y salarios
          </Button>
          {periodo && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setVerBitacora((v) => !v)} aria-expanded={verBitacora}>
                <History className="h-3.5 w-3.5" /> Bitácora
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={exportar}>
                <Download className="h-3.5 w-3.5" /> Exportar
              </Button>
              {editable ? (
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={ocupado || !puedeCerrar(lineas)}
                  title={puedeCerrar(lineas) ? "Deja la quincena fija" : "Se cierra cuando nadie tiene saldo pendiente"}
                  onClick={() => {
                    if (window.confirm(`¿Cerrar la quincena ${nombreQuincena(quincena)}? Queda fija; para cambiarla habrá que reabrirla.`))
                      void accion("cerrar", { period_id: periodo.id }, "Quincena cerrada.");
                  }}
                >
                  <Lock className="h-3.5 w-3.5" /> Cerrar quincena
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={ocupado}
                  onClick={() => {
                    const motivo = window.prompt("¿Por qué se reabre la quincena? (queda en la bitácora)");
                    if (motivo?.trim()) void accion("reabrir", { period_id: periodo.id, motivo: motivo.trim() }, "Quincena reabierta.");
                  }}
                >
                  <LockOpen className="h-3.5 w-3.5" /> Reabrir
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {aviso && (
        <p role="status" className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-[13px] text-foreground">
          {aviso}
          <button type="button" onClick={() => setAviso("")} aria-label="Cerrar aviso" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      {error ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-[13px] text-muted-foreground">
          <p className="font-medium text-foreground">No se pudo cargar la planilla.</p>
          <p className="mt-0.5">{error}</p>
        </div>
      ) : cargando && !datos ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : !periodo ? (
        <div className="rounded-lg border border-border bg-card px-6 py-10 text-center shadow-[0_1px_2px_rgb(16_16_32/0.04)]">
          <Wallet className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-foreground">Esta quincena todavía no existe</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            Se crea con las {activos.length} personas activas del personal y su salario base. Después se agregan extras, rebajos y los abonos.
          </p>
          {activos.some((p) => p.salario_quincenal <= 0) && (
            <p className="mx-auto mt-2 max-w-md text-xs text-amber-400">
              {activos.filter((p) => p.salario_quincenal <= 0).length} personas no tienen salario base: cárgalo en “Personal y salarios” o ajústalo en la quincena.
            </p>
          )}
          <Button
            className="mt-4 gap-1.5"
            disabled={ocupado || activos.length === 0}
            onClick={() => void accion("crear_quincena", { quincena }, "Quincena creada.")}
          >
            <Plus className="h-4 w-4" /> Crear quincena
          </Button>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_16_32/0.04)]">
            <dl className="-mb-px -mr-px grid grid-cols-2 lg:grid-cols-4">
              {resumen.length === 0 ? (
                <div className="col-span-full px-4 py-3.5 text-[13px] text-muted-foreground">Sin personas en la quincena.</div>
              ) : (
                resumen.flatMap((r) => [
                  <Celda key={`${r.moneda}-t`} label={`Total a pagar${resumen.length > 1 ? ` (${r.moneda})` : ""}`} value={formatoMonto(r.total, r.moneda)} />,
                  <Celda key={`${r.moneda}-a`} label="Abonado" value={formatoMonto(r.abonado, r.moneda)} tone="good" />,
                  <Celda key={`${r.moneda}-s`} label="Saldo pendiente" value={formatoMonto(r.saldo, r.moneda)} tone={r.saldo > 0 ? "warn" : undefined} />,
                  <Celda key={`${r.moneda}-p`} label="Personas pagadas" value={`${r.pagadas} de ${r.personas}`} />,
                ])
              )}
            </dl>
          </div>

          {verBitacora && <Bitacora eventos={datos?.eventos ?? []} onClose={() => setVerBitacora(false)} />}

          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_16_32/0.04)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead className="border-b border-border text-left text-xs text-muted-foreground [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                  <tr>
                    <th>Persona</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">Extras</th>
                    <th className="text-right">Rebajos</th>
                    <th className="text-right">Total a pagar</th>
                    <th className="text-right">Abonado</th>
                    <th className="text-right">Saldo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id} className="border-t border-border/60 transition-colors hover:bg-muted/40 [&>td]:px-3 [&>td]:py-2.5">
                      <td>
                        <button type="button" onClick={() => setAbierta(l.id)} className="text-left font-medium text-foreground hover:text-primary hover:underline">
                          {l.staff_name}
                        </button>
                        <span className="block text-xs text-muted-foreground">
                          {[l.staff_role, l.metodo_pago, l.cuenta_pago].filter(Boolean).join(" · ") || "Sin método de pago"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-right tabular-nums">{formatoMonto(l.totales.base, l.moneda)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{l.totales.sumas ? `+${formatoMonto(l.totales.sumas, l.moneda)}` : "—"}</td>
                      <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{l.totales.restas ? `−${formatoMonto(l.totales.restas, l.moneda)}` : "—"}</td>
                      <td className="whitespace-nowrap text-right font-semibold tabular-nums text-foreground">{formatoMonto(l.totales.total, l.moneda)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{formatoMonto(l.totales.abonado, l.moneda)}</td>
                      <td className={cn("whitespace-nowrap text-right tabular-nums", l.totales.saldo > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
                        {formatoMonto(l.totales.saldo, l.moneda)}
                      </td>
                      <td className="whitespace-nowrap">
                        <Badge variant={ESTADO_VARIANT[l.totales.estado]}>{ESTADO_PAGO_LABEL[l.totales.estado]}</Badge>
                      </td>
                      <td className="text-right">
                        <Button variant="outline" size="sm" onClick={() => setAbierta(l.id)}>
                          {editable && l.totales.saldo > 0 ? "Abonar" : "Ver"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && (
              <AgregarPersona
                personas={(datos?.personas ?? []).filter((p) => !lineas.some((l) => l.staff_id === p.id))}
                disabled={ocupado}
                onAdd={(staffId) => void accion("agregar_persona", { period_id: periodo.id, staff_id: staffId })}
              />
            )}
          </div>
        </>
      )}

      {linea && periodo && (
        <DetallePersona
          linea={linea}
          editable={editable}
          ocupado={ocupado}
          eventos={(datos?.eventos ?? []).filter((e) => e.line_id === linea.id)}
          onClose={() => setAbierta(null)}
          accion={accion}
        />
      )}
      {verSalarios && datos && <Salarios personas={datos.personas} accion={accion} onClose={() => setVerSalarios(false)} />}
    </section>
  );
}

function Celda({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="min-w-0 border-b border-r border-border px-4 py-3.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-xl font-semibold tracking-tight tabular-nums", tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

function AgregarPersona({ personas, disabled, onAdd }: { personas: PersonaPlanilla[]; disabled: boolean; onAdd: (id: number) => void }) {
  const [id, setId] = useState("");
  if (!personas.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
      <label htmlFor="planilla-agregar" className="text-xs text-muted-foreground">
        Agregar a la quincena
      </label>
      <select
        id="planilla-agregar"
        value={id}
        onChange={(e) => setId(e.target.value)}
        className="h-8 rounded-md border border-input bg-card px-2 text-[13px] text-foreground"
      >
        <option value="">Elige una persona…</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.active ? "" : " (inactiva)"}
          </option>
        ))}
      </select>
      <Button variant="outline" size="sm" disabled={disabled || !id} onClick={() => { onAdd(Number(id)); setId(""); }}>
        Agregar
      </Button>
    </div>
  );
}

function Panel({ titulo, subtitulo, onClose, children }: { titulo: string; subtitulo?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgb(15_15_30/0.36)] dark:bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex h-full w-full max-w-[40rem] flex-col border-l border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-foreground">{titulo}</p>
            {subtitulo && <p className="text-[13px] text-muted-foreground">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar (Esc)" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

const SELECT = "h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] text-foreground";

function DetallePersona({
  linea,
  editable,
  ocupado,
  eventos,
  onClose,
  accion,
}: {
  linea: Linea;
  editable: boolean;
  ocupado: boolean;
  eventos: Evento[];
  onClose: () => void;
  accion: (nombre: string, payload: Record<string, unknown>, ok?: string) => Promise<boolean>;
}) {
  const m = linea.moneda;
  const t = linea.totales;
  const [base, setBase] = useState(String(linea.base));
  const [ajuste, setAjuste] = useState<{ kind: AjusteTipo; amount: string; description: string }>({ kind: "extra", amount: "", description: "" });
  const [abono, setAbono] = useState({
    amount: t.saldo > 0 ? String(t.saldo) : "",
    paid_on: hoy(),
    method: linea.metodo_pago || "SINPE Móvil",
    reference: "",
    note: "",
    exchange_rate: "",
  });

  useEffect(() => {
    setBase(String(linea.base));
  }, [linea.base]);
  useEffect(() => {
    setAbono((a) => ({ ...a, amount: t.saldo > 0 ? String(t.saldo) : "" }));
  }, [t.saldo]);

  // Tipo de cambio del dia para pagos en soles o dolares (editable).
  useEffect(() => {
    if (m === "CRC") return;
    let vivo = true;
    fetch(`/api/finance/exchange-rate?from=${m}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { rate?: number }) => {
        if (vivo && j.rate) setAbono((a) => (a.exchange_rate ? a : { ...a, exchange_rate: j.rate!.toFixed(2) }));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [m]);

  const colones = m === "CRC" ? null : montoEnColones(m, Number(abono.amount) || 0, Number(abono.exchange_rate) || 0);

  async function guardarAbono(e: FormEvent) {
    e.preventDefault();
    const ok = await accion(
      "abono",
      { line_id: linea.id, ...abono, amount: Number(abono.amount), exchange_rate: m === "CRC" ? null : Number(abono.exchange_rate) },
      `Abono registrado a ${linea.staff_name}.`
    );
    if (ok) setAbono((a) => ({ ...a, reference: "", note: "" }));
  }

  async function guardarAjuste(e: FormEvent) {
    e.preventDefault();
    const ok = await accion("ajuste", { line_id: linea.id, kind: ajuste.kind, amount: Number(ajuste.amount), description: ajuste.description });
    if (ok) setAjuste({ kind: ajuste.kind, amount: "", description: "" });
  }

  return (
    <Panel titulo={linea.staff_name} subtitulo={[linea.staff_role, linea.metodo_pago, linea.cuenta_pago].filter(Boolean).join(" · ")} onClose={onClose}>
      <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
        <Celda label="Total a pagar" value={formatoMonto(t.total, m)} />
        <Celda label="Abonado" value={formatoMonto(t.abonado, m)} tone="good" />
        <Celda label="Saldo" value={formatoMonto(t.saldo, m)} tone={t.saldo > 0 ? "warn" : undefined} />
      </dl>

      <section aria-labelledby="planilla-calculo" className="space-y-2">
        <h3 id="planilla-calculo" className="text-sm font-semibold text-foreground">Cálculo</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs text-muted-foreground">
            Salario base de la quincena ({m})
            <Input type="number" min="0" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} disabled={!editable} className="mt-1" />
          </label>
          {editable && Number(base) !== linea.base && (
            <Button size="sm" disabled={ocupado || !(Number(base) >= 0)} onClick={() => void accion("base", { line_id: linea.id, base: Number(base) })}>
              Guardar base
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linea.ajustes.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted-foreground">Sin extras ni rebajos.</li>}
          {linea.ajustes.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="text-foreground">{etiquetaAjuste(a.kind)}</span>
                {a.description && <span className="text-muted-foreground"> · {a.description}</span>}
                <span className="block text-xs text-muted-foreground">{a.created_by} · {fechaHora(a.created_at)}</span>
              </span>
              <span className={cn("whitespace-nowrap font-medium tabular-nums", signoAjuste(a.kind) > 0 ? "text-emerald-400" : "text-red-400")}>
                {signoAjuste(a.kind) > 0 ? "+" : "−"}
                {formatoMonto(a.amount, m)}
              </span>
              {editable && (
                <button
                  type="button"
                  aria-label={`Quitar ${etiquetaAjuste(a.kind)}`}
                  disabled={ocupado}
                  onClick={() => void accion("quitar_ajuste", { ajuste_id: a.id })}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form onSubmit={guardarAjuste} className="grid grid-cols-[8.5rem_7rem_1fr_auto] items-end gap-2">
            <label className="text-xs text-muted-foreground">
              Tipo
              <select value={ajuste.kind} onChange={(e) => setAjuste({ ...ajuste, kind: e.target.value as AjusteTipo })} className={cn(SELECT, "mt-1")}>
                {AJUSTES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.signo > 0 ? "+ " : "− "}
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Monto
              <Input type="number" min="0.01" step="0.01" required value={ajuste.amount} onChange={(e) => setAjuste({ ...ajuste, amount: e.target.value })} className="mt-1" />
            </label>
            <label className="text-xs text-muted-foreground">
              Detalle
              <Input value={ajuste.description} onChange={(e) => setAjuste({ ...ajuste, description: e.target.value })} placeholder="Ej.: 6 h extra del sábado" className="mt-1" />
            </label>
            <Button type="submit" variant="outline" size="sm" disabled={ocupado || !(Number(ajuste.amount) > 0)}>
              Agregar
            </Button>
          </form>
        )}
      </section>

      <section aria-labelledby="planilla-abonos" className="space-y-2">
        <h3 id="planilla-abonos" className="text-sm font-semibold text-foreground">Abonos</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {linea.abonos.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted-foreground">Todavía no hay abonos.</li>}
          {linea.abonos.map((a) => (
            <li key={a.id} className={cn("flex items-start gap-3 px-3 py-2 text-[13px]", a.voided_at && "opacity-60")}>
              <span className="min-w-0 flex-1">
                <span className={cn("text-foreground", a.voided_at && "line-through")}>
                  {fechaCorta(a.paid_on)} · {a.method || "Sin método"}
                  {a.reference && ` · ref. ${a.reference}`}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Registró {a.created_by} · {fechaHora(a.created_at)}
                  {m !== "CRC" && a.exchange_rate ? ` · TC ${a.exchange_rate} = ${formatoMonto(a.amount_crc, "CRC")}` : ""}
                </span>
                {a.note && <span className="block text-xs text-muted-foreground">{a.note}</span>}
                {a.voided_at && (
                  <span className="block text-xs text-red-400">
                    Anulado por {a.voided_by} · {fechaHora(a.voided_at)}: {a.void_reason}
                  </span>
                )}
              </span>
              <span className={cn("whitespace-nowrap font-medium tabular-nums text-foreground", a.voided_at && "line-through")}>{formatoMonto(a.amount, m)}</span>
              {editable && !a.voided_at && (
                <button
                  type="button"
                  aria-label="Anular abono"
                  title="Anular (queda en el historial y se borra su gasto)"
                  disabled={ocupado}
                  onClick={() => {
                    const motivo = window.prompt("Motivo de la anulación (queda en la bitácora):");
                    if (motivo?.trim()) void accion("anular_abono", { abono_id: a.id, motivo: motivo.trim() }, "Abono anulado.");
                  }}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form onSubmit={guardarAbono} className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="text-xs text-muted-foreground">
                Monto ({m})
                <Input type="number" min="0.01" step="0.01" required value={abono.amount} onChange={(e) => setAbono({ ...abono, amount: e.target.value })} className="mt-1" />
              </label>
              <label className="text-xs text-muted-foreground">
                Fecha de pago
                <Input type="date" required value={abono.paid_on} onChange={(e) => setAbono({ ...abono, paid_on: e.target.value })} className="mt-1" />
              </label>
              <label className="text-xs text-muted-foreground">
                Método
                <select value={abono.method} onChange={(e) => setAbono({ ...abono, method: e.target.value })} className={cn(SELECT, "mt-1")}>
                  {Array.from(new Set([abono.method, ...METODOS_PAGO])).filter(Boolean).map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Referencia / comprobante
                <Input value={abono.reference} onChange={(e) => setAbono({ ...abono, reference: e.target.value })} placeholder="N.º de operación" className="mt-1" />
              </label>
              {m !== "CRC" && (
                <label className="text-xs text-muted-foreground">
                  Tipo de cambio {m}→CRC
                  <Input type="number" min="0.0001" step="0.0001" required value={abono.exchange_rate} onChange={(e) => setAbono({ ...abono, exchange_rate: e.target.value })} className="mt-1" />
                </label>
              )}
              <label className="text-xs text-muted-foreground">
                Nota
                <Input value={abono.note} onChange={(e) => setAbono({ ...abono, note: e.target.value })} placeholder="Opcional" className="mt-1" />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {colones != null && colones > 0 ? `Va a Gastos como ${formatoMonto(colones, "CRC")} (planilla).` : "Va a Gastos como gasto de planilla."}
              </p>
              <Button type="submit" size="sm" className="gap-1.5" disabled={ocupado || !(Number(abono.amount) > 0)}>
                <Wallet className="h-3.5 w-3.5" /> Registrar abono
              </Button>
            </div>
          </form>
        )}
        {editable && linea.abonos.length === 0 && linea.ajustes.length === 0 && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              if (window.confirm(`¿Quitar a ${linea.staff_name} de esta quincena?`)) void accion("quitar_persona", { line_id: linea.id }).then((ok) => ok && onClose());
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Quitar de esta quincena
          </button>
        )}
      </section>

      <section aria-labelledby="planilla-historial" className="space-y-2">
        <h3 id="planilla-historial" className="text-sm font-semibold text-foreground">Historial</h3>
        <ListaEventos eventos={eventos} vacio="Sin cambios registrados." />
      </section>
    </Panel>
  );
}

function ListaEventos({ eventos, vacio }: { eventos: Evento[]; vacio: string }) {
  if (!eventos.length) return <p className="text-[13px] text-muted-foreground">{vacio}</p>;
  return (
    <ol className="space-y-2">
      {eventos.map((e) => (
        <li key={e.id} className="text-[13px]">
          <span className="text-foreground">{describirEvento(e)}</span>
          <span className="block text-xs text-muted-foreground">
            {e.actor} · {fechaHora(e.created_at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Bitacora({ eventos, onClose }: { eventos: Evento[]; onClose: () => void }) {
  return (
    <section aria-labelledby="planilla-bitacora" className="rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 id="planilla-bitacora" className="text-sm font-semibold text-foreground">Bitácora de la quincena</h3>
          <p className="text-[13px] text-muted-foreground">Cada cambio con quién lo hizo y cuándo. No se puede editar ni borrar.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar bitácora" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <ListaEventos eventos={eventos} vacio="Sin movimientos todavía." />
      </div>
    </section>
  );
}

function Salarios({
  personas,
  accion,
  onClose,
}: {
  personas: PersonaPlanilla[];
  accion: (nombre: string, payload: Record<string, unknown>, ok?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [filas, setFilas] = useState(() =>
    Object.fromEntries(personas.map((p) => [p.id, { salario: String(p.salario_quincenal || ""), moneda: p.moneda || "PEN", metodo: p.metodo_pago, cuenta: p.cuenta_pago }]))
  );
  const [guardando, setGuardando] = useState<number | null>(null);
  const cambio = (p: PersonaPlanilla) => {
    const f = filas[p.id];
    return f && (Number(f.salario || 0) !== p.salario_quincenal || f.moneda !== p.moneda || f.metodo !== p.metodo_pago || f.cuenta !== p.cuenta_pago);
  };
  return (
    <Panel titulo="Personal y salarios" subtitulo="Salario base por quincena y cómo se le paga. Aplica a las quincenas que se creen desde ahora." onClose={onClose}>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {personas.filter((p) => p.active).map((p) => {
          const f = filas[p.id];
          return (
            <li key={p.id} className="space-y-2 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-foreground">
                  {p.name} <span className="font-normal text-muted-foreground">· {p.role}</span>
                </p>
                {cambio(p) && (
                  <Button
                    size="sm"
                    disabled={guardando === p.id}
                    onClick={async () => {
                      setGuardando(p.id);
                      await accion("salario", { staff_id: p.id, salario_quincenal: Number(f.salario || 0), moneda: f.moneda, metodo_pago: f.metodo, cuenta_pago: f.cuenta }, `Salario de ${p.name} guardado.`);
                      setGuardando(null);
                    }}
                  >
                    Guardar
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-[1fr_5.5rem] gap-2 sm:grid-cols-[1fr_5.5rem_8.5rem_1fr]">
                <Input type="number" min="0" step="0.01" aria-label={`Salario por quincena de ${p.name}`} placeholder="Salario por quincena" value={f.salario} onChange={(e) => setFilas({ ...filas, [p.id]: { ...f, salario: e.target.value } })} />
                <select aria-label={`Moneda de ${p.name}`} value={f.moneda} onChange={(e) => setFilas({ ...filas, [p.id]: { ...f, moneda: e.target.value } })} className={SELECT}>
                  {MONEDAS.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <select aria-label={`Método de pago de ${p.name}`} value={f.metodo} onChange={(e) => setFilas({ ...filas, [p.id]: { ...f, metodo: e.target.value } })} className={SELECT}>
                  <option value="">Método…</option>
                  {METODOS_PAGO.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <Input aria-label={`Cuenta o número de ${p.name}`} placeholder="Cuenta / número" value={f.cuenta} onChange={(e) => setFilas({ ...filas, [p.id]: { ...f, cuenta: e.target.value } })} />
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
