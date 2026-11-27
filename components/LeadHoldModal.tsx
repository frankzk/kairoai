"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { blockedNoticeParts, holderFirstName, type LeadHold } from "@/lib/lead-holds";

/**
 * Aviso de "lead ocupado": otra persona tiene abierta la ficha.
 *
 * El texto lo arma lib/lead-holds.ts (probado). La cuenta atrás es local (se
 * vuelve a pintar cada 15 s, sin pedir nada); cuando llega a cero se llama UNA
 * vez a `onExpire` y el tablero consulta si ya se liberó. Si sí, el aviso
 * cambia a "Ya puedes abrirlo"; si otra persona lo volvió a abrir, muestra la
 * reserva nueva y espera a que venza esa.
 */
export interface LeadHoldNoticeProps {
  hold: LeadHold;
  timeZone: string;
  /** Hora "del servidor" para la cuenta atrás (Date.now() + desfase). */
  now: number;
  /** Ya se liberó (la consulta al vencer dijo que está libre). */
  freed: boolean;
  canTakeOver: boolean;
  busy?: boolean;
  onClose: () => void;
  onOpen: () => void;
  onTakeOver: () => void;
  titleId?: string;
  descId?: string;
  primaryRef?: React.Ref<HTMLButtonElement>;
}

/** El contenido del aviso, sin temporizadores (se renderiza en los tests). */
export function LeadHoldNotice({
  hold,
  timeZone,
  now,
  freed,
  canTakeOver,
  busy = false,
  onClose,
  onOpen,
  onTakeOver,
  titleId,
  descId,
  primaryRef,
}: LeadHoldNoticeProps) {
  const p = blockedNoticeParts(hold, now, timeZone);
  return (
    <div className="w-full max-w-md rounded-[10px] border border-border bg-card p-5 shadow-[0_12px_32px_-8px_rgb(20_20_31/0.18),0_2px_6px_rgb(20_20_31/0.06)]">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            freed ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"
          }`}
          aria-hidden="true"
        >
          {freed ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[15px] font-semibold leading-snug text-foreground">
            {freed ? "Este lead ya está libre" : "Lead ocupado"}
          </h2>
          {freed ? (
            <p id={descId} className="mt-1.5 text-[13.5px] leading-[1.45] text-muted-foreground">
              La reserva de <strong className="font-semibold text-foreground">{p.holder}</strong> terminó a las{" "}
              <span className="tabular-nums">{p.until}</span>. Ya puedes abrirlo.
            </p>
          ) : (
            <p id={descId} className="mt-1.5 text-[13.5px] leading-[1.45] text-muted-foreground">
              Este lead lo tiene abierto <strong className="font-semibold text-foreground">{p.holder}</strong> desde las{" "}
              <span className="tabular-nums">{p.since}</span>. Se libera a las{" "}
              <span className="tabular-nums">{p.until}</span>
              {p.inText ? <span className="whitespace-nowrap tabular-nums"> {p.inText}</span> : null}.
            </p>
          )}
          {!freed && canTakeOver && (
            <p className="mt-2 text-xs leading-[1.45] text-muted-foreground">
              Supervisión: si lo abres de todos modos, {holderFirstName(p.holder)} ya no podrá guardar cambios en este lead.
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {!freed && canTakeOver && (
          <Button variant="outline" onClick={onTakeOver} disabled={busy}>
            Abrir de todos modos
          </Button>
        )}
        {freed ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Entendido
            </Button>
            <Button ref={primaryRef} onClick={onOpen} disabled={busy}>
              {busy ? "Abriendo…" : "Abrir lead"}
            </Button>
          </>
        ) : (
          <Button ref={primaryRef} onClick={onClose} disabled={busy}>
            Entendido
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LeadHoldModal({
  hold,
  timeZone,
  offsetMs,
  freed,
  canTakeOver,
  busy = false,
  onClose,
  onOpen,
  onTakeOver,
  onExpire,
}: Omit<LeadHoldNoticeProps, "now" | "titleId" | "descId" | "primaryRef"> & {
  offsetMs: number;
  /** La reserva llegó a su fin con el aviso abierto: consultar una vez. */
  onExpire: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Cuenta atrás local: repinta cada 15 s; no consulta al servidor.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offsetMs), 15_000);
    setNow(Date.now() + offsetMs);
    return () => clearInterval(t);
  }, [offsetMs, hold.expires_at]);

  // Una sola consulta cuando vence ESTA reserva (+1 s de margen de reloj).
  useEffect(() => {
    if (freed) return;
    const wait = Math.max(0, Date.parse(hold.expires_at) - (Date.now() + offsetMs)) + 1_000;
    const t = setTimeout(() => {
      setNow(Date.now() + offsetMs);
      onExpireRef.current();
    }, Math.min(wait, 2_147_000_000));
    return () => clearTimeout(t);
  }, [hold.expires_at, offsetMs, freed]);

  // Diálogo de verdad: foco adentro, Esc cierra, Tab no se escapa, y al
  // cerrar el foco vuelve a la tarjeta desde la que se intentó abrir.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [freed]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const box = boxRef.current;
      if (!box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!box.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(15_15_30/0.36)] p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <LeadHoldNotice
          hold={hold}
          timeZone={timeZone}
          now={now}
          freed={freed}
          canTakeOver={canTakeOver}
          busy={busy}
          onClose={onClose}
          onOpen={onOpen}
          onTakeOver={onTakeOver}
          titleId={titleId}
          descId={descId}
          primaryRef={primaryRef}
        />
      </div>
    </div>
  );
}
