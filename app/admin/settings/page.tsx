"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Save, RotateCcw, RefreshCw, Phone, ToggleLeft, ToggleRight, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentSettings } from "@/lib/db";

const DEFAULTS: AgentSettings = {
  max_retries: 3,
  retry_delay_minutes: 30,
  retry_delays: [30, 120, 240],
  cart_agent_enabled: false,
  cart_agent_name: "",
  cart_agent_phone: "",
  cart_agent_retell_id: "",
  cart_agent_retry_delays: [60, 240],
};

function fmtMin(m: number) {
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/agent-settings")
      .then((r) => r.json())
      .then((d) => { setSettings({ ...DEFAULTS, ...d }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Ensure retry_delays array length matches max_retries - 1
  function setMaxRetries(v: number) {
    const retries = v - 1; // number of retries (first call is attempt 1)
    const cur = settings.retry_delays ?? [];
    const next = Array.from({ length: retries }, (_, i) => cur[i] ?? 30);
    setSettings({ ...settings, max_retries: v, retry_delays: next });
  }

  function setRetryDelay(index: number, value: number) {
    const next = [...(settings.retry_delays ?? [])];
    next[index] = Math.max(1, value);
    setSettings({ ...settings, retry_delays: next });
  }

  function setCartRetryDelay(index: number, value: number) {
    const next = [...(settings.cart_agent_retry_delays ?? [])];
    next[index] = Math.max(1, value);
    setSettings({ ...settings, cart_agent_retry_delays: next });
  }

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
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Error al guardar");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  const retryCount = settings.max_retries - 1;

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
            <h1 className="text-lg font-bold">Configuración</h1>
            <p className="text-xs text-muted-foreground">Agentes y comportamiento de reintentos</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-lg space-y-6">
        {loading ? (
          <div className="h-64 rounded-lg border border-border bg-card animate-pulse" />
        ) : (
          <>
            {/* ── Agente confirmación de pedidos ─────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-primary" />
                  Agente de confirmación (Milagros)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* max_retries */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Intentos máximos</label>
                    <span className="text-2xl font-bold text-primary w-8 text-center">{settings.max_retries}</span>
                  </div>
                  <input
                    type="range" min={1} max={5} step={1}
                    value={settings.max_retries}
                    onChange={(e) => setMaxRetries(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    {[1,2,3,4,5].map(n => <span key={n}>{n}{n===3?" (rec)":""}</span>)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {retryCount === 0 ? "Solo la llamada inicial, sin reintentos." : `Primera llamada + ${retryCount} reintento${retryCount > 1 ? "s" : ""}.`}
                  </p>
                </div>

                {/* Per-attempt delays */}
                {retryCount > 0 && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Espera antes de cada reintento</label>
                    <div className="space-y-2">
                      {Array.from({ length: retryCount }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-24 shrink-0">
                            Reintento {i + 1}
                          </span>
                          <input
                            type="number" min={1} max={1440}
                            value={settings.retry_delays?.[i] ?? 30}
                            onChange={(e) => setRetryDelay(i, Number(e.target.value))}
                            className="w-24 h-9 px-3 rounded-md border border-input bg-background text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring/30"
                          />
                          <span className="text-xs text-muted-foreground">min</span>
                          <span className="text-xs text-primary font-medium">
                            ({fmtMin(settings.retry_delays?.[i] ?? 30)})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Agente de carritos abandonados ─────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  Agente de carritos abandonados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Activar agente</p>
                    <p className="text-xs text-muted-foreground">Llama a clientes con carritos pendientes</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, cart_agent_enabled: !settings.cart_agent_enabled })}
                  >
                    {settings.cart_agent_enabled
                      ? <ToggleRight className="h-6 w-6 text-emerald-400" />
                      : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Nombre del agente</label>
                  <Input
                    placeholder="ej: Valentina"
                    value={settings.cart_agent_name}
                    onChange={(e) => setSettings({ ...settings, cart_agent_name: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Número de teléfono (Retell)</label>
                  <Input
                    placeholder="+50688887777"
                    value={settings.cart_agent_phone}
                    onChange={(e) => setSettings({ ...settings, cart_agent_phone: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Retell Agent ID</label>
                  <Input
                    placeholder="agent_xxxxxxxxxxxxxxxx"
                    value={settings.cart_agent_retell_id}
                    onChange={(e) => setSettings({ ...settings, cart_agent_retell_id: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Espera antes de cada reintento</label>
                  <div className="space-y-2">
                    {(settings.cart_agent_retry_delays ?? [60, 240]).map((delay, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-24 shrink-0">Reintento {i + 1}</span>
                        <input
                          type="number" min={1} max={1440}
                          value={delay}
                          onChange={(e) => setCartRetryDelay(i, Number(e.target.value))}
                          className="w-24 h-9 px-3 rounded-md border border-input bg-background text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-ring/30"
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                        <span className="text-xs text-primary font-medium">({fmtMin(delay)})</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md bg-muted/50 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">¿Cómo funciona?</p>
                  <p>Si el cliente confirma la compra por teléfono, el agente crea el pedido directamente en Shopify como COD. Si rechaza, agenda un reintento con el tiempo configurado arriba.</p>
                </div>
              </CardContent>
            </Card>

            {error && <p className="text-xs text-red-400 px-1">{error}</p>}

            <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Guardando..." : saved ? "¡Guardado!" : "Guardar configuración"}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
