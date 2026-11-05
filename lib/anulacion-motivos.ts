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
 * Tasa de confirmacion: confirmados ÷ generados (04/11/2026). Confirmar no es
 * despachar: los confirmados se leen del estado de iComfly
 * (lib/icomfly-estado-venta.ts). Los generados ya vienen sin los anulados que
 * no cuentan. null sin pedidos generados.
 */
export function tasaConfirmacion(confirmados: number, generados: number): number | null {
  return generados > 0 ? (confirmados / generados) * 100 : null;
}

// Motivo de anulación para Marketing (05/11/2026, módulo 7 "Cancelaciones").
// Un código, nunca el texto libre (puede traer nombres o teléfonos). Primero
// los grupos que no cuentan para Gestión; después dos extras que Gestión no
// separa (pedidos de prueba de integración y reemplazos por otro pedido, que
// no eran clientes) y "Cliente canceló".
export type MotivoMarketing =
  | GrupoAnulacionExcluida
  | "cliente_cancelo"
  | "sin_motivo"
  | "otro";

export const MOTIVO_MARKETING_LABEL: Record<MotivoMarketing, string> = {
  duplicado: "Duplicado",
  numero_errado: "Número errado",
  producto_agotado: "Producto agotado",
  lista_negra: "Cliente con devoluciones o lista negra",
  cambio_en_la_orden: "Error en el pedido",
  fraude: "Fraude / sospechoso",
  upsell: "Reemplazado por upsell u otro pedido",
  prueba: "Prueba",
  cliente_cancelo: "Cliente canceló",
  sin_motivo: "Sin motivo",
  otro: "Otro motivo",
};

export const MOTIVOS_MARKETING = Object.keys(
  MOTIVO_MARKETING_LABEL,
) as MotivoMarketing[];

const REGLAS_MARKETING: Array<[MotivoMarketing, RegExp]> = [
  ["prueba", /pedido de prueba|prueba tecnica|^prueba\b/],
  ["upsell", /reemplazad[oa] por (el )?pedido/],
  [
    "cliente_cancelo",
    /cliente (cancel|ya no|no (lo )?(quiere|desea)|no tiene (el )?dinero|no le parece esperar)|ya no lo (quiere|desea)|(compr[oa]|consigui[oa]) en +otro lado/,
  ],
];

/** Código de motivo para Marketing. Vacío → sin_motivo; sin regla → otro. */
export function motivoMarketing(
  motivo: string | null | undefined,
): MotivoMarketing {
  const texto = normalizar(String(motivo ?? ""));
  if (!texto) return "sin_motivo";
  const grupo = grupoAnulacionExcluida(texto);
  if (grupo) return grupo;
  for (const [codigo, regla] of REGLAS_MARKETING)
    if (regla.test(texto)) return codigo;
  return "otro";
}

/** true si el código es uno de los grupos que Gestión saca de la tasa. */
export const esGrupoGestion = (
  codigo: MotivoMarketing,
): codigo is GrupoAnulacionExcluida =>
  codigo in GRUPO_ANULACION_LABEL;
