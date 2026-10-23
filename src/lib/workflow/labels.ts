import type {
  GeneralStatus,
  Priority,
  ViolationOutcome,
  ViolationStage,
} from "@prisma/client";

/// التسميات الافتراضية للمراحل (قابلة للتعديل من إعدادات النظام عبر WorkflowStageConfig)
export const STAGE_LABELS: Record<ViolationStage, string> = {
  DRAFT: "مسودة",
  REGISTERED: "تسجيل المخالفة",
  AWAITING_REPORT: "بانتظار رفع المحضر",
  AWAITING_FINAL_APPROVAL: "بانتظار المصادقة النهائية",
  AWAITING_TECHNICAL: "بانتظار الموقف الفني",
  AWAITING_LEGAL: "بانتظار المصادقة القانونية",
  AWAITING_WARNING_APPROVAL: "بانتظار موافقة إصدار الإنذار",
  WARNING_PREPARATION: "إعداد الإنذار",
  AWAITING_WARNING_SIGNATURE: "بانتظار توقيع الإنذار",
  AWAITING_DELIVERY: "بانتظار التبليغ",
  AWAITING_RECEIPT_PROOF: "بانتظار إثبات الاستلام",
  DEADLINE_RUNNING: "المدة القانونية سارية",
  AWAITING_RESPONSE_RECORD: "بانتظار تسجيل الاستجابة",
  AWAITING_RESPONSE_VERIFICATION: "بانتظار التحقق من الاستجابة",
  EXTENSION_UNDER_REVIEW: "طلب تمديد قيد المراجعة",
  OBJECTION_UNDER_REVIEW: "اعتراض أو طعن قيد المراجعة",
  DEADLINE_EXPIRED: "انتهت المدة دون استجابة",
  AWAITING_NON_RESPONSE_APPROVAL: "بانتظار اعتماد عدم الاستجابة",
  CRIMINAL_CASE: "ملف الدعوى الجزائية",
  AWAITING_JUDGMENT: "بانتظار الحكم أو استكمال مستندات الدعوى",
  AWAITING_FINAL_VERIFICATION: "بانتظار التحقق النهائي",
  AWAITING_CLOSURE_APPROVAL: "بانتظار اعتماد الإغلاق",
  NOT_APPROVED: "لم تتم الموافقة",
  CLOSED: "مغلقة",
};

export const STAGE_ORDER = Object.keys(STAGE_LABELS) as ViolationStage[];

export const STATUS_LABELS: Record<GeneralStatus, string> = { OPEN: "مفتوحة", CLOSED: "مغلقة" };

export const OUTCOME_LABELS: Record<ViolationOutcome, string> = {
  FINANCIAL_RESPONSE: "استجابة مالية",
  TECHNICAL_RESPONSE: "استجابة فنية",
  LEGAL_RESPONSE: "استجابة قانونية",
  FULL_REMOVAL: "إزالة المخالفة بالكامل",
  NON_RESPONSE_CRIMINAL: "عدم الاستجابة وإحالة إلى الدعوى الجزائية",
  OBJECTION_APPEAL: "اعتراض أو طعن",
  NOT_APPROVED: "عدم الموافقة على المخالفة",
  OTHER: "نتيجة نهائية أخرى",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "منخفضة",
  NORMAL: "عادية",
  HIGH: "عالية",
  URGENT: "عاجلة",
};

/// فئة لونية لكل مرحلة لتمييز الحالات الإجرائية بصرياً
export type Tone = "neutral" | "info" | "warning" | "danger" | "success" | "legal";

export function stageTone(stage: ViolationStage): Tone {
  switch (stage) {
    case "DRAFT":
    case "REGISTERED":
    case "AWAITING_REPORT":
      return "neutral";
    case "DEADLINE_EXPIRED":
    case "AWAITING_NON_RESPONSE_APPROVAL":
    case "NOT_APPROVED":
      return "danger";
    case "CRIMINAL_CASE":
    case "AWAITING_JUDGMENT":
      return "legal";
    case "CLOSED":
      return "success";
    case "DEADLINE_RUNNING":
    case "EXTENSION_UNDER_REVIEW":
    case "OBJECTION_UNDER_REVIEW":
      return "warning";
    default:
      return "info";
  }
}
