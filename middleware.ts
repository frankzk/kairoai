import { NextRequest, NextResponse } from "next/server";
import { HEADER_USUARIO, identidadAHeader, leerSesion, opcionesCookie, SESSION_COOKIE, type SesionClaims } from "@/lib/auth";
import { cronAccessAllowed, wooCronAccessAllowed } from "@/lib/cron-auth";
import { cumple, esEstatico, exigenciaDe, inicioDe, permisosParaCronManual } from "@/lib/permisos";
import { aplicarEstado, consultarEstado } from "@/lib/sesion-revalidar";
import { COOKIE_YO, yoACookie } from "@/lib/sesion-cliente";

// LA PUERTA. Cada pedido a la app pasa por aca:
//   1. Que exige la ruta (lib/permisos.ts): publico, cron, sesion o permiso.
//   2. Quien es: la cookie firmada, revalidada contra la base (desactivada,
//      permisos o tiendas cambiados, contraseña reseteada -> se nota en <30 s).
//   3. Si puede: el permiso de la ruta y, si pide ?store=, que esa tienda sea
//      suya.
//   4. Le pasa la identidad a la ruta en un header interno, borrando antes el
//      que haya mandado el navegador (nadie puede hacerse pasar por otro).
//
// Las rutas que reciben la tienda en el CUERPO del pedido la validan en
// lib/stores.ts con esta misma identidad.

const PERMITIDO_SI_DEBE_CAMBIAR = ["/cuenta", "/api/auth/", "/api/health/crons"];

function esApi(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function siguiente(req: NextRequest, claims: SesionClaims | null): NextResponse {
  const h = new Headers(req.headers);
  h.delete(HEADER_USUARIO);
  if (claims) h.set(HEADER_USUARIO, identidadAHeader(claims));
  const res = NextResponse.next({ request: { headers: h } });
  // En cada PAGINA, la cookie legible con quien es (ver lib/sesion-cliente.ts).
  if (claims && !esApi(req.nextUrl.pathname)) {
    res.cookies.set({
      name: COOKIE_YO,
      value: yoACookie({ id: claims.u, nombre: claims.n, permisos: claims.p, tiendas: claims.s, staffId: claims.st, debeCambiar: claims.mc }),
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return res;
}

function sinSesion(req: NextRequest, limpiarCookie: boolean): NextResponse {
  const { pathname, search } = req.nextUrl;
  let res: NextResponse;
  if (esApi(pathname)) {
    res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    res = NextResponse.redirect(login);
  }
  if (limpiarCookie) res.cookies.set({ ...opcionesCookie(0), value: "" });
  return res;
}

async function sesionVigente(req: NextRequest): Promise<{ claims: SesionClaims | null; habiaCookie: boolean }> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const firmada = await leerSesion(cookie);
  if (!firmada) return { claims: null, habiaCookie: Boolean(cookie) };
  // El admin de la contraseña compartida no tiene fila: vale lo firmado.
  if (firmada.u === 0) return { claims: firmada, habiaCookie: true };
  return {
    claims: aplicarEstado(firmada, await consultarEstado(firmada.u, Date.now(), fetch, firmada.sv)),
    habiaCookie: true,
  };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (esEstatico(pathname)) return NextResponse.next();

  const exige = exigenciaDe(pathname, req.method);

  if (exige.tipo === "publico") {
    if (pathname === "/login") {
      const { claims } = await sesionVigente(req);
      if (claims) return NextResponse.redirect(new URL(claims.mc ? "/cuenta" : inicioDe(claims.p), req.url));
    }
    return siguiente(req, null);
  }

  const { claims, habiaCookie } = await sesionVigente(req);

  if (exige.tipo === "cron") {
    const allowed = pathname === "/api/cron/woo-status" || pathname === "/api/cron/elogy" ? wooCronAccessAllowed({
      identity: claims,
      authorization: req.headers.get("authorization"),
      secret: process.env.WOO_KENKU_IT_SYNC_SECRET,
    }) : cronAccessAllowed({
      permisos: claims ? claims.p : null,
      requeridos: permisosParaCronManual(pathname),
      authorization: req.headers.get("authorization"),
      secret: process.env.CRON_SECRET,
    });
    if (allowed) return siguiente(req, claims);
    // Con sesion pero sin el permiso: 403, no 401 (SessionGuard manda al
    // login ante cualquier 401 y la persona quedaria expulsada).
    return claims
      ? NextResponse.json({ error: "No tienes acceso a este proceso." }, { status: 403 })
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!claims) return sinSesion(req, habiaCookie);

  // Contraseña inicial puesta por otra persona: primero la cambia.
  if (claims.mc && !PERMITIDO_SI_DEBE_CAMBIAR.some((p) => pathname === p || pathname.startsWith(p))) {
    return esApi(pathname)
      ? NextResponse.json({ error: "Primero cambia tu contraseña.", debe_cambiar_clave: true }, { status: 403 })
      : NextResponse.redirect(new URL("/cuenta", req.url));
  }

  if (!cumple(exige, claims.p)) {
    if (esApi(pathname)) {
      return NextResponse.json({ error: "No tienes acceso a esta sección." }, { status: 403 });
    }
    const inicio = inicioDe(claims.p);
    return NextResponse.redirect(new URL(inicio === pathname ? "/cuenta" : inicio, req.url));
  }

  // La tienda que se pide tiene que ser una de las suyas.
  const store = req.nextUrl.searchParams.get("store");
  if (store && esApi(pathname) && !claims.s.includes(store.trim().toLowerCase())) {
    return NextResponse.json({ error: "No tienes acceso a esa tienda." }, { status: 403 });
  }

  return siguiente(req, claims);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
