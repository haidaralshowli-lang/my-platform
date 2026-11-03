import type { Db } from "@/lib/db";

/// الإعدادات وقيمها الافتراضية. تُخزَّن القيم المعدلة في جدول Setting.
export const SETTING_DEFAULTS = {
  "auth.maxFailedLogins": 5,
  "auth.lockMinutes": 15,
  /// عدد الأيام دون تحديث قبل اعتبار سجل الشخص «بحاجة إلى تحديث» وإرسال تنبيه
  "people.staleDays": 90,
  /// التنبيه المسبق قبل موعد متابعة الطلب (بالأيام)
  "requests.reminderDays": 2,
  /// التنبيه المسبق قبل موعد إنجاز المهمة (بالأيام)
  "tasks.reminderDays": 2,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const SETTING_LABELS: Record<SettingKey, string> = {
  "auth.maxFailedLogins": "عدد محاولات الدخول الفاشلة قبل قفل الحساب",
  "auth.lockMinutes": "مدة قفل الحساب (دقيقة)",
  "people.staleDays": "عدد الأيام دون تحديث قبل اعتبار السجل بحاجة إلى تحديث",
  "requests.reminderDays": "التنبيه قبل موعد متابعة الطلب (يوم)",
  "tasks.reminderDays": "التنبيه قبل موعد إنجاز المهمة (يوم)",
};

export const SETTING_LIMITS: Record<SettingKey, [number, number]> = {
  "auth.maxFailedLogins": [3, 20],
  "auth.lockMinutes": [1, 1440],
  "people.staleDays": [7, 730],
  "requests.reminderDays": [0, 30],
  "tasks.reminderDays": [0, 30],
};

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<number> {
  const row = await db.setting.findUnique({ where: { key } });
  const v = row?.value;
  return typeof v === "number" ? v : SETTING_DEFAULTS[key];
}

export async function getAllSettings(db: Db): Promise<Record<SettingKey, number>> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS } as Record<SettingKey, number>;
  for (const r of rows) if (r.key in out && typeof r.value === "number") out[r.key as SettingKey] = r.value;
  return out;
}
