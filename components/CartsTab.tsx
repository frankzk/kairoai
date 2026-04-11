"use client";

import { useEffect, useState } from "react";
import { Phone, RefreshCw, AlertCircle, PhoneOff, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CartSummary {
  id: string;
  token: string;
  customer_name: string;
  phone: string | null;
  email: string | null;
  products: string;
  total: string;
  checkout_url: string;
  created_at: string;
  updated_at: string;
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

export function CartsTab() {
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [calling, setCalling] = useState<Record<string, boolean>>({});
  const [callResults, setCallResults] = useState<Record<string, "ok" | "err">>({});

  async function fetchCarts(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    setError("");
    try {
      const res = await fetch("/api/shopify/checkouts", { cache: "no-store" });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setCarts(data.carts ?? []);
    } catch {
      setError("Error al cargar carritos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchCarts();
  }, []);

  async function handleCall(cart: CartSummary) {
    if (!cart.phone) return;
    const cartId = `checkout-${cart.token}`;
    setCalling((c) => ({ ...c, [cartId]: true }));
    try {
      const res = await fetch("/api/calls/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: normalizePhone(cart.phone),
          order_id: cartId,
          force: true,
          customer_name: cart.customer_name,
          products: cart.products,
          total: cart.total,
          event_type: "abandoned_cart",
        }),
      });
      setCallResults((r) => ({ ...r, [cartId]: res.ok ? "ok" : "err" }));
    } catch {
      setCallResults((r) => ({ ...r, [cartId]: "err" }));
    } finally {
      setCalling((c) => ({ ...c, [cartId]: false }));
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

  if (loading) {
    return <div className="h-48 animate-pulse bg-muted/30 rounded-b-lg" />;
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2 px-6 py-8 text-sm text-amber-400">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
        {error.includes("read_checkouts") && (
          <p className="text-xs text-muted-foreground ml-6">
            Re-autenticá Shopify en <code>/api/shopify/auth</code> para obtener el permiso.
          </p>
        )}
      </div>
    );
  }

  if (carts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <ShoppingCart className="h-10 w-10 mb-3 opacity-20" />
        <p className="text-sm">No hay carritos abandonados en este momento.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="text-xs text-muted-foreground">{carts.length} carrito{carts.length !== 1 ? "s" : ""} abandonado{carts.length !== 1 ? "s" : ""}</span>
        <Button variant="ghost" size="sm" onClick={() => fetchCarts(true)} disabled={refreshing} className="gap-1.5 text-xs h-7">
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-muted-foreground font-medium">Cliente</th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Productos</th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium">Total</th>
              <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Abandonado</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => {
              const cartId = `checkout-${cart.token}`;
              const isCalling = calling[cartId];
              const result = callResults[cartId];
              const noPhone = !cart.phone;

              return (
                <tr key={cart.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4">
                    <div>
                      <p className="font-medium text-xs text-foreground">{cart.customer_name}</p>
                      {cart.phone ? (
                        <p className="text-xs text-muted-foreground font-mono">{cart.phone}</p>
                      ) : (
                        <p className="text-xs text-red-400 flex items-center gap-1">
                          <PhoneOff className="h-3 w-3" /> Sin teléfono
                        </p>
                      )}
                      {cart.email && (
                        <p className="text-xs text-muted-foreground truncate max-w-[140px]">{cart.email}</p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <p className="text-xs text-muted-foreground max-w-[200px] truncate" title={cart.products}>
                      {cart.products || "—"}
                    </p>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">{cart.total}</td>
                  <td className="py-3 px-4 hidden lg:table-cell">
                    <span className="text-xs text-muted-foreground">{formatDate(cart.updated_at)}</span>
                  </td>
                  <td className="py-3 px-4">
                    {result === "ok" ? (
                      <Badge variant="success" className="text-xs">Llamando</Badge>
                    ) : result === "err" ? (
                      <Badge variant="destructive" className="text-xs">Error</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isCalling || noPhone}
                        onClick={() => handleCall(cart)}
                        className="gap-1.5 text-xs h-7 px-2.5"
                        title={noPhone ? "Este carrito no tiene teléfono registrado" : ""}
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
    </div>
  );
}
