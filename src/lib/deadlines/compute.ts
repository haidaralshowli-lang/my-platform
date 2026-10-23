// محرك احتساب المدد القانونية (دالة بحتة قابلة للاختبار).
// كل الاحتساب بالتاريخ المحلي في المنطقة الزمنية المعتمدة، لا بساعة جهاز المستخدم.
//
// دلالات القاعدة (تُعرض للمستخدم المخول عند إنشائها):
// - startEvent = RECEIPT_DATE: يوم الاستلام هو اليوم الأول من المدة.
// - startEvent = DAY_AFTER_RECEIPT: لا يُحتسب يوم الاستلام؛ اليوم الأول هو اليوم التالي له.
// - unit = CALENDAR_DAYS: أيام تقويمية متتالية. وإذا كان excludeHolidays مفعّلاً وصادف آخر يوم عطلةً
//   (رسمية أو نهاية أسبوع) تمتد المدة إلى أول يوم عمل بعده.
// - unit = WORKING_DAYS: تُعد أيام العمل فقط (تُستبعد أيام نهاية الأسبوع والعطل الرسمية دائماً).
// - تنتهي المدة بنهاية اليوم الأخير (23:59:59.999 بالتوقيت المحلي).

import { localDateKey, zonedDateTimeToUtc } from "@/lib/datetime";

export type RuleSpec = {
  duration: number;
  unit: "CALENDAR_DAYS" | "WORKING_DAYS";
  startEvent: "RECEIPT_DATE" | "DAY_AFTER_RECEIPT";
  excludeHolidays: boolean;
};

export type Calendar = {
  timezone: string;
  /// أيام نهاية الأسبوع: 0 = الأحد … 6 = السبت
  weekendDays: number[];
  /// تواريخ العطل الرسمية بصيغة YYYY-MM-DD
  holidays: Set<string>;
};

/// إضافة أيام إلى مفتاح تاريخ (YYYY-MM-DD) بحساب تقويمي خالص (بلا مناطق زمنية)
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isNonWorking(key: string, cal: Calendar): boolean {
  return cal.weekendDays.includes(weekdayOfKey(key)) || cal.holidays.has(key);
}

/// نهاية اليوم المحلي كلحظة UTC
export function endOfLocalDay(key: string, tz: string): Date {
  return new Date(zonedDateTimeToUtc(addDaysKey(key, 1), "00:00", tz).getTime() - 1);
}

export type DueResult = { startKey: string; dueKey: string; dueDate: Date };

/// يحسب اليوم الأول للاحتساب وآخر يوم في المدة انطلاقاً من لحظة الاستلام
export function computeDue(receivedAt: Date, rule: RuleSpec, cal: Calendar): DueResult {
  if (!Number.isInteger(rule.duration) || rule.duration < 1) throw new Error("مدة القاعدة غير صالحة");
  const receiptKey = localDateKey(receivedAt, cal.timezone);
  let startKey = rule.startEvent === "DAY_AFTER_RECEIPT" ? addDaysKey(receiptKey, 1) : receiptKey;
  let dueKey: string;
  if (rule.unit === "WORKING_DAYS") {
    // اليوم الأول هو أول يوم عمل ابتداءً من تاريخ البدء
    while (isNonWorking(startKey, cal)) startKey = addDaysKey(startKey, 1);
    dueKey = startKey;
    let counted = 1;
    while (counted < rule.duration) {
      dueKey = addDaysKey(dueKey, 1);
      if (!isNonWorking(dueKey, cal)) counted++;
    }
  } else {
    dueKey = addDaysKey(startKey, rule.duration - 1);
    if (rule.excludeHolidays) while (isNonWorking(dueKey, cal)) dueKey = addDaysKey(dueKey, 1);
  }
  return { startKey, dueKey, dueDate: endOfLocalDay(dueKey, cal.timezone) };
}

/// تمديد المدة بعدد أيام من تاريخ الاستحقاق الحالي وفق وحدة القاعدة نفسها
export function extendDue(currentDueKey: string, days: number, rule: RuleSpec, cal: Calendar): DueResult {
  if (!Number.isInteger(days) || days < 1) throw new Error("مدة التمديد غير صالحة");
  let dueKey = currentDueKey;
  if (rule.unit === "WORKING_DAYS") {
    let counted = 0;
    while (counted < days) {
      dueKey = addDaysKey(dueKey, 1);
      if (!isNonWorking(dueKey, cal)) counted++;
    }
  } else {
    dueKey = addDaysKey(dueKey, days);
    if (rule.excludeHolidays) while (isNonWorking(dueKey, cal)) dueKey = addDaysKey(dueKey, 1);
  }
  return { startKey: currentDueKey, dueKey, dueDate: endOfLocalDay(dueKey, cal.timezone) };
}

export type LiveStatus = "RUNNING" | "NEAR_EXPIRY" | "EXPIRED";

/// الحالة الزمنية للمدة في لحظة معينة
export function liveStatus(dueDate: Date, warnBeforeDays: number, now: Date, tz: string): LiveStatus {
  if (now.getTime() > dueDate.getTime()) return "EXPIRED";
  const todayKey = localDateKey(now, tz);
  const dueKey = localDateKey(dueDate, tz);
  const warnFrom = addDaysKey(dueKey, -Math.max(0, warnBeforeDays));
  return todayKey >= warnFrom ? "NEAR_EXPIRY" : "RUNNING";
}

/// عدد الأيام التقويمية المتبقية حتى نهاية المدة (0 = ينتهي اليوم، سالب = انتهى)
export function daysRemaining(dueDate: Date, now: Date, tz: string): number {
  const a = localDateKey(now, tz);
  const b = localDateKey(dueDate, tz);
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
