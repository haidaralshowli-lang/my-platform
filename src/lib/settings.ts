import type { Db } from "@/lib/db";

/// الإعدادات الافتراضية؛ تُخزَّن القيم المعدلة في جدول SystemSetting وتُسجَّل تعديلاتها في سجل التدقيق
export const DEFAULT_SETTINGS = {
  "numbering.violation": { pattern: "م-{YYYY}-{SEQ:6}" },
  "numbering.warning": { pattern: "إن-{YYYY}-{SEQ:5}" },
  "numbering.criminalCase": { pattern: "دج-{YYYY}-{SEQ:4}" },
  "attachments.maxSizeMb": 25,
  "attachments.maxFilesPerViolation": 200,
  /// أيام نهاية الأسبوع لاحتساب أيام العمل: 0 = الأحد … 6 = السبت (العراق: الجمعة والسبت)
  "deadline.weekendDays": [5, 6] as number[],
  "auth.maxFailedLogins": 5,
  "auth.lockMinutes": 15,
  "workflow.requireTechnicalReview": false,
  "workflow.requireLegalSecondApproval": false,
  "workflow.requireJudgmentApproval": true,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof DEFAULT_SETTINGS)[K] extends string
  ? string
  : (typeof DEFAULT_SETTINGS)[K] extends number
    ? number
    : (typeof DEFAULT_SETTINGS)[K] extends boolean
      ? boolean
      : (typeof DEFAULT_SETTINGS)[K];

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return (row ? row.value : DEFAULT_SETTINGS[key]) as SettingValue<K>;
}
