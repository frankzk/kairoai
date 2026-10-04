import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { cronAccessAllowed } from "@/lib/cron-auth";

// Los crons NO van en esta lista: tienen su propia puerta mas abajo (sesion o
// CRON_SECRET, ver lib/cron-auth.ts). Antes estaban los 14 aca, abiertos a
// cualquiera, y agregar un cron exigia acordarse de sumarlo — el olvido que
// dejo a shopify-recent cortado con 401 en cada invocacion.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/shopify/auth",
  "/api/shopify/auth/callback",
  "/api/shopify/webhook",
  "/api/retell/llm",
  "/api/retell/webhook",
  // Notificaciones de la centralita Zadarma: se autentican con la firma HMAC
  // del propio evento, no con la cookie de sesion.
  "/api/zadarma/webhook",
];

const CRON_PREFIX = "/api/cron/";

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authenticated = await isAuthenticated(req);

  if (pathname === "/login" && authenticated) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (pathname.startsWith(CRON_PREFIX)) {
    const allowed = cronAccessAllowed({
      authenticated,
      authorization: req.headers.get("authorization"),
      secret: process.env.CRON_SECRET,
    });
    return allowed
      ? NextResponse.next()
      : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!authenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
