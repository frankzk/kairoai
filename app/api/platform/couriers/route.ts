import { NextRequest, NextResponse } from "next/server";
import { BUILT_IN_COURIER_ADAPTERS } from "@/lib/courier-adapters";
import {
  listCourierAccountsWithFallback,
  listCourierFileProfiles,
} from "@/lib/platform";
import { getRequiredStoreFromSearchParams } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const store = getRequiredStoreFromSearchParams(req.nextUrl.searchParams);
  if (!store) {
    return NextResponse.json(
      { error: "store requerido: usa un codigo de tienda valido" },
      { status: 400 }
    );
  }

  try {
    const [accounts, profiles] = await Promise.all([
      listCourierAccountsWithFallback(store.id),
      listCourierFileProfiles({ storeId: store.id }).catch(() => []),
    ]);
    return NextResponse.json({
      accounts,
      profiles,
      adapters: BUILT_IN_COURIER_ADAPTERS.map((adapter) => ({
        provider: adapter.provider,
        label: adapter.label,
        supportsApiTracking: adapter.supportsApiTracking,
        supportsFileImport: adapter.supportsFileImport,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al leer couriers";
    return NextResponse.json({ accounts: [], profiles: [], error: message }, { status: 500 });
  }
}
