// Formas de datos del modulo de novedades (incidencias de reparto), compartidas
// entre el servidor (lib/incidents.ts, rutas, deteccion) y el cliente (page de
// incidencias). Sin imports.

export type IncidentSource = "moovin" | "forza" | "boxful" | "manual";

// Estados de gestion. Cada uno tiene un color en la UI (colorimetria).
export type IncidentStatus =
  | "pendiente"      // nueva, sin gestionar
  | "reprogramada"   // contesto y acordo nueva fecha
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
}

// Estados terminales: la deteccion automatica no los reabre.
export const TERMINAL_STATUSES: IncidentStatus[] = ["resuelta", "perdida", "descartada"];

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

// Capa de metricas ejecutivas (Fase 1). Todo se calcula para un periodo
// seleccionable; los limites de dia van en hora local CR/HN (UTC-6).
export type IncidentPeriod = "hoy" | "ayer" | "7d" | "30d";

export interface IncidentCausaStat {
  category: IncidentCategory;
  total: number;        // incidencias del periodo con esta causa
  resueltas: number;    // de esas, cuantas estan resueltas (estado actual)
  pct: number;          // % sobre el total de incidencias del periodo
  recuperacion: number; // resueltas / total * 100 (recuperacion por motivo)
}

export interface IncidentTrendPoint {
  date: string;      // YYYY-MM-DD (dia local CR/HN)
  generadas: number; // incidencias creadas ese dia
  resueltas: number; // resoluciones ese dia
}

export interface IncidentExecutiveStats {
  period: IncidentPeriod;
  nuevas: number;                // incidencias creadas en el periodo
  total_periodo: number;         // = nuevas (denominador de la cohorte)
  resueltas_periodo: number;     // resueltas DENTRO del periodo (por fecha de resolucion)
  tasa_resolucion: number;       // % de las creadas en el periodo que ya estan resueltas
  monto_recuperado: number;      // suma de cod_amount de las resueltas en el periodo
  abiertas: number;              // snapshot: estados no terminales
  edad_promedio_dias: number;    // snapshot: edad media de las abiertas (dias)
  mas_antigua: { dias: number; order_name: string; guide_number: string } | null;
  primera_gestion_horas: number | null; // promedio creacion -> primera llamada (cohorte)
  causas: IncidentCausaStat[];
  trend: IncidentTrendPoint[];
}

// El filtro por tienda usa el catalogo multi-tienda de produccion
// (lib/store-config.ts: FINANCE_STORES) a traves de ?store=<code>. Cada novedad
// queda asociada a una tienda por store_id.
