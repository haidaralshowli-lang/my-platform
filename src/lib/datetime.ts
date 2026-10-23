// أدوات التاريخ والوقت. كل الاحتساب يجري في الخادم بمنطقة زمنية واحدة (Asia/Baghdad افتراضياً).

export const DEFAULT_TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";

export function zonedParts(d: Date, tz = DEFAULT_TZ) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/// "YYYY-MM-DD" للتاريخ المحلي في المنطقة الزمنية المحددة
export function localDateKey(d: Date, tz = DEFAULT_TZ): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/// يحول تاريخاً محلياً (YYYY-MM-DD) ووقتاً محلياً في المنطقة الزمنية إلى لحظة UTC
export function zonedDateTimeToUtc(dateKey: string, time = "00:00", tz = DEFAULT_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // فرق المنطقة الزمنية عند تلك اللحظة (يعالج التوقيت الصيفي إن وُجد)
  const p = zonedParts(new Date(guess), tz);
  const asLocal = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(guess - (asLocal - guess));
}

export type DigitStyle = "latn" | "arab";

/// نمط الأرقام الموحد للعرض: APP_DIGITS=latn (0-9، افتراضي) أو arab (٠-٩)
export const DEFAULT_DIGITS: DigitStyle = process.env.APP_DIGITS === "arab" ? "arab" : "latn";

export function formatDate(d: Date | string | null | undefined, digits: DigitStyle = DEFAULT_DIGITS, tz = DEFAULT_TZ): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(`ar-IQ-u-nu-${digits}`, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined, digits: DigitStyle = DEFAULT_DIGITS, tz = DEFAULT_TZ): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(`ar-IQ-u-nu-${digits}`, {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function formatNumberLocale(n: number | string, digits: DigitStyle = DEFAULT_DIGITS): string {
  return new Intl.NumberFormat(`ar-IQ-u-nu-${digits}`).format(typeof n === "string" ? Number(n) : n);
}
