"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, PhoneCall, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Diagnostico de la telefonia. Existe para responder "por que no timbra" sin
// entrar a Zadarma: cada fila es una de las condiciones que tienen que
// cumplirse para que una asesora pueda llamar desde su laptop.

interface Status {
  configured: boolean;
  error?: string;
  balance?: { balance: number; currency: string } | { error: string };
  timezone?:
    | { timezone: string; offset: string | null; env_offset: string | null; matches: boolean }
    | { error: string };
  widget?:
    | {
        isExists: boolean;
        domains: string[];
        shape: string;
        position: string;
        domain_authorized: boolean;
        expected_host: string;
      }
    | { error: string };
  webhook?:
    | {
        url: string;
        expected_url: string;
        url_matches: boolean;
        missing_notifications: string[];
      }
    | { error: string };
  extensions?:
    | {
        total: number;
        assigned: number | null;
        rows: Array<{ sip: string; assigned_to: string | null; online: boolean | null }>;
      }
    | { error: string };
}

function hasError<T extends object>(value: T | { error: string } | undefined): value is { error: string } {
  return Boolean(value && "error" in value);
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="break-words text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default function ZadarmaStatusCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/zadarma/status", { cache: "no-store" });
      setStatus(await res.json());
    } catch {
      setStatus({ configured: false, error: "No se pudo consultar el estado." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function configureWebhook() {
    setFixing(true);
    setMessage("");
    try {
      const res = await fetch("/api/zadarma/status", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo configurar");
      setMessage("Notificaciones apuntadas a Kairo.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "No se pudo configurar");
    } finally {
      setFixing(false);
    }
  }

  if (loading && !status) {
    return <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />;
  }
  if (!status) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4 text-primary" />
          Telefonía (Zadarma)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status.configured ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            {status.error}
          </p>
        ) : (
          <div className="space-y-2.5">
            {hasError(status.balance) ? (
              <Row ok={false} label="Saldo" detail={status.balance.error} />
            ) : (
              status.balance && (
                <Row
                  ok={status.balance.balance > 0}
                  label="Saldo"
                  detail={`${status.balance.balance} ${status.balance.currency}${
                    status.balance.balance > 0 ? "" : " — sin saldo las llamadas no salen"
                  }`}
                />
              )
            )}

            {hasError(status.widget) ? (
              <Row ok={false} label="Widget WebRTC" detail={status.widget.error} />
            ) : (
              status.widget && (
                <Row
                  ok={status.widget.domain_authorized}
                  label="Dominio autorizado"
                  detail={
                    status.widget.domain_authorized
                      ? `${status.widget.expected_host} · widget ${status.widget.shape}, ${status.widget.position}`
                      : `Falta autorizar ${status.widget.expected_host} en Zadarma → Integraciones y API → widget WebRTC`
                  }
                />
              )
            )}

            {hasError(status.webhook) ? (
              <Row ok={false} label="Notificaciones" detail={status.webhook.error} />
            ) : (
              status.webhook && (
                <Row
                  ok={status.webhook.url_matches && status.webhook.missing_notifications.length === 0}
                  label="Notificaciones de llamadas"
                  detail={
                    !status.webhook.url_matches
                      ? `Apuntan a "${status.webhook.url || "(vacío)"}" en vez de ${status.webhook.expected_url}`
                      : status.webhook.missing_notifications.length
                        ? `Faltan eventos: ${status.webhook.missing_notifications.join(", ")}`
                        : "Todos los eventos del ciclo de vida activos"
                  }
                />
              )
            )}

            {hasError(status.timezone) ? (
              <Row ok={false} label="Zona horaria" detail={status.timezone.error} />
            ) : (
              status.timezone && (
                <Row
                  ok={status.timezone.matches}
                  label="Zona horaria"
                  detail={
                    status.timezone.matches
                      ? `${status.timezone.timezone} — coincide con ZADARMA_TIMEZONE_OFFSET`
                      : `La centralita usa ${status.timezone.timezone}: pon ZADARMA_TIMEZONE_OFFSET=${
                          status.timezone.offset ?? "?"
                        } (ahora: ${status.timezone.env_offset ?? "sin valor"}). Sin esto las horas del historial quedan corridas.`
                  }
                />
              )
            )}

            {hasError(status.extensions) ? (
              <Row ok={false} label="Extensiones" detail={status.extensions.error} />
            ) : (
              status.extensions && (
                <div className="space-y-1.5">
                  <Row
                    ok={(status.extensions.assigned ?? 0) > 0}
                    label="Extensiones"
                    detail={`${status.extensions.assigned ?? 0} de ${status.extensions.total} asignadas (se asignan en Gestión → Gastos → Planilla → Personal)`}
                  />
                  {/* Una fila por extension: es lo que contesta "a ella no le
                      timbra". "Sin registrar" con el widget abierto significa
                      que el navegador no llego a registrarse, y ahi la
                      centralita responde `failed` sin explicar nada. */}
                  <ul className="ml-5 space-y-1">
                    {status.extensions.rows.map((row) => (
                      <li key={row.sip} className="flex items-center gap-2 text-[11px]">
                        <span className="font-mono text-muted-foreground">{row.sip}</span>
                        <span className="truncate">{row.assigned_to ?? "sin asignar"}</span>
                        <span
                          className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-medium ${
                            row.online === null
                              ? "bg-muted text-muted-foreground"
                              : row.online
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {row.online === null
                            ? "sin dato"
                            : row.online
                              ? "teléfono registrado"
                              : "sin registrar · no timbra"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}
          </div>
        )}

        {message && <p className="text-xs text-muted-foreground">{message}</p>}

        {status.configured && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={fixing}
              onClick={configureWebhook}
              title="Apunta las notificaciones de la centralita a este deploy y enciende los eventos"
            >
              {fixing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
              Configurar notificaciones
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
