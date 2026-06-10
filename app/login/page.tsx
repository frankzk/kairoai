"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, Lock, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") || "/", [searchParams]);
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
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "No se pudo iniciar sesion.");
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.18),transparent_28%),linear-gradient(135deg,hsl(var(--background)),hsl(220_45%_7%))]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      <section className="relative mx-auto grid min-h-screen w-full max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-3 border border-border bg-card/80 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="flex h-7 w-7 items-center justify-center bg-primary/15 text-primary">
              <Zap className="h-3.5 w-3.5" />
            </span>
            Kairo AI Control Room
          </div>

          <div className="max-w-xl space-y-4">
            <h1 className="text-4xl font-black tracking-normal text-foreground sm:text-5xl">
              Acceso interno para operaciones de voz.
            </h1>
            <p className="text-base leading-7 text-muted-foreground">
              Protege pedidos, llamadas y configuracion de agentes con una sesion simple antes de pasar a usuarios completos.
            </p>
          </div>

          <div className="grid max-w-xl gap-3 sm:grid-cols-3">
            {["Shopify", "Retell", "Supabase"].map((item) => (
              <div key={item} className="border border-border bg-card/60 p-4">
                <ShieldCheck className="mb-3 h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">{item}</p>
                <p className="mt-1 text-xs text-muted-foreground">Protegido</p>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full border border-border bg-card/85 p-6 shadow-2xl shadow-black/30 backdrop-blur md:p-8">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-primary">Login</p>
              <h2 className="mt-2 text-2xl font-bold">Entrar al panel</h2>
            </div>
            <div className="flex h-11 w-11 items-center justify-center bg-primary text-primary-foreground">
              <Lock className="h-5 w-5" />
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium text-muted-foreground">
                Password
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-12 pl-10"
                  placeholder="Ingresa la clave del panel"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {error}
              </p>
            )}

            <Button type="submit" className="h-12 w-full gap-2" disabled={loading}>
              {loading ? "Validando..." : "Entrar"}
            </Button>
          </form>
        </div>
      </section>
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
