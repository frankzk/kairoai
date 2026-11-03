// Que anulaciones cuentan para la tasa de confirmacion (03/11/2026).
//
// Un pedido anulado por Duplicado, Numero errado, Producto agotado, Lista
// negra, Error en el pedido (lo usan para el "cambio en la orden": se anula
// para rehacerlo con otro producto), Fraude o porque se reemplazo por un
// pedido con upsell NO es un cliente que rechazo: no fue un pedido real que
// se pudiera confirmar. Esos se sacan de la tasa: ni arriba ni abajo.
//
// Los que SI cuentan: Cliente no contesta, Cliente cancelo, Direccion
// incorrecta, No cobertura, cancelados desde Shopify y cualquier otro motivo
// (o sin motivo). Ante la duda, cuenta: sacar de mas maquillaria la tasa.
//
// El motivo es el de iComfly (cancellation_reason). Algunos se escriben a
// mano ("lista negra ya tiene 2 devoluciones"), por eso se reconocen por
// palabras y no por igualdad.
//
// Puro: se prueba en tests/anulacion-motivos.test.ts.

export type GrupoAnulacionExcluida =
  | "duplicado"
  | "numero_errado"
  | "producto_agotado"
  | "lista_negra"
  | "cambio_en_la_orden"
  | "fraude"
  | "upsell"
  | "prueba";

export const GRUPO_ANULACION_LABEL: Record<GrupoAnulacionExcluida, string> = {
  duplicado: "Duplicado",
  numero_errado: "Número errado",
  producto_agotado: "Producto agotado",
  lista_negra: "Lista negra",
  cambio_en_la_orden: "Cambio en la orden",
  fraude: "Fraude / sospechoso",
  upsell: "Reemplazado por upsell",
  prueba: "Prueba o migración",
};

function normalizar(motivo: string): string {
  return motivo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// El primero que coincide gana. "Reemplazado ... upsell" va antes que todo:
// el texto de Kairo dice "Evitar doble despacho", no es un duplicado.
const REGLAS: Array<[GrupoAnulacionExcluida, RegExp]> = [
  ["upsell", /reemplazad[oa] por .*upsell|upsell existente/],
  ["duplicado", /duplicad/],
  ["numero_errado", /numero (errado|equivocado|incorrecto|malo|no existe)|numero invalido/],
  ["producto_agotado", /agotad|sin stock/],
  // "Mal historial" (Honduras) y "tiene 2 devoluciones" son la lista negra con otras palabras.
  ["lista_negra", /lista negra|devoluciones|mal historial/],
  ["cambio_en_la_orden", /error en el pedido|cambio (en|de) (la )?orden|cambio (en|de)l? pedido/],
  ["fraude", /fraude|sospechos/],
  // Pedidos de prueba y los anulados al migrar datos: nunca fueron de un cliente.
  ["prueba", /migracion de datos|^testeo?s?$|^prueba$/],
];

/** El grupo por el que esa anulacion NO cuenta, o null si cuenta. */
export function grupoAnulacionExcluida(motivo: string | null | undefined): GrupoAnulacionExcluida | null {
  const texto = normalizar(String(motivo ?? ""));
  if (!texto) return null;
  for (const [grupo, regla] of REGLAS) if (regla.test(texto)) return grupo;
  return null;
}

/** true si esa anulacion se saca de la tasa de confirmacion. */
export function anulacionExcluida(motivo: string | null | undefined): boolean {
  return grupoAnulacionExcluida(motivo) != null;
}

/**
 * Tasa de confirmacion: de los pedidos ya decididos (despachados o anulados
 * que cuentan), cuantos se despacharon. Los pendientes todavia no se deciden.
 */
export function tasaConfirmacion(despachados: number, anuladosQueCuentan: number): number | null {
  const decididos = despachados + anuladosQueCuentan;
  return decididos > 0 ? (despachados / decididos) * 100 : null;
}
