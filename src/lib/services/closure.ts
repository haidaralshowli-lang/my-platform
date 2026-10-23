import { z } from "zod";
import type { ClosurePath, Violation, ViolationOutcome } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, inScope, type Actor } from "@/lib/rbac/actor";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { recordApproval } from "./approvals";

export const closureSchema = z.object({
  path: z.enum(["RESPONSE", "CRIMINAL_CASE", "NOT_APPROVED", "OTHER"]),
  finalOutcome: z.enum(["FINANCIAL_RESPONSE", "TECHNICAL_RESPONSE", "LEGAL_RESPONSE", "FULL_REMOVAL", "NON_RESPONSE_CRIMINAL", "OBJECTION_APPEAL", "NOT_APPROVED", "OTHER"]),
  reason: z.string().trim().min(10, "سبب الإغلاق مطلوب (10 أحرف على الأقل)").max(5000),
  notes: z.string().trim().max(5000).optional().transform((v) => v || null),
  supportingAttachmentIds: z.array(z.string()).default([]),
});

export type ClosureInput = z.infer<typeof closureSchema>;

const PATH_OUTCOMES: Record<ClosurePath, ViolationOutcome[]> = {
  RESPONSE: ["FINANCIAL_RESPONSE", "TECHNICAL_RESPONSE", "LEGAL_RESPONSE", "FULL_REMOVAL"],
  CRIMINAL_CASE: ["NON_RESPONSE_CRIMINAL"],
  NOT_APPROVED: ["NOT_APPROVED"],
  OTHER: ["OBJECTION_APPEAL", "OTHER"],
};

/// قواعد اكتمال الملف قبل الإغلاق. تعيد قائمة النواقص (فارغة = مكتمل).
export async function closureChecklist(tx: Tx | typeof prisma, v: Violation, input: Pick<ClosureInput, "path" | "finalOutcome" | "supportingAttachmentIds">): Promise<string[]> {
  const missing: string[] = [];
  if (!PATH_OUTCOMES[input.path].includes(input.finalOutcome)) missing.push("النتيجة النهائية لا تتفق مع مسار الإغلاق المختار");
  if (input.path === "NOT_APPROVED") {
    if (v.stage !== "NOT_APPROVED" || v.outcome !== "NOT_APPROVED") missing.push("لا يوجد قرار بعدم الموافقة على المخالفة");
  } else {
    if (v.stage !== "AWAITING_FINAL_VERIFICATION") missing.push("المعاملة ليست في مرحلة التحقق النهائي");
    if (!(await tx.attachment.count({ where: { violationId: v.id, documentType: "VIOLATION_REPORT", withdrawnAt: null } }))) missing.push("المحضر الأصلي");
    if (!(await tx.warning.count({ where: { violationId: v.id, status: "DELIVERED", signedAttachmentId: { not: null } } }))) missing.push("إنذار موقع ومبلَّغ");
    if (!(await tx.deliveryRecord.count({ where: { warning: { violationId: v.id }, receivedAt: { not: null }, receiptAttachmentId: { not: null } } }))) missing.push("وصل الاستلام");
  }
  if (input.path === "RESPONSE") {
    if (v.outcome !== input.finalOutcome) missing.push("النتيجة النهائية المختارة لا تطابق النتيجة المعتمدة في الملف");
    if (input.finalOutcome === "FULL_REMOVAL") {
      if (!(await tx.removalRecord.count({ where: { violationId: v.id, status: "APPROVED" } }))) missing.push("اعتماد إزالة المخالفة بالكامل");
    } else {
      const kind = { FINANCIAL_RESPONSE: "FINANCIAL", TECHNICAL_RESPONSE: "TECHNICAL", LEGAL_RESPONSE: "LEGAL" }[input.finalOutcome as "FINANCIAL_RESPONSE"] as "FINANCIAL" | "TECHNICAL" | "LEGAL";
      const accepted = await tx.response.findFirst({ where: { violationId: v.id, kind, status: "ACCEPTED" }, include: { financial: true } });
      if (!accepted) missing.push("استجابة مقبولة من النوع المطابق");
      else if (kind === "FINANCIAL" && accepted.financial?.paymentStatus !== "PAID") missing.push("تسديد المبلغ المستحق بالكامل");
    }
  }
  if (input.path === "CRIMINAL_CASE") {
    const c = await tx.criminalCase.findUnique({ where: { violationId: v.id }, include: { judgments: true } });
    if (!c) missing.push("ملف الدعوى الجزائية");
    else {
      if (!c.referralAt || !(await tx.attachment.count({ where: { ownerType: "CriminalCase", ownerId: c.id, documentType: "REFERRAL_LETTER", withdrawnAt: null } }))) missing.push("مستند الإحالة");
      const final = c.judgments.find((j) => j.approvedById && j.proceduralStatus === "FINAL" && j.attachmentId);
      if (!final) {
        // الدعوى قيد النظر أو الحكم غير مكتسب الدرجة القطعية: تبقى المخالفة مفتوحة
        missing.push("حكم قضائي معتمد مكتسب الدرجة القطعية مع نسخته (إن كانت الدعوى ما زالت قيد النظر تبقى المخالفة مفتوحة)");
      }
    }
  }
  if (input.path === "OTHER") {
    if (input.finalOutcome === "OBJECTION_APPEAL" && !(await tx.objection.count({ where: { violationId: v.id, status: "APPROVED" } }))) missing.push("قرار قبول الاعتراض أو الطعن");
    if (input.supportingAttachmentIds.length === 0) missing.push("مستند رسمي يستند إليه الإغلاق بنتيجة أخرى");
  }
  if (input.supportingAttachmentIds.length) {
    const n = await tx.attachment.count({ where: { id: { in: input.supportingAttachmentIds }, violationId: v.id, withdrawnAt: null } });
    if (n !== new Set(input.supportingAttachmentIds).size) missing.push("بعض المستندات المستند إليها غير صالحة أو لا تخص هذه المخالفة");
  }
  return missing;
}

/// طلب الإغلاق: يُمنع إذا نقصت حقول أو مستندات إلزامية
export async function requestClosure(actor: Actor, violationId: string, input: ClosureInput, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "closure.request");
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (await tx.closureRequest.count({ where: { violationId, status: "PENDING" } })) throw new AppError("يوجد طلب إغلاق قيد الاعتماد");
    const missing = await closureChecklist(tx, v, input);
    if (missing.length) throw new AppError(`لا يمكن طلب الإغلاق لنقص: ${missing.join("؛ ")}`);
    const r = await tx.closureRequest.create({ data: { violationId, ...input, requestedById: actor.id } });
    await writeAudit(tx, { actor, action: "closure.requested", entityType: "ClosureRequest", entityId: r.id, after: input, ctx });
    await applyTransition(tx, actor, violationId, "closure_requested", { system: true, reason: input.reason, ctx });
    return r.id;
  });
}

/// اعتماد الإغلاق (موافقة ثانية من غير مقدم الطلب). يُعاد فحص الاكتمال وقت الاعتماد.
export async function decideClosure(actor: Actor, requestId: string, approve: boolean, notes: string | null, ctx?: AuditContext) {
  assertCan(actor, "closure.approve");
  if (!approve && !notes?.trim()) throw new AppError("يجب بيان سبب رفض الإغلاق");
  await prisma.$transaction(async (tx) => {
    const r = await tx.closureRequest.findUnique({ where: { id: requestId } });
    if (!r) throw notFound();
    const v = await lockViolation(tx, r.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (r.status !== "PENDING") throw new AppError("صدر قرار في الطلب مسبقاً");
    if (r.requestedById === actor.id) throw forbidden("لا يعتمد الإغلاق من طلبه");
    const back = r.path === "NOT_APPROVED" ? "NOT_APPROVED" : "AWAITING_FINAL_VERIFICATION";
    if (approve) {
      // الفحص على حالة الملف قبل طلب الإغلاق
      const missing = await closureChecklist(tx, { ...v, stage: back }, r);
      if (missing.length) throw new AppError(`تغيرت حالة الملف ولم يعد مكتملاً: ${missing.join("؛ ")}`);
    }
    await tx.closureRequest.update({ where: { id: requestId }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNotes: notes } });
    await recordApproval(tx, actor, v.id, "CLOSURE", approve ? "APPROVED" : "REJECTED", notes, { type: "ClosureRequest", id: requestId });
    await writeAudit(tx, { actor, action: approve ? "closure.approved" : "closure.rejected", entityType: "ClosureRequest", entityId: requestId, reason: notes, ctx });
    if (approve) {
      await applyTransition(tx, actor, v.id, "closure_approved", { system: true, outcome: r.finalOutcome, reason: r.reason, ctx });
      await tx.criminalCase.updateMany({ where: { violationId: v.id, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
    } else {
      await applyTransition(tx, actor, v.id, "closure_rejected", { system: true, targetStage: back, reason: notes, ctx });
    }
  });
}

/// إعادة الفتح: بصلاحية خاصة وسبب، مع بقاء سجل الإغلاق السابق كما هو
export async function reopenViolation(actor: Actor, violationId: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "violation.reopen");
  if (reason.trim().length < 10) throw new AppError("يجب بيان سبب إعادة الفتح (10 أحرف على الأقل)");
  await prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (v.generalStatus !== "CLOSED") throw new AppError("المخالفة ليست مغلقة");
    const last = await tx.closureRequest.findFirst({ where: { violationId, status: "APPROVED" }, orderBy: { decidedAt: "desc" } });
    await tx.reopenRecord.create({ data: { violationId, closureRequestId: last?.id ?? null, reason: reason.trim(), reopenedById: actor.id, restoredStage: "AWAITING_FINAL_VERIFICATION" } });
    await recordApproval(tx, actor, violationId, "REOPEN", "APPROVED", reason);
    await writeAudit(tx, { actor, action: "violation.reopened", entityType: "Violation", entityId: violationId, before: { generalStatus: "CLOSED", outcome: v.outcome }, reason, ctx });
    await applyTransition(tx, actor, violationId, "reopened", { system: true, reason, ctx });
  });
}
