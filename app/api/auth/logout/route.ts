import { NextResponse } from "next/server";
import { opcionesCookie } from "@/lib/auth";
import { COOKIE_YO } from "@/lib/sesion-cliente";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...opcionesCookie(0), value: "" });
  res.cookies.set({ name: COOKIE_YO, value: "", path: "/", maxAge: 0 });
  return res;
}
