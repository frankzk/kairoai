import { NextResponse } from "next/server";
import { FINANCE_STORES } from "@/lib/store-config";
import { callerIdDeTienda, getTelnyxConfig, grabarLlamadas, proveedorTelefonia, telnyxPublicKey, variableCallerId } from "@/lib/telnyx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: que le falta a Telnyx para funcionar, para la tarjeta de Configuracion.
// Solo nombres de variables y numeros publicos; nunca claves.
export async function GET() {
  const { faltan } = getTelnyxConfig();
  if (!telnyxPublicKey()) faltan.push("TELNYX_PUBLIC_KEY");
  const tiendas = FINANCE_STORES.map((s) => ({
    tienda: s.label,
    variable: variableCallerId(s.countryCode),
    numero: callerIdDeTienda(s.countryCode),
  }));
  return NextResponse.json({
    proveedor: proveedorTelefonia(),
    configurado: faltan.length === 0,
    faltan,
    grabar: grabarLlamadas(),
    tiendas,
  });
}
