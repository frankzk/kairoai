"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Save, RotateCcw, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentSettings } from "@/lib/db";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AgentSettings>({ max_retries: 3, retry_delay_minutes: 30 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/agent-settings")
      .then((r) => r.json())
      .then((d) => { setSettings(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/agent-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Error al guardar");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" /> Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">Configuración del Agente</h1>
            <p className="text-xs text-muted-foreground">Reintentos de llamada y comportamiento</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-lg space-y-6">
        {loading ? (
          <div className="h-48 rounded-lg border border-border bg-card animate-pulse" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-primary" />
                Reintentos de llamada
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* max_retries */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Intentos máximos (incluyendo la primera llamada)
                  </label>
                  <span className="text-2xl font-bold text-primary w-8 text-center">
                    {settings.max_retries}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={settings.max_retries}
                  onChange={(e) => setSettings({ ...settings, max_retries: Number(e.target.value) })}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>2</span>
                  <span>3 (recomendado)</span>
                  <span>4</span>
                  <span>5</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {settings.max_retries === 1
                    ? "Solo la llamada inicial, sin reintentos."
                    : `Primera llamada + ${settings.max_retries - 1} reintento${settings.max_retries - 1 > 1 ? "s" : ""}.`}
                </p>
              </div>

              {/* retry_delay_minutes */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Tiempo entre intentos (minutos)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={settings.retry_delay_minutes}
                    onChange={(e) =>
                      setSettings({ ...settings, retry_delay_minutes: Math.max(1, Number(e.target.value)) })
                    }
                    className="w-28 h-10 px-3 rounded-md border border-input bg-background text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  <span className="text-sm text-muted-foreground">minutos</span>
                  <span className="text-xs text-muted-foreground">
                    ({Math.floor(settings.retry_delay_minutes / 60) > 0
                      ? `${Math.floor(settings.retry_delay_minutes / 60)}h `
                      : ""}
                    {settings.retry_delay_minutes % 60 > 0
                      ? `${settings.retry_delay_minutes % 60}min`
                      : ""})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  El agente esperará este tiempo antes de volver a llamar cuando no hay respuesta.
                </p>
              </div>

              {/* Info box */}
              <div className="rounded-md bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">¿Cómo funciona?</p>
                <p>
                  Cuando Valeria no logra comunicarse (no contesta, buzón de voz), agenda un reintento.
                  El cron se ejecuta cada minuto y dispara la llamada cuando llega la hora.
                  Cada intento aparece en "Llamadas Recientes" con una nota de reintento.
                </p>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Save className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? "Guardando..." : saved ? "¡Guardado!" : "Guardar configuración"}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
