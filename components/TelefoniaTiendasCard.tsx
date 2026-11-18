"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NOMBRE_PROVEEDOR, PROVEEDORES, type ConfigTelefonia, type ProveedorTelefonia } from "@/lib/telefonia";

interface Tienda extends ConfigTelefonia {
  code: string;
  label: string;
  guardada: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

const NOTA: Record<ProveedorTelefonia, string> = {
  zadarma: "cobra por segundo",
  telnyx: "cobra por minuto",
};

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CR", { timeZone: "America/Costa_Rica", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

// Con qué proveedor llaman las asesoras de cada tienda y cuál se usa si ese no
// conecta (lib/telefonia.ts). Se guarda al cambiarlo. Las asesoras lo toman
// al recargar la página.
export default function TelefoniaTiendasCard() {
  const [tiendas, setTiendas] = useState<Tienda[] | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/telefonia", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { tiendas?: Tienda[]; error?: string };
        if (!r.ok) throw new Error(d.error || "No se pudo leer la telefonía.");
        setTiendas(d.tiendas ?? []);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudo leer la telefonía.");
        setTiendas([]);
      });
  }, []);

  async function guardar(tienda: Tienda, cambio: Partial<ConfigTelefonia>) {
    const principal = cambio.principal ?? tienda.principal;
    // Si el principal pasa a ser el que era respaldo, el respaldo pasa al otro.
    let respaldo = "respaldo" in cambio ? (cambio.respaldo ?? null) : tienda.respaldo;
    if (respaldo === principal) respaldo = PROVEEDORES.find((p) => p !== principal) ?? null;
    setGuardando(tienda.code);
    setError("");
    try {
      const res = await fetch("/api/telefonia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: tienda.code, principal, respaldo }),
      });
      const d = (await res.json().catch(() => ({}))) as Partial<Tienda> & { error?: string };
      if (!res.ok) throw new Error(d.error || "No se pudo guardar.");
      setTiendas((prev) => (prev ?? []).map((t) => (t.code === tienda.code ? { ...t, ...d, code: t.code, label: t.label } as Tienda : t)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4 text-primary" aria-hidden="true" />
          Telefonía por tienda
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Con qué proveedor llaman las asesoras y cuál se usa si ese no conecta. Se guarda al cambiarlo; las asesoras lo toman al recargar la
          página.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {tiendas === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Cargando…
          </p>
        ) : (
          tiendas.map((t) => {
            const otro = PROVEEDORES.find((p) => p !== t.principal)!;
            const ocupado = guardando === t.code;
            return (
              <div key={t.code} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{t.label}</p>
                  {ocupado && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Guardando" />}
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs text-muted-foreground">
                    Proveedor principal
                    <select
                      className={`${SELECT} mt-1`}
                      value={t.principal}
                      disabled={ocupado}
                      onChange={(e) => void guardar(t, { principal: e.target.value as ProveedorTelefonia })}
                    >
                      {PROVEEDORES.map((p) => (
                        <option key={p} value={p}>
                          {NOMBRE_PROVEEDOR[p]} ({NOTA[p]})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Si no conecta, usar
                    <select
                      className={`${SELECT} mt-1`}
                      value={t.respaldo ?? ""}
                      disabled={ocupado}
                      onChange={(e) => void guardar(t, { respaldo: (e.target.value || null) as ProveedorTelefonia | null })}
                    >
                      <option value="">Ninguno (sin respaldo)</option>
                      <option value={otro}>{NOMBRE_PROVEEDOR[otro]}</option>
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t.guardada
                    ? `Cambiado${t.updated_by ? ` por ${t.updated_by.replace(/^\d+:/, "")}` : ""}${t.updated_at ? ` el ${fmtFecha(t.updated_at)}` : ""}`
                    : "Sin ajuste guardado: usa lo configurado en Vercel (TELEFONIA)."}
                </p>
              </div>
            );
          })
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
