"use client";

import { Phone, Clock, ShoppingBag, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CallRecord } from "@/lib/redis";

const STATUS_CONFIG: Record<
  CallRecord["status"],
  { label: string; variant: "success" | "destructive" | "warning" | "muted" | "default" | "secondary" | "outline" }
> = {
  calling: { label: "Llamando...", variant: "default" },
  confirmed: { label: "Confirmado", variant: "success" },
  upsell_accepted: { label: "Upsell ✓", variant: "success" },
  cancelled: { label: "Cancelado", variant: "destructive" },
  no_answer: { label: "No Contesta", variant: "warning" },
  error: { label: "Error", variant: "muted" },
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString("es-CR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "—";
  }
}

export function CallsTable({ calls }: { calls: CallRecord[] }) {
  if (!calls.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            Llamadas Recientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Phone className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm">No hay llamadas registradas aún.</p>
            <p className="text-xs mt-1 opacity-70">
              Las llamadas aparecerán aquí cuando Shopify envíe nuevos pedidos.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          Llamadas Recientes
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            {calls.length} registros
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                  Hora
                </th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                  Cliente
                </th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">
                  Producto
                </th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">
                  Total
                </th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">
                  Resultado
                </th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden sm:table-cell">
                  Duración
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const statusConf = STATUS_CONFIG[call.status] ?? {
                  label: call.status,
                  variant: "muted" as const,
                };
                return (
                  <tr
                    key={call.call_id}
                    className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                  >
                    {/* Time */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-mono text-foreground">
                          {formatTime(call.started_at)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(call.started_at)}
                        </span>
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {call.customer_name || "—"}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {call.phone}
                        </span>
                      </div>
                    </td>

                    {/* Products */}
                    <td className="py-3 px-4 hidden md:table-cell">
                      <div className="flex items-start gap-1.5">
                        <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {call.products || "—"}
                        </span>
                      </div>
                    </td>

                    {/* Total */}
                    <td className="py-3 px-4 hidden lg:table-cell">
                      <span className="font-mono text-foreground text-xs">
                        {call.total || "—"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <Badge variant={statusConf.variant}>
                          {statusConf.label}
                        </Badge>
                        {call.upsell_accepted && call.status !== "upsell_accepted" && (
                          <Badge variant="success" className="text-xs">
                            <TrendingUp className="h-2.5 w-2.5 mr-1" />
                            Upsell
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Duration */}
                    <td className="py-3 px-4 hidden sm:table-cell">
                      {call.duration_seconds > 0 ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span className="font-mono text-xs">
                            {formatDuration(call.duration_seconds)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
