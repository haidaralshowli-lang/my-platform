import type { Tx } from "@/lib/db";
import { nextOfficialNumber } from "@/lib/numbering";
import { defineTransition } from "./engine";

export async function hasActiveReport(tx: Tx, violationId: string): Promise<boolean> {
  const n = await tx.attachment.count({
    where: { violationId, documentType: "VIOLATION_REPORT", withdrawnAt: null },
  });
  return n > 0;
}

/// الحقول الإلزامية قبل التسجيل الرسمي
export function missingRegistrationFields(v: {
  offenderName: string;
  violationTypeId: string | null;
  discoveredAt: Date | null;
  description: string | null;
  detectionSourceId: string | null;
  organizerName: string | null;
}): string[] {
  const missing: string[] = [];
  if (!v.offenderName?.trim()) missing.push("اسم الجهة المخالفة");
  if (!v.violationTypeId) missing.push("نوع المخالفة");
  if (!v.discoveredAt) missing.push("تاريخ اكتشاف المخالفة");
  if (!v.description?.trim()) missing.push("وصف المخالفة");
  if (!v.detectionSourceId) missing.push("مصدر الاكتشاف");
  if (!v.organizerName?.trim()) missing.push("اسم الموظف المنظم");
  return missing;
}

// ─── المرحلة الأولى والثانية: التسجيل والمحضر ───

defineTransition("register", {
  labelAr: "تسجيل المخالفة رسمياً",
  from: ["DRAFT"],
  // تُسجَّل المخالفة؛ وإن لم يُرفع المحضر بعد تنتقل إلى «بانتظار رفع المحضر»
  to: (v) => (v.stage === "DRAFT" ? "REGISTERED" : v.stage),
  permission: "violation.submit",
  guard: async (_tx, v) => {
    if (v.archivedAt) return "المسودة مؤرشفة";
    const m = missingRegistrationFields(v);
    return m.length ? `يجب استكمال الحقول الإلزامية قبل التسجيل: ${m.join("، ")}` : null;
  },
  effect: async (tx, v) => {
    const office = await tx.office.findUniqueOrThrow({ where: { id: v.officeId }, include: { governorate: true } });
    const now = new Date();
    const number = await nextOfficialNumber(tx, "violation", { governorateCode: office.governorate.code, officeCode: office.code, at: now });
    return { number, registeredAt: now };
  },
});

defineTransition("await_report", {
  labelAr: "بانتظار رفع المحضر",
  from: ["REGISTERED"],
  to: "AWAITING_REPORT",
  permission: null,
});

defineTransition("report_attached", {
  labelAr: "اكتمال رفع المحضر",
  from: ["AWAITING_REPORT"],
  to: "REGISTERED",
  permission: null,
});

defineTransition("submit_for_approval", {
  labelAr: "إحالة للمصادقة النهائية",
  from: ["REGISTERED"],
  to: "AWAITING_FINAL_APPROVAL",
  permission: "violation.submit",
  guard: async (tx, v) => {
    const m = missingRegistrationFields(v);
    if (m.length) return `يجب استكمال الحقول الإلزامية: ${m.join("، ")}`;
    if (!(await hasActiveReport(tx, v.id))) return "يجب رفع المحضر الأصلي قبل الإحالة للمصادقة";
    return null;
  },
  // تُعتمد مرفقات التسجيل عند الإحالة فلا تُستبدل بعدها إلا بإصدار جديد مسبَّب
  effect: async (tx, v) => {
    await tx.attachment.updateMany({ where: { violationId: v.id, withdrawnAt: null, approvalStatus: "DRAFT" }, data: { approvalStatus: "APPROVED" } });
    return {};
  },
});

// ─── المرحلة الثالثة: المصادقة النهائية من رئيس الهيئة ───

defineTransition("final_approve", { labelAr: "المصادقة النهائية", from: ["AWAITING_FINAL_APPROVAL"], to: "AWAITING_TECHNICAL", permission: "approval.final_registration" });
defineTransition("final_return", { labelAr: "إعادة لاستكمال النواقص", from: ["AWAITING_FINAL_APPROVAL"], to: "REGISTERED", permission: "approval.final_registration", requiresReason: true });
defineTransition("final_reject", {
  labelAr: "عدم الموافقة على المخالفة", from: ["AWAITING_FINAL_APPROVAL"], to: "NOT_APPROVED", permission: "approval.final_registration",
  requiresReason: true, outcome: "NOT_APPROVED",
});

// ─── المرحلة الرابعة: الموقف الفني (تُطلق من خدمة الموقف الفني بعد تحققها من الصلاحية والمراجعة) ───

defineTransition("technical_complete", {
  labelAr: "اكتمال الموقف الفني", from: ["AWAITING_TECHNICAL"], to: "AWAITING_LEGAL", permission: null,
  guard: async (tx, v) => {
    const a = await tx.technicalAssessment.findFirst({ where: { violationId: v.id }, orderBy: { createdAt: "desc" } });
    return a?.status === "APPROVED" ? null : "الموقف الفني غير معتمد بعد";
  },
});

// ─── المرحلة الخامسة: الدائرة القانونية ───

const legalReady = async (tx: Tx, violationId: string) => {
  const a = await tx.legalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
  return a?.status === "SUBMITTED" ? null : "يجب إعداد الرأي القانوني وتقديمه قبل القرار";
};

defineTransition("legal_approve", {
  labelAr: "المصادقة القانونية", from: ["AWAITING_LEGAL"], to: "AWAITING_WARNING_APPROVAL", permission: "legal.approve",
  guard: async (tx, v) => (await legalReady(tx, v.id)) ?? (await hasLegalBasis(tx, v.id) ? null : "يجب ربط سند قانوني واحد على الأقل من المكتبة القانونية"),
});
defineTransition("legal_return", { labelAr: "إعادة المعاملة للاستكمال", from: ["AWAITING_LEGAL"], to: "REGISTERED", permission: "legal.approve", requiresReason: true });
defineTransition("legal_reject", {
  labelAr: "عدم الموافقة القانونية", from: ["AWAITING_LEGAL"], to: "NOT_APPROVED", permission: "legal.approve", requiresReason: true, outcome: "NOT_APPROVED",
});
defineTransition("legal_clarify", { labelAr: "طلب إيضاح من القسم الفني", from: ["AWAITING_LEGAL"], to: "AWAITING_TECHNICAL", permission: "legal.approve", requiresReason: true });

export async function hasLegalBasis(tx: Tx, violationId: string): Promise<boolean> {
  return (await tx.violationLegalReference.count({ where: { violationId, purpose: { in: ["LEGAL", "TECHNICAL", "WARNING"] } } })) > 0;
}

// ─── المرحلة السادسة: الإنذار ───

defineTransition("warning_approve", {
  labelAr: "الموافقة على إصدار الإنذار", from: ["AWAITING_WARNING_APPROVAL"], to: "WARNING_PREPARATION", permission: "warning.approve_issue",
  // لا يصدر إنذار قبل اكتمال المصادقات المطلوبة
  guard: async (tx, v) => {
    const [fin, tech, legal] = await Promise.all([
      tx.approval.findFirst({ where: { violationId: v.id, kind: "FINAL_REGISTRATION" }, orderBy: { decidedAt: "desc" } }),
      tx.technicalAssessment.findFirst({ where: { violationId: v.id, status: "APPROVED" } }),
      tx.legalAssessment.findFirst({ where: { violationId: v.id, status: "APPROVED" } }),
    ]);
    if (fin?.decision !== "APPROVED") return "لا توجد مصادقة نهائية نافذة على المخالفة";
    if (!tech) return "لا يوجد موقف فني معتمد";
    if (!legal) return "لا توجد مصادقة قانونية";
    return null;
  },
});
defineTransition("warning_return", { labelAr: "إعادة للدائرة القانونية", from: ["AWAITING_WARNING_APPROVAL"], to: "AWAITING_LEGAL", permission: "warning.approve_issue", requiresReason: true });
defineTransition("warning_reject", {
  labelAr: "رفض إصدار الإنذار", from: ["AWAITING_WARNING_APPROVAL"], to: "NOT_APPROVED", permission: "warning.approve_issue", requiresReason: true, outcome: "NOT_APPROVED",
});

defineTransition("warning_prepared", {
  labelAr: "إعداد الإنذار من القالب", from: ["WARNING_PREPARATION"], to: "AWAITING_WARNING_SIGNATURE", permission: "warning.prepare",
  guard: async (tx, v) => ((await tx.warning.count({ where: { violationId: v.id, status: "AWAITING_SIGNATURE" } })) === 1 ? null : "لا يوجد إنذار معد بانتظار التوقيع"),
});
defineTransition("warning_cancelled", {
  labelAr: "إلغاء الإنذار المعد وإعادة إعداده", from: ["AWAITING_WARNING_SIGNATURE"], to: "WARNING_PREPARATION", permission: "warning.prepare", requiresReason: true,
});
defineTransition("warning_signed", {
  labelAr: "رفع نسخة الإنذار الموقعة", from: ["AWAITING_WARNING_SIGNATURE"], to: "AWAITING_DELIVERY", permission: "warning.upload_signed",
  guard: async (tx, v) => {
    const w = await tx.warning.findFirst({ where: { violationId: v.id, status: "SIGNED", signedAttachmentId: { not: null } } });
    return w ? null : "لا تعتبر النسخة غير الموقعة إنذاراً موقعاً: يجب رفع النسخة الموقعة يدوياً";
  },
});
