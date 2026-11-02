/** Human-entered amounts: accept Spanish/English grouping without losing thousands. */
export function parseUpsellPrice(value: unknown): number {
  if (typeof value !== "string" || value.length > 40) return NaN;
  const text = value.trim();
  let normalized: string;
  if (/^\d+$/.test(text)) normalized = text;
  else if (/^\d+[.,]\d{1,2}$/.test(text)) normalized = text.replace(",", ".");
  else {
    // A single separator followed by three digits is a thousands group, never a decimal.
    const grouped = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text)
      ?? /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(text)
      ?? /^(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(text);
    if (!grouped) return NaN;
    normalized = grouped[1].replace(/[., \u00a0\u202f]/g, "") + (grouped[2] ? `.${grouped[2]}` : "");
  }
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) && amount > 0 ? amount : NaN;
}
