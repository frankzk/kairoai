// Telefonía por tienda en la base (tabla telefonia_tiendas). Solo servidor.

import { getDB } from "@/lib/db";
import { configPorDefecto, validarConfigTelefonia, type ConfigTelefonia } from "@/lib/telefonia";

export interface ConfigTelefoniaGuardada extends ConfigTelefonia {
  /** false = no hay ajuste guardado: rige TELEFONIA. */
  guardada: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export async function leerConfigTelefonia(storeId: number): Promise<ConfigTelefoniaGuardada> {
  const { data, error } = await getDB()
    .from("telefonia_tiendas")
    .select("principal,respaldo,updated_by,updated_at")
    .eq("store_id", storeId)
    .maybeSingle();
  // Sin la tabla o con la base caída se llama como antes: el teléfono no se
  // apaga por un ajuste que no se pudo leer.
  if (error) console.warn(`[telefonia] no se pudo leer el ajuste: ${error.message}`);
  const fila = (error ? null : data) as { principal?: unknown; respaldo?: unknown; updated_by?: string | null; updated_at?: string | null } | null;
  const config = fila ? validarConfigTelefonia(fila) : null;
  if (!config) return { ...configPorDefecto(), guardada: false, updated_by: null, updated_at: null };
  return { ...config, guardada: true, updated_by: fila?.updated_by ?? null, updated_at: fila?.updated_at ?? null };
}

export async function guardarConfigTelefonia(storeId: number, config: ConfigTelefonia, by: string): Promise<void> {
  const { error } = await getDB()
    .from("telefonia_tiendas")
    .upsert(
      { store_id: storeId, principal: config.principal, respaldo: config.respaldo, updated_by: by.slice(0, 200), updated_at: new Date().toISOString() },
      { onConflict: "store_id" },
    );
  if (error) throw new Error(`No se pudo guardar la telefonía: ${error.message}`);
}
