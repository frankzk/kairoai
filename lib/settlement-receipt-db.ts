// Acceso a datos del cobro de una liquidacion: el comprobante bancario y los
// montos que permiten el doble check. La matematica vive en
// lib/settlement-receipt.ts (pura, testeable); aca solo hay DB y Storage.
//
// El aislamiento por tienda se impone en cada consulta (`eq("store_id", ...)`),
// igual que en el resto del repo: no hay RLS en este proyecto.

import { getDB } from "./db";
import type { SettlementImport } from "./finance-types";

/** Bucket privado creado en 0035_settlement_receipts.sql. */
export const RECEIPT_BUCKET = "settlement-receipts";

/**
 * Cuanto vive la URL firmada del comprobante.
 *
 * Son capturas de movimientos bancarios: el bucket es privado y estas URLs son
 * la unica forma de verlas. Corta a proposito — alcanza para abrir la imagen,
 * no para que el enlace quede dando vueltas en un historial.
 */
const SIGNED_URL_TTL_SECONDS = 300;

export const RECEIPT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export interface ReceiptFields {
  received_usd: number | null;
  received_at: string | null;
  reference_rate: number | null;
  received_note: string | null;
  received_by: string | null;
}

/**
 * Ruta del comprobante dentro del bucket.
 *
 * Lleva la tienda y el id del import para que dos tiendas no puedan pisarse, y
 * un sufijo de tiempo para que subir un comprobante corregido no dependa de que
 * el CDN invalide el anterior.
 */
export function receiptPath(storeId: number, importId: number, ext: string): string {
  return `${storeId}/${importId}/${Date.now()}.${ext}`;
}

export function extensionForMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return null;
  }
}

/** Sube el comprobante y devuelve su ruta. No toca la fila. */
export async function uploadReceipt(opts: {
  storeId: number;
  importId: number;
  bytes: ArrayBuffer;
  mime: string;
}): Promise<string> {
  const ext = extensionForMime(opts.mime);
  if (!ext) throw new Error(`Tipo de archivo no admitido: ${opts.mime}`);
  const path = receiptPath(opts.storeId, opts.importId, ext);
  const { error } = await getDB()
    .storage.from(RECEIPT_BUCKET)
    .upload(path, opts.bytes, { contentType: opts.mime, upsert: false });
  if (error) throw new Error(`uploadReceipt: ${error.message}`);
  return path;
}

/**
 * Guarda los montos del cobro (y la ruta del comprobante si se subio uno).
 *
 * `receiptPath` se pasa solo cuando hay archivo nuevo: asi se pueden corregir
 * los montos sin obligar a volver a subir la captura.
 */
export async function saveReceipt(
  storeId: number,
  importId: number,
  fields: ReceiptFields,
  newReceiptPath?: string
): Promise<SettlementImport | null> {
  const patch: Record<string, unknown> = {
    ...fields,
    received_recorded_at: new Date().toISOString(),
  };
  if (newReceiptPath) patch.receipt_path = newReceiptPath;

  const { data, error } = await getDB()
    .from("settlement_imports")
    .update(patch)
    .eq("id", importId)
    .eq("store_id", storeId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`saveReceipt: ${error.message}`);
  return (data as SettlementImport | null) ?? null;
}

/** Borra los datos del cobro. Deja el archivo: el rastro de que existio importa. */
export async function clearReceiptAmounts(
  storeId: number,
  importId: number
): Promise<SettlementImport | null> {
  const { data, error } = await getDB()
    .from("settlement_imports")
    .update({
      received_usd: null,
      received_at: null,
      reference_rate: null,
      received_note: null,
      received_by: null,
      received_recorded_at: null,
    })
    .eq("id", importId)
    .eq("store_id", storeId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`clearReceiptAmounts: ${error.message}`);
  return (data as SettlementImport | null) ?? null;
}

/**
 * URL firmada para ver el comprobante. Devuelve null si esa liquidacion no
 * tiene comprobante o no es de esta tienda — el filtro por tienda es lo que
 * evita que alguien vea el comprobante de la otra pasando un id.
 */
export async function signedReceiptUrl(
  storeId: number,
  importId: number
): Promise<{ url: string; path: string } | null> {
  const { data: row, error } = await getDB()
    .from("settlement_imports")
    .select("receipt_path")
    .eq("id", importId)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw new Error(`signedReceiptUrl: ${error.message}`);
  const path = (row as { receipt_path: string | null } | null)?.receipt_path;
  if (!path) return null;

  const { data, error: signError } = await getDB()
    .storage.from(RECEIPT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError) throw new Error(`signedReceiptUrl: ${signError.message}`);
  return data?.signedUrl ? { url: data.signedUrl, path } : null;
}
