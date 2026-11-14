export function toFriendlyErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeExternalError(raw, fallback);
}

export function sanitizeExternalError(raw: unknown, fallback = "Error inesperado"): string {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();
  // Tambien un trozo de la pagina de error de Cloudflare (class="cf-..."),
  // que llega sin <html> cuando el mensaje ya venia recortado.
  const looksLikeHtml =
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("</html>") ||
    lower.includes("<head>") ||
    lower.includes("<body") ||
    lower.includes('class="cf-') ||
    /<(div|span|h[1-6]|p|a)\b[^>]*>/.test(lower);

  if (
    looksLikeHtml &&
    (/\b5(02|03|04|20|21|22|23|24)\b/.test(lower) || lower.includes("connection timed out") || lower.includes("cloudflare"))
  ) {
    return "La base de datos no respondió (corte momentáneo). Espera unos segundos y vuelve a intentar; si se repite, avísanos.";
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
