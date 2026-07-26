// Respuestas rapidas del chat de leads: acceso a datos (SOLO servidor).
// El formato y los tipos viven en quick-replies-format.ts para que los
// componentes cliente no arrastren el cliente de Supabase.

import { getDB } from "./db";
import type { QuickReply } from "./quick-replies-format";

export type { QuickReply };
export {
  renderQuickReply,
  QUICK_REPLY_MAX_TITLE,
  QUICK_REPLY_MAX_BODY,
} from "./quick-replies-format";

const COLUMNS = "id,title,body,usage_count";

export async function listQuickReplies(storeId: number): Promise<QuickReply[]> {
  const { data, error } = await getDB()
    .from("quick_replies")
    .select(COLUMNS)
    .eq("store_id", storeId)
    .eq("active", true)
    .order("usage_count", { ascending: false })
    .order("title", { ascending: true })
    .limit(200);
  if (error) throw new Error(`listQuickReplies: ${error.message}`);
  return (data ?? []) as QuickReply[];
}

export async function createQuickReply(opts: {
  storeId: number;
  title: string;
  body: string;
  createdBy?: number | null;
}): Promise<QuickReply> {
  const { data, error } = await getDB()
    .from("quick_replies")
    .insert({
      store_id: opts.storeId,
      title: opts.title,
      body: opts.body,
      created_by: opts.createdBy ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // 23505 = unique_violation del indice (store_id, lower(title)).
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Ya existe una respuesta rapida con ese nombre.");
    }
    throw new Error(`createQuickReply: ${error.message}`);
  }
  return data as QuickReply;
}

export async function updateQuickReply(opts: {
  storeId: number;
  id: number;
  title?: string;
  body?: string;
}): Promise<QuickReply | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (opts.title !== undefined) patch.title = opts.title;
  if (opts.body !== undefined) patch.body = opts.body;

  const { data, error } = await getDB()
    .from("quick_replies")
    .update(patch)
    .eq("store_id", opts.storeId)
    .eq("id", opts.id)
    .eq("active", true)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Ya existe una respuesta rapida con ese nombre.");
    }
    throw new Error(`updateQuickReply: ${error.message}`);
  }
  return (data as QuickReply) ?? null;
}

/** Borrado logico: conserva el historial de uso. */
export async function deleteQuickReply(storeId: number, id: number): Promise<boolean> {
  const { data, error } = await getDB()
    .from("quick_replies")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("store_id", storeId)
    .eq("id", id)
    .eq("active", true)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`deleteQuickReply: ${error.message}`);
  return data != null;
}

/**
 * Suma 1 al contador de uso (las mas usadas suben solas en el composer).
 * Es telemetria: si falla no debe romper el envio del mensaje.
 */
export async function bumpQuickReplyUsage(storeId: number, id: number): Promise<void> {
  const db = getDB();
  const { data, error } = await db
    .from("quick_replies")
    .select("usage_count")
    .eq("store_id", storeId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return;
  await db
    .from("quick_replies")
    .update({ usage_count: ((data as { usage_count: number }).usage_count ?? 0) + 1 })
    .eq("store_id", storeId)
    .eq("id", id);
}
