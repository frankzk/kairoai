"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ToggleLeft, ToggleRight, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StoreAssignment {
  code: string;
  label: string;
  available: boolean;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string | null;
  last_run_at: string | null;
  asesoras: Array<{ id: number; nombre: string; recibe: boolean }>;
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CR", {
      timeZone: "America/Costa_Rica",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Interruptor del reparto automático de leads, uno por tienda. Se guarda al
// tocarlo (no espera al botón "Guardar configuración" de la página, que es del
// agente de voz).
export default function LeadAssignmentSettingsCard() {
  const [stores, setStores] = useState<StoreAssignment[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/leads/assignment-settings", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error || "No se pudo leer el reparto de leads.");
        setStores((d as { stores?: StoreAssignment[] }).stores ?? []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo leer el reparto de leads.");
        setStores([]);
      });
  }, []);

  async function toggle(store: StoreAssignment, persona?: { id: number; recibe: boolean }) {
    setSaving(persona ? `${store.code}:${persona.id}` : store.code);
    setError("");
    try {
      const res = await fetch("/api/leads/assignment-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          persona
            ? { store: store.code, user_id: persona.id, recibe: persona.recibe }
            : { store: store.code, enabled: !store.enabled }
        ),
      });
      const d = (await res.json().catch(() => ({}))) as Partial<StoreAssignment> & { error?: string };
      if (!res.ok) throw new Error(d.error || "No se pudo guardar el reparto de leads.");
      setStores((prev) => (prev ?? []).map((s) => (s.code === store.code ? { ...s, ...d } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el reparto de leads.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Reparto automático de leads
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stores === null ? (
          <div className="h-12 rounded-md bg-muted/50 animate-pulse" />
        ) : (
          stores.map((store) => (
            <div key={store.code} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{store.label}</p>
                <p className="text-xs text-muted-foreground">
                  Repartir leads automáticamente entre las asesoras activas
                </p>
                {!store.available ? (
                  <p className="mt-1 text-xs text-amber-400">Pendiente: aplicar la migración del reparto de leads.</p>
                ) : (
                  <>
                    {store.asesoras.length ? (
                      <fieldset className="mt-2">
                        <legend className="text-xs text-muted-foreground">Reciben leads:</legend>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                          {store.asesoras.map((a) => (
                            <label key={a.id} className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={a.recibe}
                                disabled={!store.available || saving !== null}
                                onChange={() => toggle(store, { id: a.id, recibe: !a.recibe })}
                                className="h-3.5 w-3.5 accent-primary"
                              />
                              <span className={a.recibe ? "" : "text-muted-foreground line-through"}>{a.nombre}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">Nadie con acceso a Leads en esta tienda.</p>
                    )}
                    {store.updated_by && store.updated_at && (
                      <p className="text-[11px] text-muted-foreground">
                        {store.enabled ? "Encendido" : "Apagado"} por {store.updated_by} el {fmtFecha(store.updated_at)}
                        {store.enabled && store.last_run_at ? ` · último reparto ${fmtFecha(store.last_run_at)}` : ""}
                      </p>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={store.enabled}
                aria-label={`Reparto automático de leads en ${store.label}`}
                disabled={!store.available || saving !== null}
                onClick={() => toggle(store)}
                className="shrink-0 disabled:opacity-50"
              >
                {saving === store.code ? (
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : store.enabled ? (
                  <ToggleRight className="h-6 w-6 text-emerald-400" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                )}
              </button>
            </div>
          ))
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="rounded-md bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">¿Cómo funciona?</p>
          <p>
            Cada 5 minutos los leads abiertos (Hoy y Seguimiento) se reparten en partes iguales entre las asesoras que
            Productividad muestra como Activa, en el orden de la cola: cada una recibe la misma mezcla de carritos,
            enganchados y demás. Cada asesora ve en «Mis leads» los suyos y los que todavía no tienen dueña. Quien
            administra configuración o usuarios no recibe leads; a cualquier otra persona se la puede sacar
            desmarcándola.
          </p>
          <p>
            Si se conecta otra asesora, se le pasan leads que nadie ha trabajado. Si una asesora lleva más de 2 horas
            desconectada, sus leads sin trabajar vuelven al reparto; los que ya trabajó siguen siendo suyos.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
