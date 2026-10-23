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

// ─── المرحلة السابعة والثامنة: التبليغ والمدد (تُطلق من خدماتها بعد التحقق من الصلاحية) ───

defineTransition("warning_sent", { labelAr: "إرسال الإنذار للتبليغ", from: ["AWAITING_DELIVERY"], to: "AWAITING_RECEIPT_PROOF", permission: "delivery.record" });
defineTransition("receipt_recorded", { labelAr: "تسجيل استلام الإنذار", from: ["AWAITING_RECEIPT_PROOF"], to: "DEADLINE_RUNNING", permission: null });
defineTransition("deadline_expired", { labelAr: "انتهاء المدة دون استجابة", from: ["DEADLINE_RUNNING"], to: "DEADLINE_EXPIRED", permission: null });
defineTransition("deadline_reopened", { labelAr: "عودة سريان المدة بعد تصحيح أو تمديد", from: ["DEADLINE_EXPIRED"], to: "DEADLINE_RUNNING", permission: null });
defineTransition("extension_requested", { labelAr: "تسجيل طلب تمديد", from: ["DEADLINE_RUNNING", "DEADLINE_EXPIRED"], to: "EXTENSION_UNDER_REVIEW", permission: null });
defineTransition("extension_decided_running", { labelAr: "قرار طلب التمديد (المدة سارية)", from: ["EXTENSION_UNDER_REVIEW"], to: "DEADLINE_RUNNING", permission: null });
defineTransition("extension_decided_expired", { labelAr: "قرار طلب التمديد (المدة منتهية)", from: ["EXTENSION_UNDER_REVIEW"], to: "DEADLINE_EXPIRED", permission: null });

// ─── المرحلة التاسعة: الاستجابات والإزالة والاعتراضات (تُطلق من خدماتها بعد التحقق من الصلاحية) ───

const RESPONSE_STAGES = ["DEADLINE_RUNNING", "DEADLINE_EXPIRED", "AWAITING_RESPONSE_RECORD"] as const;

defineTransition("response_recorded", { labelAr: "تسجيل استجابة", from: [...RESPONSE_STAGES, "AWAITING_RESPONSE_VERIFICATION"], to: "AWAITING_RESPONSE_VERIFICATION", permission: null });
/// قبول الاستجابة: لا يُغلق الملف؛ ينتقل للتحقق النهائي والإغلاق بإجراء مستقل
defineTransition("response_accepted", { labelAr: "قبول الاستجابة", from: ["AWAITING_RESPONSE_VERIFICATION"], to: "AWAITING_FINAL_VERIFICATION", permission: null });
const RESUME_TARGETS = ["DEADLINE_RUNNING", "DEADLINE_EXPIRED"] as const;
defineTransition("response_insufficient", {
  labelAr: "عدم كفاية الاستجابة", from: ["AWAITING_RESPONSE_VERIFICATION"], permission: null,
  to: (_v, t) => {
    if (!t || !(RESUME_TARGETS as readonly string[]).includes(t)) throw new Error("مرحلة هدف غير مسموحة");
    return t;
  },
});
defineTransition("removal_approved", {
  labelAr: "اعتماد إزالة المخالفة بالكامل", from: ["AWAITING_RESPONSE_VERIFICATION", "AWAITING_FINAL_VERIFICATION"], to: "AWAITING_FINAL_VERIFICATION", permission: null, outcome: "FULL_REMOVAL",
});

export const OBJECTION_FROM = ["AWAITING_DELIVERY", "AWAITING_RECEIPT_PROOF", "DEADLINE_RUNNING", "DEADLINE_EXPIRED", "AWAITING_RESPONSE_VERIFICATION", "AWAITING_FINAL_VERIFICATION"] as const;
defineTransition("objection_filed", { labelAr: "تقديم اعتراض أو طعن", from: [...OBJECTION_FROM], to: "OBJECTION_UNDER_REVIEW", permission: null });
defineTransition("objection_continue", {
  labelAr: "استمرار سير المعاملة بعد قرار الاعتراض", from: ["OBJECTION_UNDER_REVIEW"], permission: null,
  to: (_v, t) => {
    if (!t || !(OBJECTION_FROM as readonly string[]).includes(t)) throw new Error("مرحلة هدف غير مسموحة");
    return t;
  },
});
defineTransition("objection_ends_file", { labelAr: "قبول الاعتراض وإنهاء المسار", from: ["OBJECTION_UNDER_REVIEW"], to: "AWAITING_FINAL_VERIFICATION", permission: null, outcome: "OBJECTION_APPEAL" });

// ─── عدم الاستجابة والدعوى الجزائية ───

defineTransition("nonresponse_initiate", {
  labelAr: "بدء إجراء عدم الاستجابة", from: ["DEADLINE_EXPIRED"], to: "AWAITING_NON_RESPONSE_APPROVAL", permission: "nonresponse.initiate", requiresReason: true,
  guard: async (tx, v) => {
    const d = await tx.deadlineCalculation.findFirst({ where: { violationId: v.id, isCurrent: true } });
    if (!d || d.status !== "EXPIRED" || !d.dueDate || d.dueDate.getTime() > Date.now()) return "لا توجد مدة قانونية مثبتة منتهية";
    const open = await tx.response.count({ where: { violationId: v.id, status: { in: ["RECORDED", "UNDER_VERIFICATION", "ACCEPTED"] } } });
    if (open) return "توجد استجابة مسجلة لم يُبت فيها أو مقبولة؛ لا يجوز بدء إجراء عدم الاستجابة";
    if (await tx.objection.count({ where: { violationId: v.id, status: "PENDING" } })) return "يوجد اعتراض قيد المراجعة";
    if (await tx.extensionRequest.count({ where: { violationId: v.id, status: "PENDING" } })) return "يوجد طلب تمديد قيد المراجعة";
    return null;
  },
});
defineTransition("nonresponse_return", { labelAr: "إعادة إجراء عدم الاستجابة", from: ["AWAITING_NON_RESPONSE_APPROVAL"], to: "DEADLINE_EXPIRED", permission: "nonresponse.approve", requiresReason: true });
/// الاعتماد يُطلق من خدمة الدعوى (تنشئ ملف الدعوى في المعاملة نفسها)
defineTransition("nonresponse_approve", { labelAr: "اعتماد عدم الاستجابة وفتح ملف الدعوى الجزائية", from: ["AWAITING_NON_RESPONSE_APPROVAL"], to: "CRIMINAL_CASE", permission: "nonresponse.approve", outcome: "NON_RESPONSE_CRIMINAL" });
defineTransition("case_referred", { labelAr: "تسجيل إحالة الدعوى", from: ["CRIMINAL_CASE"], to: "AWAITING_JUDGMENT", permission: null });
defineTransition("judgment_approved", { labelAr: "اعتماد بيانات الحكم القضائي", from: ["AWAITING_JUDGMENT"], to: "AWAITING_FINAL_VERIFICATION", permission: null });
defineTransition("judgment_reopened", { labelAr: "عودة الدعوى للمتابعة (طعن أو إجراء لاحق)", from: ["AWAITING_FINAL_VERIFICATION"], to: "AWAITING_JUDGMENT", permission: null });

// ─── الإغلاق وإعادة الفتح (تُطلق من خدمة الإغلاق بعد فحص الاكتمال) ───

defineTransition("closure_requested", { labelAr: "طلب إغلاق المخالفة", from: ["AWAITING_FINAL_VERIFICATION", "NOT_APPROVED"], to: "AWAITING_CLOSURE_APPROVAL", permission: null });
defineTransition("closure_rejected", {
  labelAr: "رفض طلب الإغلاق", from: ["AWAITING_CLOSURE_APPROVAL"], permission: null,
  to: (_v, t) => {
    if (t !== "AWAITING_FINAL_VERIFICATION" && t !== "NOT_APPROVED") throw new Error("مرحلة هدف غير مسموحة");
    return t;
  },
});
defineTransition("closure_approved", { labelAr: "اعتماد إغلاق المخالفة", from: ["AWAITING_CLOSURE_APPROVAL"], to: "CLOSED", permission: null, status: "CLOSED" });
defineTransition("reopened", { labelAr: "إعادة فتح المخالفة", from: ["CLOSED"], to: "AWAITING_FINAL_VERIFICATION", permission: null, status: "OPEN" });
