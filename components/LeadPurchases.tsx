"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PurchaseRow {
  name: string;
  created_at: string | null;
  total: number;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
  cancelled: boolean;
  items: Array<{ title: string; quantity: number }>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtMoney(total: number, currency: string): string {
  const symbol = currency === "HNL" ? "L" : "₡";
  return `${symbol}${Math.round(total).toLocaleString("es-CR")}`;
}

function statusBadge(row: PurchaseRow): { label: string; variant: "success" | "warning" | "destructive" | "muted" } {
  if (row.cancelled) return { label: "Cancelado", variant: "destructive" };
  if (row.fulfillment_status === "fulfilled") return { label: "Despachado", variant: "success" };
  if (row.financial_status === "paid") return { label: "Pagado", variant: "success" };
  if (row.financial_status === "pending") return { label: "Pendiente", variant: "warning" };
  return { label: row.financial_status || "—", variant: "muted" };
}

// Compras anteriores del cliente (Shopify local, por telefono). Mismo patron
// de acordeon que LeadHistory: si no hay compras no ocupa espacio.
export default function LeadPurchases({ leadId, store }: { leadId: number; store: string }) {
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/leads/${leadId}/orders?store=${store}`);
        const data = await res.json();
        if (alive) setRows(data.orders ?? []);
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leadId, store]);

  if (!loading && rows.length === 0) return null;

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        <span>Compras anteriores{rows.length ? ` (${rows.length})` : ""}</span>
        {open ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="max-h-48 space-y-2 overflow-y-auto px-4 pb-3">
          {rows.map((r) => {
            const badge = statusBadge(r);
            const itemsSummary = r.items
              .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.title}` : i.title))
              .join(", ");
            return (
              <div key={r.name} className="border-l-2 border-border pl-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-medium">{r.name}</span>
                  <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-mono">{fmtMoney(r.total, r.currency)}</span>
                  <Badge variant={badge.variant} className="text-[10px]">
                    {badge.label}
                  </Badge>
                </div>
                {itemsSummary && (
                  <div className="mt-0.5 truncate text-muted-foreground" title={itemsSummary}>
                    {itemsSummary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
