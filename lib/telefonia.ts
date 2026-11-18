// Telefonía por tienda (Configuración › Telefonía): con qué proveedor llaman
// las asesoras y cuál se usa de respaldo si el principal no conecta.
//
//   principal: "zadarma" | "telnyx"
//   respaldo:  el otro, o null (sin respaldo)
//
// Sin ajuste guardado rige TELEFONIA de Vercel (lo de antes) y no hay
// respaldo. Aquí solo lo puro (sirve en el navegador); la base está en
// lib/telefonia-db.ts. Se prueba en tests/telefonia.test.ts.

export type ProveedorTelefonia = "zadarma" | "telnyx";

export interface ConfigTelefonia {
  principal: ProveedorTelefonia;
  respaldo: ProveedorTelefonia | null;
}

export const PROVEEDORES: ProveedorTelefonia[] = ["zadarma", "telnyx"];

export const NOMBRE_PROVEEDOR: Record<ProveedorTelefonia, string> = {
  zadarma: "Zadarma",
  telnyx: "Telnyx",
};

const esProveedor = (v: unknown): v is ProveedorTelefonia => v === "zadarma" || v === "telnyx";

/** Lo de antes: TELEFONIA=telnyx | zadarma, sin respaldo. */
export function configPorDefecto(env: Record<string, string | undefined> = process.env): ConfigTelefonia {
  return {
    principal: (env.TELEFONIA ?? "").trim().toLowerCase() === "telnyx" ? "telnyx" : "zadarma",
    respaldo: null,
  };
}

/** Valida lo que llega del navegador. El respaldo no puede ser el mismo principal. */
export function validarConfigTelefonia(input: unknown): ConfigTelefonia | null {
  if (!input || typeof input !== "object") return null;
  const { principal, respaldo } = input as { principal?: unknown; respaldo?: unknown };
  if (!esProveedor(principal)) return null;
  if (respaldo == null || respaldo === "") return { principal, respaldo: null };
  if (!esProveedor(respaldo) || respaldo === principal) return null;
  return { principal, respaldo };
}
