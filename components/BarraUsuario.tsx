"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { pantallasDe } from "@/lib/permisos";
import { leerYo, type Yo } from "@/lib/sesion-cliente";

/**
 * Barra fina arriba de todas las pantallas: a que secciones puede ir la
 * persona, quien es, su cuenta y salir. Solo muestra lo permitido, asi una
 * asesora nueva no ve botones que la mandan a pantallas que no son suyas.
 */
export default function BarraUsuario() {
  const pathname = usePathname();
  const [yo, setYo] = useState<Yo | null>(null);

  // La cookie la renueva el middleware en cada pagina: se relee al navegar.
  useEffect(() => setYo(leerYo()), [pathname]);

  if (pathname === "/login" || !yo) return null;

  const pantallas = pantallasDe(yo.permisos);
  const puedeArgentina = (yo.id === 0 || yo.tiendas.includes("kenku-ar")) && yo.permisos.some(p => p === "pedidos" || p === "finanzas");
  const puedeItalia = (yo.id === 0 || yo.tiendas.includes("kenku-it")) && yo.permisos.some(p => p === "pedidos" || p === "finanzas");

  async function salir() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <nav aria-label="Secciones" className="border-b border-border bg-card/60">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-1 gap-y-1 px-4 py-1.5 text-xs">
        {pantallas.map((p) => {
          const activa = p.ruta === "/" ? pathname === "/" : pathname.startsWith(p.ruta);
          return (
            <Link
              key={p.ruta}
              href={p.ruta}
              aria-current={activa ? "page" : undefined}
              className={`rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                activa ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
        {puedeArgentina && <Link href="/admin/finance/argentina" className="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Kenku Argentina</Link>}
        {puedeItalia && <Link href="/admin/finance/italia" className="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground">Kenku Italia</Link>}
        <div className="ml-auto flex items-center gap-1">
          <Link
            href="/cuenta"
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Mi cuenta: cambiar contraseña"
          >
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-medium text-foreground">{yo.nombre}</span>
          </Link>
          <button
            type="button"
            onClick={salir}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Salir
          </button>
        </div>
      </div>
    </nav>
  );
}
