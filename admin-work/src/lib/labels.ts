import type { DataStatus, EngagementLevel } from "@prisma/client";
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
