import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import theme from "@/components/marketing/theme.module.css";
import { formatInt } from "@/lib/panel-resumen";
import { ordersChange, type TopProduct } from "@/lib/panel-productos-vista";
import type { TopProducts } from "@/lib/panel-productos";
import type { BlockFailure } from "@/lib/panel-atencion";
import { cn } from "@/lib/utils";
import { BlockNotice, Skeleton } from "./BlockNotice";

const CHANGE_TONE = { up: "text-emerald-400", down: "text-rose-400", flat: "text-muted-foreground" } as const;

function Change({ product }: { product: TopProduct }) {
  const change = ordersChange(product.orders, product.previousOrders);
  if (!change) return null;
  const Icon = change.direction === "up" ? ArrowUpRight : change.direction === "down" ? ArrowDownRight : Minus;
  return (
    <span className={cn("ml-auto inline-flex w-12 items-center justify-end gap-0.5 sm:ml-0 text-xs font-medium tabular-nums", CHANGE_TONE[change.direction])}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">{change.text}</span>
      <span className="sr-only">{change.spoken}</span>
    </span>
  );
}

/**
 * Productos mas pedidos del periodo: barra fina de un solo color con el % de
 * los pedidos que lo traen, la cifra de pedidos y unidades, y el cambio contra
 * el periodo anterior.
 */
export function TopProductsCard({
  top,
  failure,
  refreshing,
  periodPhrase,
  hasComparison,
}: {
  top: TopProducts | null;
  failure: BlockFailure | null;
  refreshing: boolean;
  periodPhrase: string;
  hasComparison: boolean;
}) {
  const max = top?.items.reduce((n, p) => Math.max(n, p.orders), 0) ?? 0;
  return (
    <section
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgb(16_16_32/0.04)] sm:p-5"
      aria-labelledby="panel-top-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="panel-top-title" className="text-sm font-semibold text-foreground">
          Productos más pedidos
        </h2>
        {top && top.distinct > top.items.length && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {top.items.length} de {formatInt(top.distinct)} productos
          </p>
        )}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Pedidos generados {periodPhrase} que traen cada producto{hasComparison ? ", y el cambio contra el periodo anterior" : ""}
      </p>

      {failure && (
        <BlockNotice
          className="mt-4"
          failure={failure}
          noAccess="Los productos salen de Gestión de pedidos."
          unavailable="No se pudieron cargar los productos. Prueba con Actualizar."
        />
      )}
      {!failure && !top && (
        <div className="mt-4 space-y-3.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {!failure && top && top.items.length === 0 && (
        <p className="mt-4 text-[13px] text-muted-foreground">Sin pedidos con productos en el periodo.</p>
      )}
      {!failure && top && top.items.length > 0 && (
        <ol
          className={cn(theme.theme, "mt-4 space-y-3 transition-opacity motion-reduce:transition-none", refreshing && "opacity-60")}
          aria-label="Productos más pedidos"
        >
          {top.items.map((product, i) => (
            <li key={product.key} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
                <span className="w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <span
                  className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] truncate text-foreground sm:basis-0"
                  title={product.name}
                >
                  {product.name}
                </span>
                <span className="ml-7 shrink-0 tabular-nums sm:ml-0">
                  <span className="font-semibold text-foreground">{formatInt(product.orders)}</span>
                  <span className="ml-1 text-muted-foreground">{product.orders === 1 ? "pedido" : "pedidos"}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {formatInt(product.units)} u.
                  </span>
                </span>
                {hasComparison && <Change product={product} />}
              </div>
              <div className="ml-7 mt-1.5 h-1.5 rounded-full" style={{ background: "var(--mk-track)" }} aria-hidden="true">
                {max > 0 && (
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${Math.max(2, (product.orders / max) * 100)}%`, background: "var(--mk-series-1)" }}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
