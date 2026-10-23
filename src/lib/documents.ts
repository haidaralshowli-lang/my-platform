/// أنواع مستندات المخالفة. تُضاف أنواع مسارات المراحل اللاحقة (الإنذار الموقع، وصل الاستلام، مستندات الدعوى…) مع أجزائها.
export const VIOLATION_DOC_TYPES = {
  VIOLATION_REPORT: "المحضر الأصلي",
  SUPPLEMENTARY: "مستند تكميلي",
  EVIDENCE: "دليل أو صورة",
  OFFICIAL_LETTER: "كتاب رسمي",
  MEDIA_RECORDING: "تسجيل صوتي أو مرئي",
  OTHER: "مستند آخر",
} as const;

export type ViolationDocType = keyof typeof VIOLATION_DOC_TYPES;

export const CONFIDENTIALITY_LABELS = {
  NORMAL: "عادي",
  RESTRICTED: "محدود التداول",
  CONFIDENTIAL: "سري",
} as const;

export const ATTACHMENT_STATUS_LABELS = {
  DRAFT: "غير معتمد",
  APPROVED: "معتمد",
  SUPERSEDED: "مستبدل",
  WITHDRAWN: "مسحوب",
} as const;

export function docTypeLabel(code: string): string {
  return (VIOLATION_DOC_TYPES as Record<string, string>)[code] ?? code;
}
