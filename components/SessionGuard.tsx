"use client";

import { useEffect } from "react";

// La cookie de sesion dura 7 dias. Cuando vence, la pagina ya cargada sigue
// en pantalla pero TODA llamada nueva a /api/* devuelve 401 {"error":
// "Unauthorized"} desde el middleware. Cada componente mostraba ese texto
// crudo donde podia (p.ej. el modal de seguimiento Moovin decia "Unauthorized"),
// o se quedaba en silencio con datos vacios.
//
// Este guard intercepta una sola vez el fetch del navegador: ante un 401 de
// NUESTRA API manda a /login conservando la ruta actual, que es lo que el
// usuario necesita hacer. No toca el resto de las respuestas.
const LOGIN_PATH = "/login";
// El login responde 401 con "Password incorrecto": ese error es del formulario
// y no debe disparar una redireccion.
const IGNORED_PATHS = ["/api/auth/login", "/api/auth/logout"];

function resolvePathname(input: RequestInfo | URL): string | null {
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    // Solo nos importan las llamadas a nuestra propia API.
    if (url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export default function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    // Guard de reentrada: si ya estamos yendo al login, no repetir.
    let redirecting = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init);
      if (res.status !== 401 || redirecting) return res;

      const pathname = resolvePathname(input);
      if (
        !pathname ||
        !pathname.startsWith("/api/") ||
        IGNORED_PATHS.includes(pathname) ||
        window.location.pathname === LOGIN_PATH
      ) {
        return res;
      }

      redirecting = true;
      const next = window.location.pathname + window.location.search;
      window.location.assign(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
