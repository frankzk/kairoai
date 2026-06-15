export function toFriendlyErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeExternalError(raw, fallback);
}

export function sanitizeExternalError(raw: unknown, fallback = "Error inesperado"): string {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();
  const looksLikeHtml =
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("</html>") ||
    lower.includes("<head>") ||
    lower.includes("<body");

  if (
    looksLikeHtml &&
    (lower.includes("522") || lower.includes("connection timed out") || lower.includes("cloudflare"))
  ) {
    return "Supabase no respondio a tiempo (Cloudflare 522). Espera unos segundos y vuelve a actualizar. Si se repite, revisamos estado/conexion de Supabase.";
  }

  if (looksLikeHtml) {
    return "Un proveedor externo devolvio HTML en vez de JSON. Vuelve a intentar; si persiste, revisamos la integracion afectada.";
  }

  const compact = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) return fallback;
  return compact.length > 360 ? `${compact.slice(0, 357)}...` : compact;
}
