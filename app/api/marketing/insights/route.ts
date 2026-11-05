// Datos de la pestaña Análisis de Marketing (módulos 4–12), por sección:
//   pedidos       hechos anónimos de pedidos (cancelaciones, origen,
//                 complementos, provincias) y recompras; from/to (≤ 93 días).
//   productos     ventas por variante en 8 semanas y pedidos esperando stock.
//   cuentas       estado de cada cuenta de Meta, último día de TikTok (Make) y
//                 tipos de cambio aplicados.
//   segmentacion  gasto y compras del píxel por edad y género (Meta); from/to
//                 (≤ 31 días). Solo a pedido: una llamada por cuenta.
// Solo agregados o tuplas anónimas: ningún nombre, teléfono, dirección ni
// número de pedido sale de esta ruta. Errores del proveedor nunca se reenvían.
import { NextRequest } from "next/server";
import { marketingAccess, marketingReply } from "@/lib/marketing-access";
import {
  marketingDate,
  marketingPeriod,
  shiftDate,
} from "@/lib/marketing-dates";
import type { InsightSection } from "@/lib/marketing-insights-types";
import {
  accountsSection,
  cachedInsight,
  orderFactsSection,
  productInsightsSection,
  segmentationSection,
} from "@/lib/marketing-insights-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECTIONS: InsightSection[] = [
  "pedidos",
  "productos",
  "cuentas",
  "segmentacion",
];
const ERRORS: Record<InsightSection, string> = {
  pedidos: "No se pudieron leer los pedidos de iComfly. Vuelve a intentar.",
  productos:
    "No se pudieron calcular las ventas por producto. Vuelve a intentar.",
  cuentas: "No se pudo consultar el estado de las cuentas. Vuelve a intentar.",
  segmentacion:
    "No se pudo consultar la edad y el género en Meta. Vuelve a intentar.",
};

export async function GET(req: NextRequest) {
  const allowed = marketingAccess(req);
  if (!allowed)
    return marketingReply(
      { error: "Se requiere Marketing y acceso a Mireva Costa Rica." },
      403,
    );
  const params = req.nextUrl.searchParams;
  const section = params.get("section") as InsightSection | null;
  if (!section || !SECTIONS.includes(section))
    return marketingReply({ error: "Sección inválida." }, 400);
  const now = new Date();
  const today = marketingDate(now);
  const refresh = params.get("refresh") === "1";
  const range = (
    defaultFrom: string,
    defaultTo: string,
    maxDays: number,
    latest: string,
  ) => {
    const custom = params.has("from") || params.has("to");
    const period = custom
      ? marketingPeriod(params.get("from") || "", params.get("to") || "")
      : marketingPeriod(defaultFrom, defaultTo);
    return period && period.days <= maxDays && period.to <= latest
      ? period
      : null;
  };
  const key = (from = "", to = "") =>
    `${allowed.store.id}|${section}|${from}|${to}`;
  try {
    if (section === "pedidos") {
      const period = range(shiftDate(today, -6), today, 93, today);
      if (!period)
        return marketingReply(
          {
            error:
              "Indica un rango válido de hasta 93 días, sin fechas futuras.",
          },
          400,
        );
      return marketingReply(
        await cachedInsight(
          key(period.from, period.to),
          section,
          () => orderFactsSection(allowed.store, period.from, period.to, now),
          { refresh },
        ),
      );
    }
    if (section === "productos")
      return marketingReply(
        await cachedInsight(
          key(today),
          section,
          () => productInsightsSection(allowed.store, now),
          { refresh },
        ),
      );
    if (section === "cuentas")
      return marketingReply(
        await cachedInsight(
          key(),
          section,
          () => accountsSection(allowed.store, now),
          { refresh },
        ),
      );
    // Age and gender: complete days only (Meta closes the day in its own time zone).
    const yesterday = shiftDate(today, -1);
    const period = range(shiftDate(yesterday, -6), yesterday, 31, yesterday);
    if (!period)
      return marketingReply(
        { error: "Indica un rango válido de hasta 31 días, hasta ayer." },
        400,
      );
    return marketingReply(
      await cachedInsight(
        key(period.from, period.to),
        section,
        () => segmentationSection(period.from, period.to),
        { refresh },
      ),
    );
  } catch {
    return marketingReply({ error: ERRORS[section] }, 503);
  }
}
