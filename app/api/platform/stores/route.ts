import { NextResponse } from "next/server";
import {
  listCourierAccountsWithFallback,
  listPlatformStoresWithFallback,
} from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stores, couriers] = await Promise.all([
      listPlatformStoresWithFallback(),
      listCourierAccountsWithFallback(),
    ]);
    return NextResponse.json({ stores, couriers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer tiendas";
    return NextResponse.json({ stores: [], couriers: [], error: message }, { status: 500 });
  }
}
