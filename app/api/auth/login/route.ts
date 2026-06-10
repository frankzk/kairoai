import { NextRequest, NextResponse } from "next/server";
import { createSessionValue, isValidPassword, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password ?? "");

  if (!isValidPassword(password)) {
    return NextResponse.json(
      { error: "Password incorrecto." },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionValue(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
