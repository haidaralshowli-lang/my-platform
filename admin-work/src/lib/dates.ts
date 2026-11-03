// التواريخ اليومية (تاريخ الاستلام، موعد المتابعة، موعد الإنجاز) تُخزَّن كتاريخ بلا وقت (@db.Date)
// ويُمثَّل كل يوم بمنتصف ليل UTC. «اليوم» يُحتسب بالمنطقة الزمنية للمنصة لا بتوقيت الخادم.

const TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";

/// اليوم الحالي في المنطقة الزمنية للمنصة بصيغة YYYY-MM-DD
export function todayStr(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/// اليوم الحالي كقيمة Date صالحة للمقارنة مع حقول @db.Date
export function today(now = new Date()): Date {
  return new Date(`${todayStr(now)}T00:00:00.000Z`);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/// يحوّل YYYY-MM-DD إلى Date، ويعيد null للقيمة الفارغة ويرمي للقيمة غير الصالحة
export function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("صيغة التاريخ غير صحيحة");
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("التاريخ غير صحيح");
  return d;
}

/// عرض تاريخ يومي (@db.Date) دون إزاحة المنطقة الزمنية
export function fmtDay(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export function dayInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/// عدد الأيام بين يومين (موجب إذا كان b بعد a)
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/// تاريخ يومي داخل نص عربي محفوظ (ملاحظات السجل الزمني): يُعزل اتجاهه حتى لا تنقلب أجزاؤه
export function dayInText(d: Date | null | undefined): string {
  // شرطات غير قابلة للكسر حتى لا ينقسم التاريخ على سطرين
  return `\u2066${fmtDay(d).replace(/-/g, "\u2011")}\u2069`;
}
