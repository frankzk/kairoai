"use client";

import { useEffect, useState } from "react";
import { Phone, RefreshCw, AlertCircle, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
interface ShopifyOrderSummary {
  id: string;
  order_number: number;
  name: string;
  customer_name: string;
  phone: string | null;
  products: string;
  total: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
}

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-().]/g, "");
  if (!cleaned.startsWith("+")) {
    if (cleaned.length === 8) cleaned = `+506${cleaned}`;
    else if (!cleaned.startsWith("506")) cleaned = `+${cleaned}`;
    else cleaned = `+${cleaned}`;
  }
  return cleaned;
}

export function OrdersTable() {
  const [orders, setOrders] = useState<ShopifyOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [calling, setCalling] = useState<Record<string, boolean>>({});
  const [callResults, setCallResults] = useState<Record<string, "ok" | "err">>({});

  async function fetchOrders(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/shopify/orders", { cache: "no-store" });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setOrders(data.orders ?? []);
    } catch {
      setError("Error al cargar pedidos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchOrders();
  }, []);

  async function handleCall(order: ShopifyOrderSummary) {
    if (!order.phone) return;
    setCalling((c) => ({ ...c, [order.id]: true }));
    try {
      const res = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: normalizePhone(order.phone),
          order_id: order.id,
          force: true,
        }),
      });
      setCallResults((r) => ({ ...r, [order.id]: res.ok ? "ok" : "err" }));
    } catch {
      setCallResults((r) => ({ ...r, [order.id]: "err" }));
    } finally {
      setCalling((c) => ({ ...c, [order.id]: false }));
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("es-CR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Pedidos pendientes
            {orders.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({orders.length})
              </span>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchOrders(true)}
            disabled={refreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="h-48 animate-pulse bg-muted/30 rounded-b-lg" />
        ) : error ? (
          <div className="flex items-center gap-2 px-6 py-8 text-sm text-amber-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No hay pedidos sin atender.</p>
            <p className="text-xs mt-1">Los nuevos pedidos de Shopify aparecen aquí.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Pedido</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Cliente</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Productos</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium">Total</th>
                  <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Fecha</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isCalling = calling[order.id];
                  const result = callResults[order.id];
                  const noPhone = !order.phone;

                  return (
                    <tr
                      key={order.id}
                      className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs text-primary">
                          {order.name}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-xs text-foreground">
                            {order.customer_name}
                          </p>
                          {order.phone ? (
                            <p className="text-xs text-muted-foreground font-mono">
                              {order.phone}
                            </p>
                          ) : (
                            <p className="text-xs text-red-400 flex items-center gap-1">
                              <PhoneOff className="h-3 w-3" /> Sin teléfono
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <p className="text-xs text-muted-foreground max-w-[200px] truncate" title={order.products}>
                          {order.products}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">
                        {order.total}
                      </td>
                      <td className="py-3 px-4 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(order.created_at)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {result === "ok" ? (
                          <Badge variant="success" className="text-xs">
                            Llamando
                          </Badge>
                        ) : result === "err" ? (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isCalling || noPhone}
                            onClick={() => handleCall(order)}
                            className="gap-1.5 text-xs h-7 px-2.5"
                            title={noPhone ? "Este pedido no tiene teléfono registrado" : ""}
                          >
                            <Phone className={`h-3 w-3 ${isCalling ? "animate-pulse" : ""}`} />
                            {isCalling ? "Llamando..." : "Llamar"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
