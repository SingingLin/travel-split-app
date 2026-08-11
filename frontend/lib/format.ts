const CURRENCY_PREFIX: Record<string, string> = {
  TWD: "NT$",
  USD: "US$",
  IDR: "Rp",
  JPY: "¥",
  EUR: "€",
  CNY: "¥",
  KRW: "₩",
  THB: "฿",
  HKD: "HK$",
  GBP: "£",
};

/** Format a money amount with a currency-appropriate prefix and thousands separators. */
export function formatMoney(amount: number, currencyCode?: string): string {
  const prefix = currencyCode ? CURRENCY_PREFIX[currencyCode] ?? `${currencyCode} ` : "";
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const sign = amount < 0 ? "-" : "";
  return `${sign}${prefix}${formatted}`;
}

export function formatSignedMoney(amount: number, currencyCode?: string): string {
  const sign = amount >= 0 ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(amount), currencyCode)}`;
}

export function formatDate(dateStr: string): string {
  // dateStr is ISO "YYYY-MM-DD"
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[2]}`;
}

export function formatDateFull(dateStr: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}/${parts[1]}/${parts[2]}`;
}

/** First glyph for an avatar: first char for CJK, first letter uppercased for latin. */
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  // If starts with a CJK character, just use it.
  if (/[一-鿿]/.test(trimmed[0])) return trimmed[0];
  // Otherwise take up to 2 leading letters (e.g. "Sw" from "Singwell" is a
  // designer-authored nickname in the mockup; we default to first letter only
  // unless the caller passes an explicit short form).
  return trimmed[0].toUpperCase();
}
