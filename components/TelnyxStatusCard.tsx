"use client";

import { useEffect, useState } from "react";
import { Check, PhoneCall, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Que le falta a Telnyx para que las asesoras llamen, sin entrar a Telnyx.
// Solo nombres de variables y numeros publicos (/api/telnyx/status).

interface Status {
  proveedor: "zadarma" | "telnyx";
  configurado: boolean;
  faltan: string[];
  grabar: boolean;
  tiendas: Array<{ tienda: string; variable: string; numero: string | null }>;
}

function Fila({ ok, titulo, detalle }: { ok: boolean; titulo: string; detalle: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="font-medium">{titulo}</p>
        <p className="break-words text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );
}

export default function TelnyxStatusCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/telnyx/status", { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
        setStatus(data as Status);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo leer el estado"));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4" /> Telefonía Telnyx
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!status && !error && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {status && (
          <>
            <Fila
              ok={status.proveedor === "telnyx"}
              titulo={status.proveedor === "telnyx" ? "En uso: las asesoras llaman con Telnyx" : "Apagado: las asesoras llaman con Zadarma"}
              detalle="Se cambia con TELEFONIA=telnyx (o zadarma) en Vercel y un redeploy."
            />
            <Fila
              ok={status.configurado}
              titulo={status.configurado ? "Credenciales completas" : "Faltan credenciales"}
              detalle={status.configurado ? "API key, Credential Connection y llave pública del webhook." : `Falta en Vercel: ${status.faltan.join(", ")}`}
            />
            {status.tiendas.map((t) => (
              <Fila
                key={t.variable}
                ok={Boolean(t.numero)}
                titulo={`${t.tienda}: ${t.numero ?? "sin número"}`}
                detalle={t.numero ? "Es el número que ve el cliente." : `Falta ${t.variable} en Vercel: un número de ese país en Telnyx.`}
              />
            ))}
            <Fila
              ok
              titulo={status.grabar ? "Las llamadas se graban" : "Las llamadas no se graban"}
              detalle="TELNYX_GRABAR=1 para grabar (hay que avisarle al cliente)."
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
