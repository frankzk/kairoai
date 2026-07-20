"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductPicker } from "@/components/ProductPicker";
import type { ShopifyProductOption } from "@/app/api/shopify/products/route";

const VENDEDORA_KEY = "kairo:leads-vendedora";
const CR_PROVINCES = ["San José", "Alajuela", "Cartago", "Heredia", "Guanacaste", "Puntarenas", "Limón"];

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

export default function CreateOrderModal({
  lead,
  store,
  onClose,
  onCreated,
}: {
  lead: LeadLike;
  store: string;
  onClose: () => void;
  onCreated: (orderName: string) => void;
}) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [vendedoraId, setVendedoraId] = useState<number | null>(null);
  const [products, setProducts] = useState<ShopifyProductOption[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");

  const [product, setProduct] = useState<ShopifyProductOption | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
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

  // Cargar asesoras + recordar la seleccionada.
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
        // silencio: se puede seguir sin lista (se mostrara vacio)
      }
    })();
  }, []);

  // Cargar productos de la tienda.
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

  // Al elegir producto, precargar su precio (editable).
  useEffect(() => {
    if (product) setPrice(String(product.price ?? ""));
  }, [product]);

  const selectVendedora = (id: number) => {
    setVendedoraId(id);
    try {
      window.localStorage.setItem(VENDEDORA_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  const lineTotal = useMemo(() => {
    const unit = Number(price) || 0;
    const gross = unit * (Number(quantity) || 0);
    const d = Number(discountValue) || 0;
    if (d <= 0) return gross;
    return discountType === "percentage" ? gross * (1 - d / 100) : Math.max(0, gross - d);
  }, [price, quantity, discountValue, discountType]);

  const canSubmit =
    vendedoraId != null && product != null && Number(quantity) > 0 && Number(price) > 0 && !submitting;

  async function submit() {
    if (!canSubmit || !product) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          vendedora_id: vendedoraId,
          items: [
            {
              variant_id: product.variant_id,
              sku: product.sku,
              title: product.display_name,
              price: Number(price),
              quantity: Number(quantity),
            },
          ],
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-4">
          <ShoppingCart className="h-5 w-5" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Crear pedido</p>
            <p className="truncate text-xs text-muted-foreground">{lead.name || "Cliente"} · {lead.phone}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
          )}

          {/* Asesora */}
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

          {/* Producto */}
          <div>
            <ProductPicker
              label="Producto"
              value={product}
              onChange={setProduct}
              products={products}
              loading={productsLoading}
              error={productsError}
            />
          </div>

          {/* Cantidad / precio / descuento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Cantidad</label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Precio unitario (₡)</label>
              <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Descuento</label>
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
          <div className="space-y-3">
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
        </div>

        {/* Footer: total + confirmar */}
        <div className="border-t border-border p-4">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">₡{lineTotal.toLocaleString("es-CR")}</span>
          </div>
          {!confirming ? (
            <Button className="w-full" disabled={!canSubmit} onClick={() => setConfirming(true)}>
              Revisar y crear pedido
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-center text-xs text-muted-foreground">
                Se creará un pedido REAL en Shopify por ₡{lineTotal.toLocaleString("es-CR")}. ¿Confirmas?
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
    </div>
  );
}
