"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, KeyRound, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rutaInternaSegura } from "@/lib/permisos";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Solo rutas internas: un ?next= a otro sitio no se sigue.
  const nextPath = useMemo(() => {
    const n = searchParams.get("next");
    return rutaInternaSegura(n) ? n : null;
  }, [searchParams]);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo iniciar sesion.");
      return;
    }

    const body = (await res.json().catch(() => ({}))) as { inicio?: string };
    // Contraseña inicial: primero a cambiarla. Si no, a donde iba o a su inicio.
    const destino = body.inicio === "/cuenta" ? "/cuenta" : nextPath ?? body.inicio ?? "/";
    router.replace(destino);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#6d4aff] to-[#db2777] text-sm font-bold text-white"
            aria-hidden="true"
          >
            K
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Kairo</span>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-md sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">Entra a tu cuenta</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Cada persona entra con su usuario y ve solo las secciones y tiendas que le corresponden.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="usuario" className="text-[13px] font-medium">
                Usuario o correo
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="usuario"
                  type="text"
                  value={usuario}
                  onChange={(event) => setUsuario(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-9 pl-8"
                  placeholder="tu usuario o tu correo"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[13px] font-medium">
                Contraseña
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-9 pl-8"
                  placeholder="tu contraseña"
                  required
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-[13px] text-red-300">
                <CircleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <Button type="submit" className="h-9 w-full" disabled={loading}>
              {loading ? "Validando…" : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
