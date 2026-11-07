// Valores del alcance de ShipHero que comparten servidor y navegador (sin
// dependencias: la tarjeta de Marketing los importa).

/**
 * `warehouse_id` guardado cuando quien edita elige «Todos los almacenes»: el
 * stock se suma entre todos los almacenes de la cuenta. Nunca se envía a
 * ShipHero (la lectura va sin filtro de almacén). La clave de alcance queda
 * "<cuenta>|<cliente>|*", la misma fórmula que la guardia SQL.
 */
export const SHIPHERO_ALL_WAREHOUSES = "*";
export const SHIPHERO_ALL_WAREHOUSES_NAME = "Todos los almacenes";
