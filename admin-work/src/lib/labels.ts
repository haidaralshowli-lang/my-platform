import type { ConsentStatus, DataStatus, EngagementLevel, Priority, RequestStatus, RequestType, TaskStatus } from "@prisma/client";
import type { Tone } from "@/components/ui";

export const DATA_STATUS: Record<DataStatus, { label: string; tone: Tone }> = {
  COMPLETE: { label: "مكتملة", tone: "success" },
  INCOMPLETE: { label: "ناقصة", tone: "warning" },
  NEEDS_UPDATE: { label: "بانتظار التحديث", tone: "info" },
};

export const ENGAGEMENT: Record<EngagementLevel, { label: string; tone: Tone }> = {
  HIGH: { label: "مرتفع", tone: "success" },
  MEDIUM: { label: "متوسط", tone: "info" },
  LOW: { label: "منخفض", tone: "warning" },
  NONE: { label: "غير متفاعل", tone: "neutral" },
};

export const ENGAGEMENT_ORDER: EngagementLevel[] = ["HIGH", "MEDIUM", "LOW", "NONE"];

export const REQUEST_TYPE: Record<RequestType, string> = {
  ADMINISTRATIVE: "طلب إداري",
  PUBLIC_SERVICE: "طلب خدمي عام",
  INQUIRY: "استفسار",
  TRANSACTION: "متابعة معاملة",
  OTHER: "طلب آخر",
};
export const REQUEST_TYPES = Object.keys(REQUEST_TYPE) as RequestType[];

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  NEW: { label: "جديد", tone: "info" },
  UNDER_REVIEW: { label: "قيد المراجعة", tone: "legal" },
  REFERRED: { label: "محال إلى الجهة المختصة", tone: "warning" },
  FOLLOWING: { label: "قيد المتابعة", tone: "warning" },
  DONE: { label: "منجز", tone: "success" },
  FAILED: { label: "متعذر", tone: "danger" },
  CLOSED: { label: "مغلق", tone: "neutral" },
};
export const REQUEST_STATUSES = Object.keys(REQUEST_STATUS) as RequestStatus[];

export const PRIORITY: Record<Priority, { label: string; tone: Tone }> = {
  LOW: { label: "منخفضة", tone: "neutral" },
  NORMAL: { label: "عادية", tone: "info" },
  HIGH: { label: "عالية", tone: "warning" },
  URGENT: { label: "عاجلة", tone: "danger" },
};
export const PRIORITIES = Object.keys(PRIORITY) as Priority[];

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "لم تبدأ", tone: "neutral" },
  IN_PROGRESS: { label: "قيد التنفيذ", tone: "info" },
  WAITING: { label: "بانتظار رد", tone: "legal" },
  DONE: { label: "منجزة", tone: "success" },
  STUCK: { label: "متعثرة", tone: "danger" },
  CANCELLED: { label: "ملغاة", tone: "neutral" },
};
export const TASK_STATUSES = Object.keys(TASK_STATUS) as TaskStatus[];

export const CONSENT: Record<ConsentStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "بانتظار موافقة المكلف", tone: "warning" },
  ACCEPTED: { label: "تكليف نافذ (وافق المكلف)", tone: "success" },
  DECLINED: { label: "اعتذر المكلف", tone: "danger" },
  CHANGE_REQUESTED: { label: "طلب تعديل الموعد", tone: "legal" },
};
export const CONSENTS = Object.keys(CONSENT) as ConsentStatus[];
