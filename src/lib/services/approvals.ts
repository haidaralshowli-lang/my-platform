import { z } from "zod";
import type { ApprovalDecision, ApprovalKind, Violation } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { getSetting } from "@/lib/settings";
import { applyTransition, lockViolation } from "@/lib/workflow";

export async function recordApproval(tx: Tx, actor: Actor, violationId: string, kind: ApprovalKind, decision: ApprovalDecision, notes: string | null, target?: { type: string; id: string }) {
  return tx.approval.create({
    data: { violationId, kind, decision, notes: notes?.trim() || null, decidedById: actor.id, decidedRole: actor.roles, targetType: target?.type, targetId: target?.id },
  });
}

const DECISION_TRANSITIONS = {
  final: { kind: "FINAL_REGISTRATION", APPROVED: "final_approve", RETURNED: "final_return", REJECTED: "final_reject" },
  warning_issue: { kind: "WARNING_ISSUE", APPROVED: "warning_approve", RETURNED: "warning_return", REJECTED: "warning_reject" },
} as const;

/// قرار رئيس الهيئة: المصادقة النهائية أو الموافقة على إصدار الإنذار
export async function decide(actor: Actor, violationId: string, gate: keyof typeof DECISION_TRANSITIONS, decision: "APPROVED" | "RETURNED" | "REJECTED", notes: string | null, expectedVersion: number, ctx?: AuditContext): Promise<Violation> {
  const map = DECISION_TRANSITIONS[gate];
  return prisma.$transaction(async (tx) => {
    const v = await applyTransition(tx, actor, violationId, map[decision], { reason: notes, expectedVersion, ctx });
    await recordApproval(tx, actor, violationId, map.kind, decision, notes);
    return v;
  });
}

// ─── الموقف الفني ───

export const technicalSchema = z.object({
  position: z.string().trim().min(5, "الموقف الفني مطلوب").max(10000),
  reasons: z.string().trim().min(5, "أسباب الموقف الفني مطلوبة").max(10000),
  evidence: z.string().trim().max(10000).optional().transform((v) => v || null),
  recommendation: z.string().trim().max(5000).optional().transform((v) => v || null),
});

async function lockInScope(tx: Tx, actor: Actor, violationId: string, stage: Violation["stage"]) {
  const v = await lockViolation(tx, violationId);
  if (!inScope(actor, v)) throw notFound();
  if (v.stage !== stage) throw new AppError("المعاملة ليست في المرحلة المطلوبة لهذا الإجراء", "CONFLICT");
  return v;
}

/// حفظ مسودة الموقف الفني (تُنشأ مسودة جديدة إذا كانت الأخيرة معادة أو معتمدة، فيبقى السجل السابق)
export async function saveTechnical(actor: Actor, violationId: string, input: z.infer<typeof technicalSchema>, ctx?: AuditContext) {
  assertCan(actor, "technical.prepare");
  return prisma.$transaction(async (tx) => {
    await lockInScope(tx, actor, violationId, "AWAITING_TECHNICAL");
    const last = await tx.technicalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (last?.status === "SUBMITTED") throw new AppError("الموقف الفني مقدم للمراجعة ولا يعدل إلا بعد إعادته");
    const row = last?.status === "DRAFT"
      ? await tx.technicalAssessment.update({ where: { id: last.id }, data: { ...input, preparedById: actor.id } })
      : await tx.technicalAssessment.create({ data: { violationId, ...input, preparedById: actor.id } });
    await writeAudit(tx, { actor, action: "technical.saved", entityType: "TechnicalAssessment", entityId: row.id, after: input, ctx });
    return row.id;
  });
}

/// تقديم الموقف الفني: إن اشترطت الإعدادات مراجعة فنية يبقى بانتظار المراجع، وإلا يُعتمد وتنتقل المعاملة للدائرة القانونية
export async function submitTechnical(actor: Actor, violationId: string, ctx?: AuditContext) {
  assertCan(actor, "technical.prepare");
  const requireReview = await getSetting(prisma, "workflow.requireTechnicalReview");
  return prisma.$transaction(async (tx) => {
    await lockInScope(tx, actor, violationId, "AWAITING_TECHNICAL");
    const a = await tx.technicalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (!a || a.status !== "DRAFT") throw new AppError("لا توجد مسودة موقف فني لتقديمها");
    const refs = await tx.violationLegalReference.count({ where: { violationId, purpose: "TECHNICAL" } });
    if (refs === 0) throw new AppError("يجب ربط مادة واحدة على الأقل من المكتبة القانونية سنداً للموقف الفني");
    if (requireReview) {
      await tx.technicalAssessment.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
      await writeAudit(tx, { actor, action: "technical.submitted_for_review", entityType: "TechnicalAssessment", entityId: a.id, ctx });
      return "SUBMITTED" as const;
    }
    await tx.technicalAssessment.update({ where: { id: a.id }, data: { status: "APPROVED", completedAt: new Date() } });
    await writeAudit(tx, { actor, action: "technical.completed", entityType: "TechnicalAssessment", entityId: a.id, ctx });
    await applyTransition(tx, actor, violationId, "technical_complete", { system: true, ctx });
    return "APPROVED" as const;
  });
}

/// مراجعة الموقف الفني ومصادقته (عند اشتراطها): المراجع يجب أن يختلف عن المعد
export async function reviewTechnical(actor: Actor, violationId: string, decision: "APPROVED" | "RETURNED", notes: string | null, ctx?: AuditContext) {
  assertCan(actor, "technical.review");
  if (decision === "RETURNED" && !notes?.trim()) throw new AppError("يجب بيان سبب الإعادة");
  return prisma.$transaction(async (tx) => {
    await lockInScope(tx, actor, violationId, "AWAITING_TECHNICAL");
    const a = await tx.technicalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (!a || a.status !== "SUBMITTED") throw new AppError("لا يوجد موقف فني مقدم للمراجعة");
    if (a.preparedById === actor.id) throw forbidden("لا يجوز لمعد الموقف الفني أن يصادق عليه بنفسه");
    await tx.technicalAssessment.update({
      where: { id: a.id },
      data: { status: decision, reviewedById: actor.id, reviewedAt: new Date(), ...(decision === "APPROVED" ? { completedAt: new Date() } : {}) },
    });
    await recordApproval(tx, actor, violationId, "TECHNICAL_REVIEW", decision, notes, { type: "TechnicalAssessment", id: a.id });
    await writeAudit(tx, { actor, action: `technical.review_${decision.toLowerCase()}`, entityType: "TechnicalAssessment", entityId: a.id, reason: notes, ctx });
    if (decision === "APPROVED") await applyTransition(tx, actor, violationId, "technical_complete", { system: true, ctx });
  });
}

// ─── الرأي القانوني ───

export const legalSchema = z.object({
  opinion: z.string().trim().min(5, "الرأي القانوني مطلوب").max(10000),
  reasons: z.string().trim().min(5, "أسباب الرأي مطلوبة").max(10000),
  proposedAction: z.string().trim().max(5000).optional().transform((v) => v || null),
  notes: z.string().trim().max(5000).optional().transform((v) => v || null),
});

export async function saveLegal(actor: Actor, violationId: string, input: z.infer<typeof legalSchema>, ctx?: AuditContext) {
  assertCan(actor, "legal.prepare");
  return prisma.$transaction(async (tx) => {
    await lockInScope(tx, actor, violationId, "AWAITING_LEGAL");
    const last = await tx.legalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (last?.status === "SUBMITTED") throw new AppError("الرأي القانوني مقدم للمصادقة ولا يعدل إلا بعد إعادته");
    const row = last?.status === "DRAFT"
      ? await tx.legalAssessment.update({ where: { id: last.id }, data: { ...input, preparedById: actor.id } })
      : await tx.legalAssessment.create({ data: { violationId, ...input, preparedById: actor.id } });
    await writeAudit(tx, { actor, action: "legal.saved", entityType: "LegalAssessment", entityId: row.id, after: input, ctx });
    return row.id;
  });
}

export async function submitLegal(actor: Actor, violationId: string, ctx?: AuditContext) {
  assertCan(actor, "legal.prepare");
  await prisma.$transaction(async (tx) => {
    await lockInScope(tx, actor, violationId, "AWAITING_LEGAL");
    const a = await tx.legalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (!a || a.status !== "DRAFT") throw new AppError("لا توجد مسودة رأي قانوني لتقديمها");
    await tx.legalAssessment.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
    await writeAudit(tx, { actor, action: "legal.submitted", entityType: "LegalAssessment", entityId: a.id, ctx });
  });
}

/// قرار الدائرة القانونية على الرأي المقدم
export async function decideLegal(actor: Actor, violationId: string, decision: "APPROVED" | "RETURNED" | "REJECTED" | "CLARIFICATION_REQUESTED", notes: string | null, expectedVersion: number, ctx?: AuditContext) {
  assertCan(actor, "legal.approve");
  const second = await getSetting(prisma, "workflow.requireLegalSecondApproval");
  const action = { APPROVED: "legal_approve", RETURNED: "legal_return", REJECTED: "legal_reject", CLARIFICATION_REQUESTED: "legal_clarify" }[decision];
  return prisma.$transaction(async (tx) => {
    const a = await tx.legalAssessment.findFirst({ where: { violationId }, orderBy: { createdAt: "desc" } });
    if (!a || a.status !== "SUBMITTED") throw new AppError("لا يوجد رأي قانوني مقدم للقرار");
    if (second && a.preparedById === actor.id) throw forbidden("الإعدادات تشترط أن يصادق على الرأي القانوني شخص غير معده");
    const v = await applyTransition(tx, actor, violationId, action, { reason: notes, expectedVersion, ctx });
    await tx.legalAssessment.update({
      where: { id: a.id },
      data: decision === "APPROVED" ? { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), completedAt: new Date() } : { status: "RETURNED" },
    });
    // طلب الإيضاح يعيد الموقف الفني للقسم الفني لاستكماله
    if (decision === "CLARIFICATION_REQUESTED") {
      const t = await tx.technicalAssessment.findFirst({ where: { violationId, status: "APPROVED" }, orderBy: { createdAt: "desc" } });
      if (t) await tx.technicalAssessment.update({ where: { id: t.id }, data: { status: "RETURNED" } });
    }
    await recordApproval(tx, actor, violationId, "LEGAL_APPROVAL", decision, notes, { type: "LegalAssessment", id: a.id });
    return v;
  });
}

export function canDecide(actor: Actor, v: Violation): { final: boolean; warningIssue: boolean; legal: boolean } {
  return {
    final: v.stage === "AWAITING_FINAL_APPROVAL" && can(actor, "approval.final_registration") && inScope(actor, v),
    warningIssue: v.stage === "AWAITING_WARNING_APPROVAL" && can(actor, "warning.approve_issue") && inScope(actor, v),
    legal: v.stage === "AWAITING_LEGAL" && can(actor, "legal.approve") && inScope(actor, v),
  };
}
