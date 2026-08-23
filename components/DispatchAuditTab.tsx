"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, PackageX, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FinanceStoreCode } from "@/lib/store-config";

type AuditKind = "desfase" | "estancado";
type AuditSeverity = "alta" | "media";

interface AuditFinding {
  guide_number: string;
  order_name: string;
  customer_name: string;
  customer_phone: string;
  amount: number;
  courier_status: string;
  courier_code: string;
  courier_event: string;
  latest_at: string | null;
  crm_status: string;
  crm_synced_at: string | null;
  kind: AuditKind;
  severity: AuditSeverity;
  reason: string;
  action: string;
  days_stuck: number;
}

interface AuditResponse {
  findings: AuditFinding[];
  summary: {
    desfase_entregado: number;
    desfase_devuelto: number;
    monto_devuelto_mal_contado: number;
    estancados: number;
    total: number;
  } | null;
  reviewed: number;
  unmatched: number;
  courier_checked_at: string | null;
  crm_synced_at: string | null;
  error?: string;
}

const COURIER_LABEL: Record<string, string> = {
  delivered: "Entregado",
  returned: "Devuelto",
  not_delivered: "No entregado",
  en_route: "En ruta",
  incident: "Incidencia",
  pending: "Pendiente",
  unknown: "Desconocido",
};

function money(value: number): string {
  return `₡${Math.round(value).toLocaleString("es-CR")}`;
}

function whenCR(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

type Filter = "todos" | "desfase" | "estancado";

export default function DispatchAuditTab({ storeCode }: { storeCode: FinanceStoreCode }) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/finance/dispatch-audit?store=${encodeURIComponent(storeCode)}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as AuditResponse;
      setData(body);
      if (body.error) setError(body.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al auditar el despacho");
    } finally {
      setLoading(false);
    }
  }, [storeCode]);

  useEffect(() => {
    load();
  }, [load]);

  const findings = useMemo(() => data?.findings ?? [], [data]);
  const shown = useMemo(
    () => (filter === "todos" ? findings : findings.filter((f) => f.kind === filter)),
    [findings, filter]
  );
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Auditoría de despacho</h2>
          <p className="text-sm text-muted-foreground">
            Paquetes donde el courier y el CRM no dicen lo mismo, y paquetes detenidos demasiado
            tiempo en un mismo punto.
          </p>
        </div>
        <Button onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Revisando..." : "Revisar"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-60 items-center justify-center border border-border bg-card text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Cruzando courier con CRM...
          </span>
        </div>
      ) : findings.length === 0 ? (
        <div className="flex h-60 flex-col items-center justify-center gap-2 border border-dashed border-border bg-card text-sm text-muted-foreground">
          <ShieldCheck className="h-6 w-6 text-emerald-500" />
          <p>Todo cuadra: {data?.reviewed ?? 0} guías revisadas, sin desfases ni paquetes detenidos.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryCard
              label="Devueltos mal contados"
              value={String(summary?.desfase_devuelto ?? 0)}
              hint="el CRM los cuenta como venta en curso"
              tone="danger"
            />
            <SummaryCard
              label="Plata mal contada"
              value={money(summary?.monto_devuelto_mal_contado ?? 0)}
              hint="suma de esas devoluciones"
              tone="danger"
            />
            <SummaryCard
              label="Entregados sin actualizar"
              value={String(summary?.desfase_entregado ?? 0)}
              hint="ya llegaron; solo hay que corregirlos"
              tone="warn"
            />
            <SummaryCard
              label="Detenidos"
              value={String(summary?.estancados ?? 0)}
              hint="sin movimiento en el courier"
              tone="warn"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {data?.reviewed ?? 0} guías cruzadas · courier leído {whenCR(data?.courier_checked_at ?? null)} ·
            CRM leído {whenCR(data?.crm_synced_at ?? null)}
            {data?.unmatched ? ` · ${data.unmatched} guías sin pedido o sin ficha en el CRM` : ""}
          </p>

          <div className="flex flex-wrap gap-2">
            <FilterChip active={filter === "todos"} onClick={() => setFilter("todos")}>
              Todos ({findings.length})
            </FilterChip>
            <FilterChip active={filter === "desfase"} onClick={() => setFilter("desfase")}>
              Desfases ({findings.filter((f) => f.kind === "desfase").length})
            </FilterChip>
            <FilterChip active={filter === "estancado"} onClick={() => setFilter("estancado")}>
              Detenidos ({findings.filter((f) => f.kind === "estancado").length})
            </FilterChip>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> {shown.length} paquetes por revisar
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Pedido / Guía</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Courier dice</th>
                    <th className="px-3 py-2">CRM dice</th>
                    <th className="px-3 py-2">Días</th>
                    <th className="px-3 py-2">Qué hacer</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.guide_number} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{f.order_name || "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{f.guide_number}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{f.customer_name || "—"}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {f.customer_phone || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={f.courier_status === "delivered" ? "success" : "destructive"}>
                          {COURIER_LABEL[f.courier_status] ?? f.courier_status}
                        </Badge>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {f.courier_code} · {f.courier_event || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="muted">{f.crm_status || "—"}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className={f.days_stuck >= 14 ? "font-semibold text-destructive" : ""}>
                          {f.days_stuck}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-1.5">
                          {f.severity === "alta" ? (
                            <PackageX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                          )}
                          <div>
                            <div>{f.action}</div>
                            <div className="text-[11px] text-muted-foreground">{f.reason}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{money(f.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger" | "warn";
}) {
  const toneClass =
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
