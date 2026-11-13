import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, Lock, type LucideIcon } from "lucide-react";
import { formatInt } from "@/lib/panel-resumen";
import { cn } from "@/lib/utils";
import { Skeleton } from "./BlockNotice";
import type { BlockState } from "./useEndpoint";

export interface AttentionItem {
  id: string;
  title: string;
  href: string;
  /** Texto del enlace para lectores de pantalla ("Abrir Novedades"). */
  linkLabel: string;
  icon: LucideIcon;
  state: BlockState<{ count: number; detail: string }>;
  /** Que dice el bloque cuando no hay nada pendiente. */
  empty: string;
}

function Value({ state, empty }: { state: AttentionItem["state"]; empty: string }): ReactNode {
  if (state.status === "loading") {
    return (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-6 w-14" />
        <Skeleton className="h-3 w-40" />
      </div>
    );
  }
  if (state.status === "sin_acceso" || state.status === "no_disponible") {
    const Icon = state.status === "sin_acceso" ? Lock : CircleAlert;
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {state.status === "sin_acceso" ? "Sin acceso" : "No disponible"}
      </p>
    );
  }
  const { count, detail } = state.data;
  return (
    <div className={cn("transition-opacity motion-reduce:transition-none", state.refreshing && "opacity-60")}>
      <p className="text-xl font-semibold tracking-tight text-foreground">{formatInt(count)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{count > 0 ? detail || " " : empty}</p>
    </div>
  );
}

/**
 * "Para atender ahora": conteos del estado actual que llevan a la pantalla
 * donde se trabajan. Cada celda carga y falla sola. Sin acceso, la celda no
 * es enlace (la pantalla tampoco se abriria).
 */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  return (
    <section aria-labelledby="panel-attention-title">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="panel-attention-title" className="text-sm font-semibold text-foreground">
          Para atender ahora
        </h2>
        <p className="text-xs text-muted-foreground">Estado actual, sin importar el periodo</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(16_16_32/0.04)]">
        <ul className="-mb-px -mr-px grid sm:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{item.title}</span>
                  </span>
                  {item.state.status !== "sin_acceso" && (
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="mt-2">
                  <Value state={item.state} empty={item.empty} />
                </div>
              </>
            );
            return (
              <li key={item.id} className="min-w-0 border-b border-r border-border">
                {item.state.status === "sin_acceso" ? (
                  <div className="h-full px-4 py-3.5">{body}</div>
                ) : (
                  <Link
                    href={item.href}
                    className="group block h-full px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="sr-only">{item.linkLabel}: </span>
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
