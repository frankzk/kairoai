"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Inbox,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Package,
  Settings,
  Sparkles,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { leerYo, type Yo } from "@/lib/sesion-cliente";
import {
  itemActivo,
  menuDe,
  tiendaActual,
  tiendasDe,
  TIENDA_MARKETING,
  type IconoNav,
  type TiendaNav,
} from "@/lib/navegacion";
import { inicioDe } from "@/lib/permisos";
import { elegirTienda, useSelectedStore } from "@/lib/use-selected-store";
import type { FinanceStoreCode } from "@/lib/store-config";
import { SelectorTienda, sigla } from "./SelectorTienda";
import { aplicarTema, leerTema, type Tema } from "@/lib/tema";
import m from "./menu-lateral.module.css";

const ICONOS: Record<IconoNav, LucideIcon> = {
  panel: LayoutDashboard,
  leads: Inbox,
  novedades: AlertTriangle,
  gestion: Package,
  marketing: Megaphone,
  upsell: Sparkles,
  config: Settings,
  usuarios: Users,
};

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase("es"))
    .join("") || "?";

/**
 * Estructura de todas las pantallas: menú lateral fijo en escritorio y
 * barra superior con cajón en teléfono. Solo muestra las secciones que la
 * persona puede abrir. En /login no hay menú.
 */
export default function MenuLateral({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [elegida] = useSelectedStore();
  const [yo, setYo] = useState<Yo | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [tema, setTema] = useState<Tema>("claro");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // La cookie la renueva el middleware en cada página: se relee al navegar.
  useEffect(() => setYo(leerYo()), [pathname]);
  // El tono de esta persona (el script de <head> ya lo aplicó al cargar).
  useEffect(() => {
    if (!yo) return;
    const t = leerTema(yo.id);
    setTema(t);
    document.documentElement.classList.toggle("dark", t === "oscuro");
  }, [yo]);
  // Navegar cierra el cajón.
  useEffect(() => setAbierto(false), [pathname]);
  useEffect(() => {
    if (!abierto) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [abierto]);

  if (pathname === "/login") return <>{children}</>;

  const tiendas = yo ? tiendasDe(yo) : [];
  const tienda = tiendaActual(tiendas, pathname, elegida);
  const grupos = yo ? menuDe(yo, tienda) : [];
  const activo = itemActivo(grupos, pathname);
  const seccion = grupos
    .flatMap((g) => g.items)
    .find((i) => i.ruta === activo)?.label;

  // Una sola tienda para toda la app. Kenku abre su pantalla; Mireva cambia
  // la tienda y la pantalla abierta se recarga sola (useSelectedStore). Si la
  // pantalla no existe para la tienda nueva (Kenku, Marketing fuera de Costa
  // Rica), va a la primera sección de esa tienda.
  function cambiarTienda(t: TiendaNav) {
    if (t.ruta) {
      router.push(t.ruta);
      return;
    }
    elegirTienda(t.code as FinanceStoreCode);
    const enKenku = tienda?.marca === "Kenku";
    const enMarketing =
      pathname.startsWith("/admin/marketing") && t.code !== TIENDA_MARKETING;
    if ((enKenku || enMarketing) && yo) {
      const destino = menuDe(yo, t)[0]?.items[0]?.ruta ?? inicioDe(yo.permisos);
      router.push(destino);
    }
  }

  async function salir() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className={m.menu}>
      <header className={m.top}>
        <button
          ref={toggleRef}
          type="button"
          className={m.toggle}
          onClick={() => setAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={abierto}
          aria-controls="menu-lateral"
        >
          <Menu aria-hidden="true" />
        </button>
        <span className={m.topTitle}>
          <span
            className={tienda ? m.storeMark : m.mark}
            data-marca={tienda?.marca}
            aria-hidden="true"
          >
            {tienda ? sigla(tienda) : "K"}
          </span>
          {tienda?.label ?? "Kairo"}
          {seccion && (
            <span className={m.topSection}>
              <span aria-hidden="true">· </span>
              {seccion}
            </span>
          )}
        </span>
      </header>

      {abierto && (
        <div
          className={m.overlay}
          aria-hidden="true"
          onClick={() => setAbierto(false)}
        />
      )}

      <aside
        id="menu-lateral"
        ref={panelRef}
        className={m.panel}
        data-open={abierto}
        aria-label="Menú principal"
      >
        <div className={m.brand}>
          <SelectorTienda
            tiendas={tiendas}
            actual={tienda}
            onElegir={cambiarTienda}
          />
          <button
            type="button"
            className={m.close}
            onClick={() => {
              setAbierto(false);
              toggleRef.current?.focus();
            }}
            aria-label="Cerrar menú"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className={m.scroll} aria-label="Secciones">
          {grupos.map((g) => (
            <div key={g.key} className={m.group}>
              <p className={m.groupLabel} id={`menu-${g.key}`}>
                {g.label}
              </p>
              <ul className={m.list} aria-labelledby={`menu-${g.key}`}>
                {g.items.map((item) => {
                  const Icono = ICONOS[item.icono];
                  return (
                    <li key={item.ruta}>
                      <Link
                        href={item.ruta}
                        className={m.item}
                        aria-current={
                          item.ruta === activo ? "page" : undefined
                        }
                      >
                        <Icono aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {yo && (
          <div className={m.footer}>
            <div className={m.user}>
              <span className={m.avatar} aria-hidden="true">
                {iniciales(yo.nombre)}
              </span>
              <span className={m.userName}>{yo.nombre}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={tema === "oscuro"}
              className={m.themeSwitch}
              onClick={() => {
                const nuevo: Tema = tema === "oscuro" ? "claro" : "oscuro";
                setTema(nuevo);
                aplicarTema(nuevo, yo.id);
              }}
            >
              <Moon aria-hidden="true" />
              <span>Tono oscuro</span>
              <span className={m.track} aria-hidden="true">
                <span className={m.thumb} />
              </span>
            </button>
            <div className={m.footerActions}>
              <Link
                href="/cuenta"
                className={m.footerButton}
                aria-current={pathname === "/cuenta" ? "page" : undefined}
                title="Mi cuenta: cambiar contraseña"
              >
                <UserRound aria-hidden="true" />
                Mi cuenta
              </Link>
              <button type="button" className={m.footerButton} onClick={salir}>
                <LogOut aria-hidden="true" />
                Salir
              </button>
            </div>
          </div>
        )}
      </aside>

      <div className={m.content}>{children}</div>
    </div>
  );
}
