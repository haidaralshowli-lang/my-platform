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
