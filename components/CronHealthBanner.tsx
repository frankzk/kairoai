"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";

interface Problema {
  name: string;
  label: string;
  reason: string | null;
}

const CADA_MS = 5 * 60_000;

/**
 * Aviso arriba de TODAS las pantallas cuando un proceso automatico se atrasa.
 *
 * No existe cuando todo anda: ni un pixel, ni un "todo ok" que se aprende a
 * ignorar. Aparece solo si algun proceso lleva mas del doble de su intervalo
 * sin terminar bien, y dice cual y por que con palabras de la pantalla
 * ("Leads de WhatsApp"), no con la ruta del cron.
 *
 * Lo ven todos, asesoras incluidas, a proposito: si los leads no se
 * actualizan, quien esta llamando necesita saber que la lista que tiene
 * enfrente es vieja.
 *
 * Si la consulta falla no muestra nada. Un aviso que se equivoca es peor que
 * ninguno: enseña a no mirarlo.
 */
export default function CronHealthBanner() {
  const pathname = usePathname();
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const enLogin = pathname === "/login";

  useEffect(() => {
    if (enLogin) return;
    let vivo = true;
    const cargar = async () => {
      try {
        const res = await fetch("/api/health/crons", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { problemas?: Problema[] };
        if (vivo) setProblemas(Array.isArray(data.problemas) ? data.problemas : []);
      } catch {
        // Sin red o sin base: no se afirma nada.
      }
    };
    void cargar();
    const t = setInterval(cargar, CADA_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [enLogin]);

  if (enLogin || problemas.length === 0) return null;

  return (
    // Rojo de fallo con velo (La Regla del Velo): fondo con alfa sobre el
    // oscuro, nunca el rojo solido.
    <div role="status" aria-live="polite" className="border-b border-red-500/40 bg-red-500/10">
      <div className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-xs text-red-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0">
          <span className="font-semibold">
            {problemas.length === 1 ? "Un proceso atrasado" : `${problemas.length} procesos atrasados`}
          </span>
          <span className="text-red-300/90"> — lo que muestran estas pantallas puede estar viejo: </span>
          {problemas.map((p, i) => (
            <span key={p.name}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <span className="font-medium text-foreground">{p.label}</span>
              {p.reason && <span> ({p.reason})</span>}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
