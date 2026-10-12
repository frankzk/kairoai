"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PERMISO_INFO } from "@/lib/permisos";
import { FINANCE_STORES } from "@/lib/store-config";
import { leerYo, type Yo } from "@/lib/sesion-cliente";

// Mi cuenta: quien soy, que puedo hacer, y cambiar mi contraseña. La primera
// vez que alguien entra con la contraseña que le puso su supervisora, el
// sistema lo trae aca y no lo deja seguir hasta cambiarla.
export default function CuentaPage() {
  const [yo, setYo] = useState<Yo | null>(null);
  const [debeCambiar, setDebeCambiar] = useState(false);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const y = leerYo();
    setYo(y);
    setDebeCambiar(Boolean(y?.debeCambiar));
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (nueva !== repetir) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual, nueva }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; inicio?: string };
      if (!res.ok) {
        setError(j.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      setOk(true);
      setActual("");
      setNueva("");
      setRepetir("");
      if (debeCambiar) window.location.assign(j.inicio ?? "/");
    } finally {
      setEnviando(false);
    }
  }

  const tiendas = FINANCE_STORES.filter((s) => yo?.tiendas.includes(s.code)).map((s) => s.label);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-semibold">Mi cuenta</h1>
      {yo && (
        <p className="mt-1 text-sm text-muted-foreground">
          {yo.nombre}
          {tiendas.length ? ` · ${tiendas.join(" y ")}` : ""}
        </p>
      )}

      {debeCambiar && (
        <p className="mt-4 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Antes de empezar, cambia la contraseña que te dieron por una que solo sepas tú.
        </p>
      )}

      <Card className="mt-4">
        <CardContent className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Cambiar contraseña
          </h2>
          {yo?.id === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este es el acceso de administrador general. Su contraseña se cambia en Vercel (variable ADMIN_PASSWORD).
            </p>
          ) : (
            <form onSubmit={enviar} className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Contraseña actual</span>
                <Input type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Contraseña nueva (mínimo 8 caracteres)</span>
                <Input type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} required minLength={8} />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Repite la contraseña nueva</span>
                <Input type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required minLength={8} />
              </label>
              {error && <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}
              {ok && !debeCambiar && <p className="text-sm text-emerald-400">Listo: tu contraseña quedó cambiada.</p>}
              <Button type="submit" disabled={enviando}>
                {enviando ? "Guardando..." : "Cambiar contraseña"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {yo && (
        <Card className="mt-4">
          <CardContent className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Tus accesos</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {yo.permisos.map((p) => (
                <li key={p}>
                  <span className="text-foreground">{PERMISO_INFO[p]?.label ?? p}</span> — {PERMISO_INFO[p]?.detalle}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Si necesitas otro acceso, pídeselo a tu supervisora.</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
