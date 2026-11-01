"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UpsellProductOption } from "@/lib/order-upsell-catalog";

interface Receipt { id: string; completed: boolean; cancelled?: boolean; replacement_name: string | null; replacement_id: string | null; total: number; message: string }
interface Preview { id: string; name: string; total: number; fingerprint: string; items: Array<{ name: string; quantity: number; price: number }> }
interface Props {
  store: string; orderName: string; symbol: string; advisorId: number | null; canal: string;
  disabled: boolean; onBusy: (busy: boolean) => void; onComplete: () => void;
  onPending: (pending: boolean) => void;
}
const inputClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function OrderUpsellPanel({ store, orderName, symbol, advisorId, canal, disabled, onBusy, onComplete, onPending }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<UpsellProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UpsellProductOption | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const money = (n: number) => `${symbol}${n.toLocaleString("es-CR", { maximumFractionDigits: 2 })}`;
  const endpoint = `/api/finance/order-upsell?store=${encodeURIComponent(store)}`;

  // Recover an unfinished operation on reopen, without requiring the advisor to re-enter it.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`${endpoint}&order=${encodeURIComponent(orderName)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo cargar el pedido para upsell.");
        setPreview(body.original ?? null); setReceipt(body.receipt ?? null);
        onPending(Boolean(body.receipt && !body.receipt.completed));
        if (body.receipt) setOpen(true);
        if (body.receipt?.completed) onComplete();
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo abrir el upsell."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
    // onComplete is a notification; reloading when its identity changes would restart the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, orderName]);

  useEffect(() => {
    if (!open || receipt || query.trim().length < 3) { setProducts([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setError("");
      try {
        const response = await fetch(`${endpoint}&q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo buscar el producto.");
        setProducts(body.products ?? []);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo buscar el producto."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); setSearching(false); };
  }, [open, receipt, query, endpoint]);

  async function submit() {
    if (busy || disabled || (!receipt && (!preview || !selected || !advisorId))) return;
    setBusy(true); onBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_name: orderName, staff_id: advisorId, canal,
          action: receipt?.cancelled ? "restart_cancelled" : undefined,
          fingerprint: preview?.fingerprint, product_id: selected?.product_id, variant_id: selected?.variant_id,
          quantity: Number(quantity), price: Number(price) }),
      });
      const body = await response.json();
      if (response.ok && body.reset) {
        setReceipt(null); setPreview(body.original); setSelected(null); setQuery(""); setQuantity("1"); setPrice("");
        onPending(false); setMessage(body.message); return;
      }
      if (body.receipt) { setReceipt(body.receipt); onPending(!body.receipt.completed); }
      if (!response.ok) throw new Error(body.error || "No se pudo completar el upsell.");
      setMessage(body.warning || body.message || "");
      if (body.ok && body.receipt?.completed) onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar el upsell. Vuelve a verificar antes de repetir.");
      // The server may have accepted the POST before the connection was lost.
      try {
        const response = await fetch(`${endpoint}&order=${encodeURIComponent(orderName)}`, { cache: "no-store" });
        const body = await response.json();
        if (response.ok && body.receipt) { setReceipt(body.receipt); onPending(!body.receipt.completed); if (body.receipt.completed) { setError(""); onComplete(); } }
      } catch { setMessage("Al continuar se verificará el intento guardado antes de crear un pedido."); }
    } finally { setBusy(false); onBusy(false); }
  }

  const extra = Math.round(Number(price) * Number(quantity) * 100) / 100;
  const valid = Boolean(selected) && Number.isInteger(Number(quantity)) && Number(quantity) > 0 && Number(quantity) <= 100 && Number(price) > 0 && Number.isFinite(extra);
  if (receipt?.completed) return (
    <div role="status" className="space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-emerald-300"><CheckCircle2 className="h-4 w-4" />Pedido con upsell confirmado</p>
      <p>Nuevo pedido <strong>{receipt.replacement_name || receipt.replacement_id}</strong> · {money(receipt.total)}.</p>
      <p className="text-xs text-muted-foreground">{orderName} quedó anulado. Ambos pedidos están vinculados en la bitácora.</p>
      {message && <p className="text-xs">{message}</p>}
    </div>
  );
  return (
    <div className="border-y border-border py-3">
      <Button variant="outline" size="sm" className="gap-2" disabled={disabled || busy} aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <Plus className="h-3.5 w-3.5" />{receipt ? "Upsell en curso" : "Añadir upsell"}
      </Button>
      {open && <div className="mt-3 space-y-3">
        {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Verificando pedido en iComfly…</p>}
        {receipt ? <p className="text-sm">{receipt.message} {receipt.replacement_id && <span>Nuevo pedido: {receipt.replacement_name || receipt.replacement_id}.</span>}</p> : preview && <>
          <div className="space-y-1 text-xs">
            {preview.items.map((item, i) => <p key={i}>{item.quantity} × {item.name}</p>)}
            <p className="text-muted-foreground">Importe original: {money(preview.total)}</p>
          </div>
          <label className="block space-y-1 text-xs"><span className="flex items-center gap-1"><Search className="h-3 w-3" />Buscar producto en iComfly</span>
            <input className={inputClass} value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} placeholder="Escribe al menos 3 letras" disabled={busy} />
          </label>
          {searching && <p role="status" className="text-xs text-muted-foreground">Buscando productos…</p>}
          {!searching && query.trim().length >= 3 && !products.length && !error && <p className="text-xs text-muted-foreground">No hay coincidencias. Prueba otra parte del nombre.</p>}
          {products.length > 0 && <label className="block space-y-1 text-xs"><span>Producto y variante</span>
            <select className={inputClass} disabled={busy} value={selected ? `${selected.product_id}:${selected.variant_id ?? ""}` : ""} onChange={e => {
              const p = products.find(p => `${p.product_id}:${p.variant_id ?? ""}` === e.target.value) ?? null;
              setSelected(p); setPrice(p ? String(p.price) : "");
            }}><option value="">Selecciona un producto</option>{products.map(p => <option key={`${p.product_id}:${p.variant_id ?? ""}`} value={`${p.product_id}:${p.variant_id ?? ""}`}>{p.name}</option>)}</select>
          </label>}
          {selected && <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs"><span>Cantidad</span><input className={inputClass} type="number" min="1" max="100" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={busy} /></label>
            <label className="space-y-1 text-xs"><span>Precio por unidad ({symbol})</span><input className={inputClass} type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} disabled={busy} /></label>
          </div>}
          {valid && <div className="flex flex-wrap justify-between gap-1 text-sm"><span>Upsell: +{money(extra)}</span><strong>Nuevo total: {money(Math.round((preview.total + extra) * 100) / 100)}</strong></div>}
          <p className="text-xs text-muted-foreground">Al confirmar, se creará el pedido completo, se anulará {orderName} y el nuevo quedará confirmado en iComfly.</p>
          {!advisorId && <p className="text-xs text-amber-300">Selecciona tu nombre arriba para registrar el cierre.</p>}
        </>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
        {(preview || receipt) && <Button size="sm" className="gap-2" disabled={disabled || busy || loading || (!receipt && (!valid || !advisorId))} onClick={submit}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{busy ? "Verificando operación…" : receipt?.cancelled ? "Iniciar otro upsell" : receipt ? "Continuar y verificar upsell" : "Añadir upsell y confirmar"}
        </Button>}
      </div>}
    </div>
  );
}
