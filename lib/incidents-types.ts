// Formas de datos del modulo de novedades (incidencias de reparto), compartidas
// entre el servidor (lib/incidents.ts, rutas, deteccion) y el cliente (page de
// incidencias). Sin imports.

export type IncidentSource = "moovin" | "forza" | "boxful" | "manual";

// Estados de gestion. Cada uno tiene un color en la UI (colorimetria).
export type IncidentStatus =
  | "pendiente"      // nueva, sin gestionar
  | "reprogramada"   // contesto y acordo nueva fecha
  | "reprog_fallida" // se reprogramo pero vencio la fecha sin entrega o fallo de nuevo
  | "sin_contestar"  // no contesto; cola de reintento "fin del dia"
  | "no_llamar"      // no volver a llamar
  | "resuelta"       // entregada / cerrada con exito
  | "perdida"        // devuelta o cancelada definitivamente
  | "descartada";    // falso positivo de la deteccion automatica

// Causa de la novedad.
export type IncidentCategory =
  | "fallo_entrega"
  | "direccion_incorrecta"
  | "cliente_no_responde"
  | "cliente_rechaza"
  | "devuelto_origen"
  | "dano_paquete"
  // El courier nunca reporto una falla, pero el envio lleva demasiado tiempo sin
  // entregarse ni devolverse (ver DEMORA_* en lib/incidents-detect.ts).
  | "demora_entrega"
  | "otro";

export type IncidentEventKind =
  | "detectada"
  | "estado_cambiado"
  | "categoria_cambiada"
  | "nota"
  | "llamada"
  | "reprogramada"
  | "no_llamar"
  | "accion_rts"
  | "accion_cancelar_shopify"
  | "descartada";

export type IncidentActionType =
  | "registrar_llamada"
  | "reprogramar"
  | "no_llamar"
  | "rts"
  | "cancelar_shopify"
  | "descartar";

export interface Incident {
  id: number;
  store_id: number;
  incident_key: string;
  source: IncidentSource;
  order_name: string;
  guide_number: string;
  shopify_order_id: string;
  customer_name: string;
  customer_phone: string;
  courier: string;
  cod_amount: number;
  category: IncidentCategory;
  status: IncidentStatus;
  detail: string;
  notes: string;
  reprogramada_para: string | null;
  // Momento (timestamp) en que se reprogramo por ultima vez. Sirve para detectar
  // una falla NUEVA posterior a la reprogramacion (-> reprog_fallida).
  reprogramada_at: string | null;
  intentos_llamada: number;
  ultimo_intento_at: string | null;
  last_tracking_status: string;
  last_tracking_group: string;
  manual_override: boolean;
  created_at: string;
  updated_at: string;
}

export interface IncidentEvent {
  id: number;
  incident_id: number;
  kind: IncidentEventKind;
  from_status: string;
  to_status: string;
  message: string;
  result: "ok" | "error" | "info";
  metadata: Record<string, unknown>;
  created_at: string;
}

// Un evento del historial de tracking del courier (Moovin / Forza). Misma forma
// que MoovinEvent / ForzaEvent; se expone en el detalle de la novedad para
// mostrar el historial completo de la guia y contar los intentos de entrega
// (eventos con group "failed").
export interface TrackingEvent {
  code: string;
  group: string;
  title: string;
  description: string;
  date: string | null;
  note: string;
}

// Candidata producida por la deteccion automatica (lib/incidents-detect.ts).
export interface DetectedIncident {
  store_id: number;
  incident_key: string;
  source: IncidentSource;
  order_name: string;
  guide_number: string;
  shopify_order_id: string;
  customer_name: string;
  customer_phone: string;
  courier: string;
  cod_amount: number;
  category: IncidentCategory;
  detail: string;
  last_tracking_status: string;
  last_tracking_group: string;
  // Fecha del evento de FALLA mas reciente del courier (group "failed"). Permite
  // saber si una reprogramada volvio a fallar despues de reprogramarse.
  last_failure_at: string | null;
}

// Estados terminales: la deteccion automatica no los reabre.
export const TERMINAL_STATUSES: IncidentStatus[] = ["resuelta", "perdida", "descartada"];

// Listas de valores en tiempo de ejecucion, EXHAUSTIVAS por construccion: un
// Record<Tipo, true> obliga a TypeScript a tener TODAS las claves, asi que
// agregar un estado o una causa al tipo rompe el build aca en vez de fallar en
// produccion.
//
// POR QUE EXISTE: cada lugar tenia su propia lista escrita a mano. Al agregar
// reprog_fallida y demora_entrega quedaron atras la API (/api/incidents
// rechazaba esos valores con 400: no se podia poner "Reprog. fallida" desde el
// detalle ni la causa "Demora en entrega") y el conteo por causa del servidor.
// La pantalla no fallaba porque sus listas si son Record<...> tipados.
const STATUS_KEYS: Record<IncidentStatus, true> = {
  pendiente: true,
  reprogramada: true,
  reprog_fallida: true,
  sin_contestar: true,
  no_llamar: true,
  resuelta: true,
  perdida: true,
  descartada: true,
};
const CATEGORY_KEYS: Record<IncidentCategory, true> = {
  fallo_entrega: true,
  direccion_incorrecta: true,
  cliente_no_responde: true,
  cliente_rechaza: true,
  devuelto_origen: true,
  dano_paquete: true,
  demora_entrega: true,
  otro: true,
};
const SOURCE_KEYS: Record<IncidentSource, true> = { moovin: true, forza: true, boxful: true, manual: true };

export const INCIDENT_STATUSES = Object.keys(STATUS_KEYS) as IncidentStatus[];
export const INCIDENT_CATEGORIES = Object.keys(CATEGORY_KEYS) as IncidentCategory[];
export const INCIDENT_SOURCES = Object.keys(SOURCE_KEYS) as IncidentSource[];

// Estadistica temporal de flujo de novedades. No es el snapshot por estado (esos
// son los chips de la cabecera), sino cuantas se movieron en cada ventana de tiempo.
export interface IncidentWindowStats {
  hoy: number;  // dia de hoy (hora local CR/HN)
  ayer: number; // dia de ayer
  d7: number;   // ultimos 7 dias (incluye hoy)
  d30: number;  // ultimos 30 dias (incluye hoy)
}

export interface IncidentTimeStats {
  resueltas: IncidentWindowStats; // transiciones a 'resuelta' (manual o auto por entrega)
  nuevas: IncidentWindowStats;    // novedades dadas de alta (cayeron en novedad)
}

// Capa de metricas ejecutivas: TODOS los periodos a la vez (sin selector). Los
// limites de dia van en hora local CR/HN (UTC-6).
export interface IncidentCausaStat {
  category: IncidentCategory;
  total: number;        // incidencias (ultimos 30d) con esta causa
  resueltas: number;    // de esas, cuantas estan resueltas (estado actual)
  pct: number;          // % sobre el total de incidencias del periodo
  recuperacion: number; // resueltas / total * 100 (recuperacion por motivo)
}

export interface IncidentTrendPoint {
  date: string;                         // YYYY-MM-DD (dia local CR/HN)
  generadas: number;                    // incidencias creadas ese dia
  resueltas: number;                    // resoluciones ese dia
  reprogramadas: number;                // reprogramaciones ese dia
  primera_gestion_horas: number | null; // promedio creacion -> 1er llamado (creadas ese dia)
  // De las creadas ESE dia, cuantas ya estan resueltas hoy. Es la unica de las
  // tres que se puede dividir por `generadas`: mide la misma poblacion. Las
  // otras dos cuentan eventos sobre todo el acumulado, no sobre las de ese dia.
  resueltas_de_las_nuevas: number;
}

// Una celda de la matriz de desempeño (un periodo).
export interface IncidentMatrixCell {
  nuevas: number;      // creadas en el periodo
  resueltas: number;   // resueltas dentro del periodo (flujo)
  tasa: number;        // cohorte: creadas-en-periodo ya resueltas / creadas-en-periodo (%)
  monto: number;       // cod de las resueltas en el periodo
  despachados: number; // pedidos despachados (con guia) por fecha de pedido en el periodo
}

export type IncidentMatrixKey = "hoy" | "ayer" | "d7" | "d30";

// Snapshot "Estado actual".
export interface IncidentEstadoActual {
  abiertas: number;              // estados no terminales
  abiertas_48h: number;          // abiertas con mas de 48 horas
  edad_promedio_dias: number;    // edad media de las abiertas
  mas_antigua: { dias: number; order_name: string; guide_number: string } | null;
  primera_gestion_horas: number | null; // promedio creacion -> primer llamado (ultimos 30d)
}

// Resumen ejecutivo completo: matriz (4 metricas x 4 periodos) + estado actual +
// tendencia 30d + causas 30d. Todo se carga de una sola vez.
// Totales de un periodo para el pie de la tabla de tendencia.
export interface IncidentPeriodTotal {
  nuevas: number;
  resueltas: number;
  reprogramadas: number;
  primera_gestion_horas: number | null;
  /** De las `nuevas` del periodo, cuantas ya estan resueltas hoy. */
  resueltas_de_las_nuevas: number;
}

export interface IncidentExecutiveStats {
  matriz: Record<IncidentMatrixKey, IncidentMatrixCell>;
  estado: IncidentEstadoActual;
  trend: IncidentTrendPoint[]; // ultimos 30 dias (dia: generadas / resueltas / reprogramadas / 1a gestion)
  trend_totales: { generadas: number; resueltas: number; balance: number };
  totales: {
    d7: IncidentPeriodTotal;
    d30: IncidentPeriodTotal;
    mesActual: IncidentPeriodTotal;
    mesPasado: IncidentPeriodTotal;
  };
  causas: IncidentCausaStat[]; // ultimos 30 dias, ordenadas desc (UI: top 5 + "ver todos")
}

// El filtro por tienda usa el catalogo multi-tienda de produccion
// (lib/store-config.ts: FINANCE_STORES) a traves de ?store=<code>. Cada novedad
// queda asociada a una tienda por store_id.
