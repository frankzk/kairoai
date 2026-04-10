"use client";

import { useState, useRef, useEffect } from "react";
import { Search, Loader2, AlertCircle, ChevronDown, X } from "lucide-react";
import type { ShopifyProductOption } from "@/app/api/shopify/products/route";

interface ProductPickerProps {
  label: string;
  value: ShopifyProductOption | null;
  onChange: (product: ShopifyProductOption | null) => void;
  products: ShopifyProductOption[];
  loading: boolean;
  error: string;
  placeholder?: string;
}

export function ProductPicker({
  label,
  value,
  onChange,
  products,
  loading,
  error,
  placeholder = "Buscar producto...",
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search.trim()
    ? products.filter(
        (p) =>
          p.display_name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase())
      )
    : products;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(product: ShopifyProductOption) {
    onChange(product);
    setOpen(false);
    setSearch("");
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null);
  }

  return (
    <div className="space-y-1" ref={containerRef}>
      <label className="text-xs text-muted-foreground">{label}</label>

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setSearch(""); }}
        className={`w-full flex items-center justify-between h-10 px-3 rounded-md border text-sm transition-colors text-left
          ${open ? "border-ring ring-2 ring-ring/30" : "border-input"}
          bg-background hover:border-ring/50`}
      >
        <span className={value ? "text-foreground" : "text-muted-foreground"}>
          {value ? value.display_name : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <span
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* SKU badge below selector */}
      {value?.sku && (
        <p className="text-xs text-muted-foreground">
          SKU: <code className="bg-muted px-1 py-0.5 rounded">{value.sku}</code>
          {" · "}₡{value.price.toLocaleString("es-CR")}
        </p>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-w-sm rounded-md border border-border bg-card shadow-lg">
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Buscar por nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Options list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando productos...
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 px-3 py-4 text-red-400 text-xs">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-muted-foreground text-sm">
                {search ? "Sin resultados." : "No hay productos."}
              </div>
            ) : (
              filtered.slice(0, 100).map((p) => (
                <button
                  key={p.variant_id}
                  type="button"
                  onClick={() => handleSelect(p)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50 transition-colors
                    ${value?.variant_id === p.variant_id ? "bg-primary/10" : ""}`}
                >
                  <div>
                    <p className="text-sm text-foreground leading-tight">{p.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku ? `SKU: ${p.sku}` : "sin SKU"}
                    </p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground ml-3 shrink-0">
                    ₡{p.price.toLocaleString("es-CR")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
