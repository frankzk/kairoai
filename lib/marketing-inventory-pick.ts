// Qué inventario usa Marketing cuando hay más de uno: la foto de ShipHero (o
// la consulta en vivo con SHIPHERO_CR_*) y, si no, el último CSV product_table.
// Un CSV estrictamente más nuevo que la última foto de ShipHero gana: significa
// que la sincronización está rota y el archivo es lo más reciente que hay.
import type {
  MarketingInventory,
  MarketingSource,
} from "./marketing-source-types";

export function pickInventory(
  ship: MarketingSource<MarketingInventory>,
  csv: MarketingSource<MarketingInventory>,
): MarketingSource<MarketingInventory> {
  // The CSV keeps the state of a Kairo connection that has no snapshot yet.
  if (ship.status !== "ready" || !ship.data)
    return ship.connection && !csv.connection
      ? { ...csv, connection: ship.connection }
      : csv;
  const shipDate = ship.data.snapshotDate;
  if (
    csv.status === "ready" &&
    csv.data?.origin === "csv" &&
    csv.data.snapshotDate &&
    shipDate &&
    csv.data.snapshotDate > shipDate
  )
    return {
      ...csv,
      message: `${csv.message.replace(/\.$/, "")} (más reciente que ShipHero).`,
      ...(ship.connection ? { connection: ship.connection } : {}),
    };
  // A live static-env read has no snapshotDate: it always wins, as before.
  return ship;
}
