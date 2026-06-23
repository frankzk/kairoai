import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/shopify/auth",
  "/api/shopify/auth/callback",
  "/api/shopify/webhook",
  "/api/retell/llm",
  "/api/retell/webhook",
  "/api/cron/retries",
  "/api/cron/moovin",
  "/api/cron/icomfly",
];

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
