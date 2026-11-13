import { CircleAlert, Lock } from "lucide-react";
import type { BlockFailure } from "@/lib/panel-atencion";
import { cn } from "@/lib/utils";

/** Aviso tranquilo de un bloque que no se puede mostrar. Nunca rompe la pagina. */
export function BlockNotice({
  failure,
  noAccess,
  unavailable,
  className,
  compact = false,
}: {
  failure: BlockFailure;
  /** Texto para "Sin acceso" (que permiso falta). */
  noAccess: string;
  /** Texto para "No disponible". */
  unavailable: string;
  className?: string;
  compact?: boolean;
}) {
  const Icon = failure === "sin_acceso" ? Lock : CircleAlert;
  return (
    <div className={cn("flex items-start gap-2 text-[13px] text-muted-foreground", className)} role="status">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-medium text-foreground">{failure === "sin_acceso" ? "Sin acceso" : "No disponible"}</span>
        {!compact && <span>. {failure === "sin_acceso" ? noAccess : unavailable}</span>}
      </p>
    </div>
  );
}

/** Bloque gris de carga inicial (solo la primera vez; al recargar se atenua). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} aria-hidden="true" />;
}
