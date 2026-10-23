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

/// أنواع تُنشئها مسارات النظام (لا تُختار يدوياً من نموذج الرفع العام)
export const SYSTEM_DOC_TYPES = {
  SIGNED_WARNING: "الإنذار الموقع (نسخة ضوئية)",
  LEGAL_DOCUMENT: "ملف وثيقة مرجعية",
  RECEIPT: "وصل الاستلام (نسخة ضوئية)",
  EXTENSION_REQUEST: "مستند طلب التمديد",
} as const;

export function docTypeLabel(code: string): string {
  return (VIOLATION_DOC_TYPES as Record<string, string>)[code] ?? (SYSTEM_DOC_TYPES as Record<string, string>)[code] ?? code;
}

export const LEGAL_DOC_TYPE_LABELS = {
  LAW: "قانون",
  REGULATION: "لائحة أو نظام",
  INSTRUCTION: "تعليمات",
  DECISION: "قرار",
  CIRCULAR: "تعميم",
  TECHNICAL_STANDARD: "معيار أو مواصفة فنية",
  OTHER: "أخرى",
} as const;

export const LEGAL_DOC_STATUS_LABELS = {
  DRAFT: "مسودة (غير معتمدة)",
  IN_FORCE: "نافذة",
  AMENDED: "معدّلة",
  REPEALED: "ملغاة",
  ARCHIVED: "مؤرشفة",
} as const;

export const LEGAL_REF_PURPOSE_LABELS = {
  POTENTIAL: "مادة محتملة (عند التسجيل)",
  TECHNICAL: "سند الموقف الفني",
  LEGAL: "سند الرأي القانوني",
  WARNING: "سند الإنذار",
} as const;
