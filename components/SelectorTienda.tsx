"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { TiendaNav } from "@/lib/navegacion";
import m from "./menu-lateral.module.css";

/** Código del país de la tienda: CR, HN, IT, MX, AR. */
export const sigla = (t: TiendaNav) =>
  (t.code.split("-")[1] ?? t.pais.slice(0, 2)).toLocaleUpperCase("es");

/**
 * Selector único de tienda, arriba del menú (como el de cuenta de Stripe).
 * Con una sola tienda es solo su nombre. La lista agrupa Mireva y Kenku; se
 * maneja con flechas, Inicio/Fin, Enter y Escape.
 */
export function SelectorTienda({
  tiendas,
  actual,
  onElegir,
}: {
  tiendas: readonly TiendaNav[];
  actual: TiendaNav | null;
  onElegir: (t: TiendaNav) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    const opciones = () =>
      Array.from(
        lista.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [],
      );
    (opciones().find((o) => o.getAttribute("aria-checked") === "true") ?? opciones()[0])?.focus();
    const cerrar = (volver: boolean) => {
      setAbierto(false);
      if (volver) boton.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const ops = opciones();
      const i = ops.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        e.stopPropagation();
        cerrar(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = (i + (e.key === "ArrowDown" ? 1 : -1) + ops.length) % ops.length;
        ops[next]?.focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        ops[e.key === "Home" ? 0 : ops.length - 1]?.focus();
      } else if (e.key === "Tab") cerrar(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!lista.current?.contains(t) && !boton.current?.contains(t)) cerrar(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick);
    };
  }, [abierto]);

  if (!actual) return null;
  const marca = (
    <>
      <span className={m.storeMark} data-marca={actual.marca} aria-hidden="true">
        {sigla(actual)}
      </span>
      <span className={m.storeText}>
        <strong>{actual.label}</strong>
        <span>Kairo · {actual.pais}</span>
      </span>
    </>
  );
  if (tiendas.length <= 1) return <div className={m.store}>{marca}</div>;

  const grupos = (["Mireva", "Kenku"] as const)
    .map((marcaGrupo) => ({
      marca: marcaGrupo,
      items: tiendas.filter((t) => t.marca === marcaGrupo),
    }))
    .filter((g) => g.items.length);

  return (
    <div className={m.storeWrap}>
      <button
        ref={boton}
        type="button"
        className={`${m.store} ${m.storeButton}`}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={`${id}-tiendas`}
        aria-label={`Tienda: ${actual.label}. Cambiar de tienda`}
        onClick={() => setAbierto((v) => !v)}
      >
        {marca}
        <ChevronsUpDown className={m.storeChevron} aria-hidden="true" />
      </button>
      {abierto && (
        <div
          ref={lista}
          id={`${id}-tiendas`}
          role="menu"
          aria-label="Tiendas"
          className={m.storeMenu}
        >
          {grupos.map((g) => (
            <div key={g.marca} role="group" aria-label={g.marca} className={m.storeGroup}>
              <p className={m.storeGroupLabel} aria-hidden="true">
                {g.marca}
              </p>
              {g.items.map((t) => {
                const elegida = t.code === actual.code;
                return (
                  <button
                    key={t.code}
                    type="button"
                    role="menuitemradio"
                    aria-checked={elegida}
                    className={m.storeOption}
                    onClick={() => {
                      setAbierto(false);
                      boton.current?.focus();
                      if (!elegida) onElegir(t);
                    }}
                  >
                    <span className={m.storeMark} data-marca={t.marca} aria-hidden="true">
                      {sigla(t)}
                    </span>
                    <span className={m.storeOptionText}>{t.label}</span>
                    {elegida && <Check className={m.storeCheck} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
