"use client";

// La reserva del lead mientras su ficha está abierta (lib/lead-holds.ts).
//
// - Muestra "Lo tienes reservado hasta las HH:MM" mientras dura.
// - Al vencer consulta UNA vez: si nadie lo tomó, solo avisa que ya otra
//   asesora puede abrirlo (se sigue trabajando); si otra persona lo abrió,
//   avisa que sus cambios ya no se guardan (el servidor responde 409).
// - Al cerrar la ficha la suelta; en pagehide, con un beacon. Si la página
//   vuelve del historial (bfcache) la pide otra vez.
// Sin sondeo: un temporizador local por reserva.

import { useEffect, useRef, useState } from "react";
import type { LeadHold } from "./lead-holds";
import { checkLeadHold, releaseLeadHold, requestLeadHold } from "./lead-holds-client";

/** sin: se abrió sin reserva · mia: vigente · vencida: nadie la tomó · perdida: la tiene otra persona. */
export type DrawerHoldPhase = "sin" | "mia" | "vencida" | "perdida";

export function useLeadHoldInDrawer(
  leadId: number,
  store: string,
  initial: LeadHold | null,
  initialOffsetMs: number
): { hold: LeadHold | null; fase: DrawerHoldPhase; otra: LeadHold | null } {
  const [hold, setHold] = useState<LeadHold | null>(initial);
  const [offsetMs, setOffsetMs] = useState(initialOffsetMs);
  const [fase, setFase] = useState<DrawerHoldPhase>(initial ? "mia" : "sin");
  const [otra, setOtra] = useState<LeadHold | null>(null);
  const mounted = useRef(true);
  const pendingRelease = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadHold = initial !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Una consulta cuando vence la reserva (+1 s de margen de reloj).
  useEffect(() => {
    if (!hold || fase !== "mia") return;
    const wait = Math.max(0, Date.parse(hold.expires_at) - (Date.now() + offsetMs)) + 1_000;
    const t = setTimeout(() => {
      if (!mounted.current) return;
      setFase("vencida");
      void checkLeadHold(leadId, store).then((r) => {
        if (!mounted.current) return;
        if (r.status === "other") {
          setOtra(r.hold);
          setFase("perdida");
        }
      });
    }, Math.min(wait, 2_147_000_000));
    return () => clearTimeout(t);
  }, [hold, fase, offsetMs, leadId, store]);

  // Soltar al cerrar; beacon en pagehide; pedirla otra vez al volver del bfcache.
  useEffect(() => {
    if (!hadHold) return;
    // En desarrollo React monta, desmonta y vuelve a montar: la liberación se
    // difiere un tick para que ese ensayo no suelte la reserva recién tomada.
    if (pendingRelease.current) {
      clearTimeout(pendingRelease.current);
      pendingRelease.current = null;
    }
    const onPageHide = () => releaseLeadHold(leadId, store, true);
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      void requestLeadHold(leadId, store).then((r) => {
        if (!mounted.current) return;
        if (r.kind === "blocked") {
          setOtra(r.hold);
          setFase("perdida");
        } else if (r.hold) {
          setHold(r.hold);
          setOffsetMs(r.offsetMs);
          setOtra(null);
          setFase("mia");
        }
      });
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      pendingRelease.current = setTimeout(() => {
        pendingRelease.current = null;
        releaseLeadHold(leadId, store);
      }, 0);
    };
  }, [hadHold, leadId, store]);

  return { hold, fase, otra };
}
