"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/ProductPicker";
import { Badge } from "@/components/ui/badge";
import type { ShopifyProductOption } from "@/app/api/shopify/products/route";

const VENDEDORA_KEY = "kairo:leads-vendedora";
const CR_PROVINCES = ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function matchProvince(raw?: string): string {
  if (!raw) return "";
  const n = norm(raw);
  return CR_PROVINCES.find((p) => norm(p) === n || n.includes(norm(p))) ?? "";
}

interface Staff {
  id: number;
  name: string;
  active: boolean;
}

interface LeadLike {
  id: number;
  name: string | null;
  phone: string;
}

interface OrderLine {
  key: number;
  product: ShopifyProductOption | null;
  quantity: number;
  price: string;
}

let lineSeq = 1;
const newLine = (): OrderLine => ({ key: lineSeq++, product: null, quantity: 1, price: "" });

export default function CreateOrderPanel({
  lead,
  store,
  onCreated,
}: {
  lead: LeadLike;
  store: string;
  onCreated: (orderName: string) => void;
}) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [vendedoraId, setVendedoraId] = useState<number | null>(null);
  const [products, setProducts] = useState<ShopifyProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [existingCustomer, setExistingCustomer] = useState<{ orders_count?: number } | null>(null);

  const [lines, setLines] = useState<OrderLine[]>([newLine()]);
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed_amount">("percentage");

  const [name, setName] = useState(lead.name ?? "");
  const [province, setProvince] = useState("");
  const [canton, setCanton] = useState("");
  const [address, setAddress] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "sinpe">("cod");

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asesoras + recordar la seleccionada.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/finance/payroll-staff`);
        const data = await res.json();
        const list: Staff[] = (data.staff ?? []).filter((s: Staff) => s.active !== false);
        setStaff(list);
        const saved = Number(window.localStorage.getItem(VENDEDORA_KEY));
        if (saved && list.some((s) => s.id === saved)) setVendedoraId(saved);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Productos de la tienda.
  useEffect(() => {
    (async () => {
      setProductsLoading(true);
      setProductsError("");
      try {
        const res = await fetch(`/api/shopify/products?store=${store}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al cargar productos");
        setProducts(data.products ?? data ?? []);
      } catch (err) {
        setProductsError(err instanceof Error ? err.message : "Error al cargar productos");
      } finally {
        setProductsLoading(false);
      }
    })();
  }, [store]);

  // Precarga desde Shopify si el cliente ya existe (por telefono).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/leads/${lead.id}/customer?store=${store}`);
        const data = await res.json();
        if (data?.found) {
          setExistingCustomer({ orders_count: data.orders_count });
          if (data.name) setName((prev) => prev || data.name);
          const prov = matchProvince(data.province);
          if (prov) setProvince(prov);
          if (data.city) setCanton((prev) => prev || data.city);
          if (data.address1) setAddress((prev) => prev || data.address1);
        }
      } catch {
        /* ignore: la precarga es best-effort */
      }
    })();
  }, [lead.id, store]);

  const selectVendedora = (id: number) => {
    setVendedoraId(id);
    try {
      window.localStorage.setItem(VENDEDORA_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  const updateLine = useCallback((key: number, patch: Partial<OrderLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const setLineProduct = useCallback((key: number, product: ShopifyProductOption | null) => {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? { ...l, product, price: product && !l.price ? String(product.price ?? "") : l.price }
          : l
      )
    );
  }, []);

  const addLine = () => setLines((prev) => [...prev, newLine()]);
  const removeLine = (key: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const gross = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0),
    [lines]
  );
  const total = useMemo(() => {
    const d = Number(discountValue) || 0;
    if (d <= 0) return gross;
    return discountType === "percentage" ? gross * (1 - d / 100) : Math.max(0, gross - d);
  }, [gross, discountValue, discountType]);

  const validLines = lines.filter((l) => l.product && Number(l.quantity) > 0 && Number(l.price) > 0);
  const canSubmit = vendedoraId != null && validLines.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          vendedora_id: vendedoraId,
          items: validLines.map((l) => ({
            variant_id: l.product!.variant_id,
            sku: l.product!.sku,
            title: l.product!.display_name,
            price: Number(l.price),
            quantity: Number(l.quantity),
          })),
          shipping: { name, province, canton, address, reference },
          discount: Number(discountValue) > 0 ? { value: Number(discountValue), type: discountType } : undefined,
          payment_method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al crear el pedido");
      onCreated(data.order_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear el pedido");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <p className="font-medium">Crear pedido</p>
        {existingCustomer && (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Cliente en Shopify
            {existingCustomer.orders_count != null ? ` · ${existingCustomer.orders_count} pedidos` : ""}
          </Badge>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">¿Quién eres? (asesora)</label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={vendedoraId ?? ""}
            onChange={(e) => selectVendedora(Number(e.target.value))}
          >
            <option value="" disabled>
              Selecciona tu nombre
            </option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Productos (multiples lineas) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Productos</label>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Agregar producto
            </button>
          </div>

          {lines.map((line, idx) => (
            <div key={line.key} className="rounded-md border border-border p-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Producto {idx + 1}</span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Quitar producto"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <ProductPicker
                label=""
                value={line.product}
                onChange={(p) => setLineProduct(line.key, p)}
                products={products}
                loading={productsLoading}
                error={productsError}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Cantidad</label>
                  <Input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">Precio unitario (₡)</label>
                  <Input
                    type="number"
                    min={0}
                    value={line.price}
                    onChange={(e) => updateLine(line.key, { price: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Descuento a nivel de pedido */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Descuento (todo el pedido)</label>
            <Input type="number" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo descuento</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed_amount")}
            >
              <option value="percentage">% porcentaje</option>
              <option value="fixed_amount">₡ monto fijo</option>
            </select>
          </div>
        </div>

        {/* Envio */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre destinatario</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Provincia</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
            >
              <option value="">—</option>
              {CR_PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Cantón</label>
            <Input value={canton} onChange={(e) => setCanton(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Dirección exacta</label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Referencia</label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Color de casa, punto de referencia..." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Método de pago</label>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as "cod" | "sinpe")}
          >
            <option value="cod">Contraentrega</option>
            <option value="sinpe">SINPE</option>
          </select>
        </div>
      </div>

      <div className="border-t border-border p-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Total{validLines.length > 1 ? ` · ${validLines.length} productos` : ""}
          </span>
          <span className="font-semibold">₡{total.toLocaleString("es-CR")}</span>
        </div>
        {!confirming ? (
          <Button className="w-full" disabled={!canSubmit} onClick={() => setConfirming(true)}>
            Revisar y crear pedido
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-center text-xs text-muted-foreground">
              Se creará un pedido REAL en Shopify por ₡{total.toLocaleString("es-CR")}. ¿Confirmas?
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" disabled={submitting} onClick={submit}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar y crear"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
