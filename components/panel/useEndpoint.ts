"use client";

import { useEffect, useRef, useState } from "react";
import { failureFromStatus } from "@/lib/panel-atencion";

/**
 * Estado de un bloque del Panel. Cada bloque carga y falla por su cuenta:
 * un 403 en Leads no toca las metricas de pedidos.
 */
export type BlockState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "sin_acceso" }
  | { status: "no_disponible" };

const RETRY_503_MS = 4000;

/**
 * GET de una ruta existente con su propio estado.
 *
 * - `allowed: false` -> "sin_acceso" sin pedir nada (la cookie dice que la
 *   persona no tiene ese permiso; el servidor lo impondria igual con un 403).
 * - `url: null` -> sigue cargando (aun no se sabe que pedir).
 * - Al recargar el mismo `scope` (misma tienda) conserva lo anterior con
 *   `refreshing: true`; al cambiar de tienda vuelve a "loading" para no mostrar
 *   cifras de la otra tienda.
 * - Un 503 (dataset de pedidos todavia armandose) se reintenta una vez.
 */
export function useEndpoint<T>(
  url: string | null,
  parse: (json: unknown) => T,
  opts: { allowed: boolean; scope: string; nonce: number }
): BlockState<T> {
  const [state, setState] = useState<BlockState<T>>({ status: "loading" });
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const dataScope = useRef<string | null>(null);
  const { allowed, scope, nonce } = opts;

  useEffect(() => {
    if (!allowed) {
      dataScope.current = null;
      setState({ status: "sin_acceso" });
      return;
    }
    if (!url) {
      setState({ status: "loading" });
      return;
    }
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setState((prev) =>
      prev.status === "ready" && dataScope.current === scope ? { ...prev, refreshing: true } : { status: "loading" }
    );

    const run = async (attempt: number) => {
      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (res.status === 503 && attempt === 0) {
          retryTimer = setTimeout(() => void run(1), RETRY_503_MS);
          return;
        }
        if (!res.ok) {
          if (controller.signal.aborted) return;
          dataScope.current = null;
          setState({ status: failureFromStatus(res.status) });
          return;
        }
        const json: unknown = await res.json();
        if (controller.signal.aborted) return;
        const data = parseRef.current(json);
        dataScope.current = scope;
        setState({ status: "ready", data, refreshing: false });
      } catch {
        if (controller.signal.aborted) return;
        dataScope.current = null;
        setState({ status: "no_disponible" });
      }
    };
    void run(0);
    return () => {
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [url, allowed, scope, nonce]);

  return state;
}
