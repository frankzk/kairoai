type PhoneAttribute = {
  name?: string | null;
  key?: string | null;
  label?: string | null;
  title?: string | null;
  value?: unknown;
  val?: unknown;
  text?: unknown;
};

export type PhoneCountryCode = "CR" | "HN" | string | null | undefined;

export type PhoneExtractionOptions = {
  countryCode?: PhoneCountryCode;
};

const PHONE_KEY_RE = /(?:tel|telefono|cel|celular|phone|whats|whatsapp|movil|mobile|contacto)/i;

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCountryCode(countryCode: PhoneCountryCode): "CR" | "HN" | "" {
  const normalized = String(countryCode ?? "").trim().toUpperCase();
  return normalized === "CR" || normalized === "HN" ? normalized : "";
}

function formatCountryPhone(digits: string, countryCode: "CR" | "HN"): string | null {
  const countryPrefix = countryCode === "CR" ? "506" : "504";
  if (digits.startsWith(`00${countryPrefix}`) && digits.length === 13) {
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith(countryPrefix) && digits.length === 11) {
    return `+${digits}`;
  }
  if (digits.length === 8) {
    return `+${countryPrefix}${digits}`;
  }
  return null;
}

export function normalizePhoneValue(
  value: unknown,
  options: PhoneExtractionOptions = {}
): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  const digits = text.replace(/\D/g, "");
  const countryCode = normalizeCountryCode(options.countryCode);
  if (countryCode) return formatCountryPhone(digits, countryCode);

  if (digits.length < 8 || digits.length > 20) return null;

  return text;
}

export function pickBestPhone(
  values: unknown[],
  options: PhoneExtractionOptions = {}
): string | null {
  for (const value of values) {
    const phone = normalizePhoneValue(value, options);
    if (phone) return phone;
  }
  return null;
}

export function extractPhoneFromNoteAttributes(
  attrs?: Array<PhoneAttribute | Record<string, unknown>> | null,
  options: PhoneExtractionOptions = {}
): string | null {
  if (!Array.isArray(attrs)) return null;

  for (const attr of attrs) {
    const record = asRecord(attr);
    if (!record) continue;

    const key = normalizeKey(record.name ?? record.key ?? record.label ?? record.title ?? "");
    const value = record.value ?? record.val ?? record.text ?? "";
    if (PHONE_KEY_RE.test(key)) {
      const phone = normalizePhoneValue(value, options);
      if (phone) return phone;
    }
  }

  for (const attr of attrs) {
    const record = asRecord(attr);
    if (!record) continue;

    for (const [key, value] of Object.entries(record)) {
      if (!PHONE_KEY_RE.test(normalizeKey(key))) continue;
      const phone = normalizePhoneValue(value, options);
      if (phone) return phone;
    }
  }

  return null;
}

export function extractPhoneFromText(
  text: unknown,
  options: PhoneExtractionOptions = {}
): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const normalized = normalizeKey(raw);
  const labelIndex = normalized.search(PHONE_KEY_RE);
  if (labelIndex < 0) return null;

  const match = raw.slice(labelIndex).match(/\+?\d[\d\s().-]{6,}\d/);
  return normalizePhoneValue(match?.[0], options);
}

export function extractPhoneFromShopifyOrderRaw(
  order: Record<string, unknown>,
  options: PhoneExtractionOptions = {}
): string | null {
  const customer = asRecord(order.customer);
  const billing = asRecord(order.billing_address);
  const shipping = asRecord(order.shipping_address);
  const customerDefaultAddress = asRecord(customer?.default_address ?? customer?.defaultAddress);

  return (
    pickBestPhone(
      [order.phone, shipping?.phone, billing?.phone, customer?.phone, customerDefaultAddress?.phone],
      options
    ) ??
    extractPhoneFromNoteAttributes(order.note_attributes as Array<PhoneAttribute> | null, options) ??
    extractPhoneFromNoteAttributes(order.custom_attributes as Array<PhoneAttribute> | null, options) ??
    extractPhoneFromNoteAttributes(order.additional_details as Array<PhoneAttribute> | null, options) ??
    extractPhoneFromNoteAttributes(order.attributes as Array<PhoneAttribute> | null, options) ??
    extractPhoneFromText(order.note, options)
  );
}
