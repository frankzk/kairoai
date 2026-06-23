"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, Boxes, RefreshCw, Truck, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IcomflyOrderRecord, PayrollStaff } from "@/lib/finance-types";

type DispatchState = IcomflyOrderRecord["dispatch_state"];

interface SyncResponse {
  orders: IcomflyOrderRecord[];
  staff: PayrollStaff[];
  summary: {
    total: number;
    pendiente: number;
    despacho_solicitado: number;
    despachado: number;
    standby: number;
  } | null;
  error?: string;
}

const STATE_LABEL: Record<DispatchState, string> = {
  pendiente: "Pendiente",
  despacho_solicitado: "Despacho solicitado",
  despachado: "Despachado / Guía final",
};

// Fecha YYYY-MM-DD en hora de Costa Rica (para agrupar "el trabajo del día").
function crDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function crDateTime(iso: string | null): string {
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

function StateBadge({ row }: { row: IcomflyOrderRecord }) {
  if (row.is_standby) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" /> Standby
      </Badge>
    );
  }
  if (row.dispatch_state === "despachado") return <Badge variant="success">Despachado</Badge>;
  if (row.dispatch_state === "despacho_solicitado") return <Badge variant="info">Solicitado</Badge>;
  return <Badge variant="muted">Pendiente</Badge>;
}

export default function DispatchTab() {
  const [data, setData] = useState<SyncResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/icomfly/sync", { cache: "no-store" });
      const body = (await res.json()) as SyncResponse;
      setData(body);
      if (body.error) setMessage(body.error);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al cargar datos de despacho");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sync() {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/icomfly/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_pages: 10 }),
      });
      const body = await res.json();
      if (body.error) {
        setMessage(body.error);
      } else {
        setMessage(`Sincronizados ${body.synced} pedidos · ${body.agents_synced} agentes${body.has_more ? " (hay más páginas)" : ""}.`);
        await load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  const orders = useMemo(() => data?.orders ?? [], [data]);
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const summary = data?.summary;

  const staffName = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of staff) map.set(s.id, s.name);
    return map;
  }, [staff]);

  // Tablero diario (zona CR): por día, solicitados vs guía final cerrada + standby.
  const daily = useMemo(() => {
    const byDay = new Map<string, { day: string; solicitados: number; despachados: number; standby: number }>();
    for (const o of orders) {
      const day = crDate(o.requested_at) || crDate(o.icomfly_created_at);
      if (!day) continue;
      const bucket = byDay.get(day) ?? { day, solicitados: 0, despachados: 0, standby: 0 };
      if (o.dispatch_state === "despacho_solicitado") bucket.solicitados += 1;
      if (o.dispatch_state === "despachado") bucket.despachados += 1;
      if (o.is_standby) bucket.standby += 1;
      byDay.set(day, bucket);
    }
    return Array.from(byDay.values()).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
  }, [orders]);

  const standbyRows = useMemo(() => orders.filter((o) => o.is_standby), [orders]);

  // Productividad por persona de la planilla (confirmación + solicitud).
  const productivity = useMemo(() => {
    const map = new Map<string, { key: string; name: string; inPlanilla: boolean; confirmed: number; requested: number }>();
    const bump = (
      staffId: number | null,
      rawName: string,
      field: "confirmed" | "requested"
    ) => {
      if (!staffId && !rawName) return;
      const key = staffId ? `s:${staffId}` : `n:${rawName.toLowerCase()}`;
      const name = staffId ? staffName.get(staffId) ?? rawName : rawName;
      const entry = map.get(key) ?? { key, name, inPlanilla: Boolean(staffId), confirmed: 0, requested: 0 };
      entry[field] += 1;
      map.set(key, entry);
    };
    for (const o of orders) {
      if (o.confirmed_by_staff_id || o.confirmed_by_name) bump(o.confirmed_by_staff_id, o.confirmed_by_name, "confirmed");
      if (o.requested_by_staff_id || o.requested_by_name) bump(o.requested_by_staff_id, o.requested_by_name, "requested");
    }
    return Array.from(map.values()).sort((a, b) => b.requested + b.confirmed - (a.requested + a.confirmed));
  }, [orders, staffName]);

  const recent = useMemo(
    () =>
      [...orders]
        .sort((a, b) => String(b.requested_at ?? b.icomfly_created_at ?? "").localeCompare(String(a.requested_at ?? a.icomfly_created_at ?? "")))
        .slice(0, 100),
    [orders]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Estado de despacho</h2>
          <p className="text-sm text-muted-foreground">
            Confirmación y solicitud de despacho (iComfly) enlazadas con la planilla. Corte de almacén: 15:00 CR.
          </p>
        </div>
        <Button onClick={sync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar iComfly"}
        </Button>
      </div>

      {message && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div>
      )}

      {loading ? (
        <div className="flex h-60 items-center justify-center border border-border bg-card text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Cargando estado de despacho...
          </span>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex h-60 flex-col items-center justify-center gap-2 border border-dashed border-border bg-card text-sm text-muted-foreground">
          <Truck className="h-6 w-6" />
          <p>No hay pedidos de iComfly sincronizados todavía.</p>
          <p>Usá el botón “Sincronizar iComfly” para traer el estado de despacho.</p>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <SummaryCard label="Total" value={summary?.total ?? orders.length} icon={<Boxes className="h-4 w-4" />} />
            <SummaryCard label="Pendiente" value={summary?.pendiente ?? 0} />
            <SummaryCard label="Solicitado" value={summary?.despacho_solicitado ?? 0} tone="info" />
            <SummaryCard label="Despachado" value={summary?.despachado ?? 0} tone="success" />
            <SummaryCard label="Standby" value={summary?.standby ?? 0} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
          </div>

          {/* Alertas de standby */}
          {standbyRows.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Standby: solicitados sin guía final ({standbyRows.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Pedido</th>
                      <th className="px-3 py-2">Solicitó</th>
                      <th className="px-3 py-2">Solicitado</th>
                      <th className="px-3 py-2">Courier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standbyRows.slice(0, 50).map((o) => (
                      <tr key={o.icomfly_order_id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{o.order_number || o.shopify_display_number || o.icomfly_order_id}</td>
                        <td className="px-3 py-2">{nameOf(o.requested_by_staff_id, o.requested_by_name, staffName)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{crDateTime(o.requested_at)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{o.carrier_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Tablero diario */}
          <Card>
            <CardHeader>
              <CardTitle>Tablero diario (hora CR)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Día</th>
                    <th className="px-3 py-2">Solicitados</th>
                    <th className="px-3 py-2">Despachados</th>
                    <th className="px-3 py-2">Standby</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.day} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{d.day}</td>
                      <td className="px-3 py-2">{d.solicitados}</td>
                      <td className="px-3 py-2">{d.despachados}</td>
                      <td className="px-3 py-2">{d.standby > 0 ? <Badge variant="destructive">{d.standby}</Badge> : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Productividad por persona */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-4 w-4" /> Productividad por persona (planilla)
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Persona</th>
                    <th className="px-3 py-2">Confirmados</th>
                    <th className="px-3 py-2">Despachos solicitados</th>
                  </tr>
                </thead>
                <tbody>
                  {productivity.map((p) => (
                    <tr key={p.key} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">
                        {p.name || "—"}
                        {!p.inPlanilla && (
                          <Badge variant="warning" className="ml-2">No en planilla</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">{p.confirmed}</td>
                      <td className="px-3 py-2">{p.requested}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Pedidos con estado + atribución */}
          <Card>
            <CardHeader>
              <CardTitle>Pedidos ({recent.length} más recientes)</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Confirmó</th>
                    <th className="px-3 py-2">Solicitó</th>
                    <th className="px-3 py-2">Guía final</th>
                    <th className="px-3 py-2">Courier</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((o) => (
                    <tr key={o.icomfly_order_id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{o.order_number || o.shopify_display_number || o.icomfly_order_id}</td>
                      <td className="px-3 py-2"><StateBadge row={o} /></td>
                      <td className="px-3 py-2">{nameOf(o.confirmed_by_staff_id, o.confirmed_by_name, staffName)}</td>
                      <td className="px-3 py-2">{nameOf(o.requested_by_staff_id, o.requested_by_name, staffName)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {o.dispatch_state === "despachado"
                          ? `${crDateTime(o.guide_final_at)}${o.guide_final_source ? ` · ${o.guide_final_source}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{o.carrier_name || "—"}</td>
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

function nameOf(staffId: number | null, rawName: string, staffName: Map<number, string>): React.ReactNode {
  if (staffId) return staffName.get(staffId) ?? rawName ?? "—";
  if (rawName) {
    return (
      <span>
        {rawName} <Badge variant="warning" className="ml-1">sin planilla</Badge>
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "info" | "success" | "danger";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-emerald-500"
        : tone === "info"
          ? "text-sky-500"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value.toLocaleString("es-CR")}</div>
    </div>
  );
}
