import { z } from "zod";
import type { ViolationStage } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, inScope, type Actor } from "@/lib/rbac/actor";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { OBJECTION_FROM } from "@/lib/workflow/transitions";
import { liveStatus } from "@/lib/deadlines/compute";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";
import { readSnapshot } from "./deadlines";
import { notify, recipientsFor } from "./notifications";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب");

export const objectionSchema = z.object({
  kind: z.enum(["OBJECTION", "APPEAL"]),
  submittedAt: dateKey,
  referenceNumber: z.string().trim().max(60).optional().transform((v) => v || null),
  content: z.string().trim().min(5, "مضمون الاعتراض مطلوب").max(10000),
  competentAuthority: z.string().trim().max(200).optional().transform((v) => v || null),
});

/// تعليق المدة: يُحفظ وقت التعليق، وتُضاف مدته إلى تاريخ الاستحقاق عند الاستئناف
async function suspend(tx: Tx, violationId: string, reason: string): Promise<boolean> {
  const r = await tx.deadlineCalculation.updateMany({
    where: { violationId, isCurrent: true, status: { in: ["RUNNING", "NEAR_EXPIRY", "EXTENDED"] } },
    data: { status: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason },
  });
  return r.count > 0;
}

/// استئناف مدة معلقة: يُزاح تاريخ الاستحقاق بعدد الأيام التقويمية التي بقيت فيها معلقة (ويُعد اليوم الجزئي يوماً)
async function unsuspend(tx: Tx, violationId: string, now = new Date()) {
  const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true, status: "SUSPENDED" } });
  const snap = d && readSnapshot(d);
  if (!d || !snap || !d.dueDate || !d.suspendedAt) return;
  const days = Math.max(1, Math.ceil((now.getTime() - d.suspendedAt.getTime()) / 86_400_000));
  const due = new Date(d.dueDate.getTime() + days * 86_400_000);
  const live = liveStatus(due, snap.rule.warnBeforeDays, now, snap.calendar.timezone);
  await tx.deadlineCalculation.update({
    where: { id: d.id },
    data: { dueDate: due, suspendedAt: null, status: live === "RUNNING" && d.totalExtensionDays > 0 ? "EXTENDED" : live, suspensionReason: `${d.suspensionReason ?? ""} — استؤنفت بعد ${days} يوم تعليق` },
  });
}

/// تسجيل اعتراض أو طعن. لا يوقف المدة ولا يلغي المخالفة تلقائياً، إلا إذا نصت القاعدة المعتمدة على التعليق.
export async function recordObjection(actor: Actor, violationId: string, input: z.infer<typeof objectionSchema>, files: IncomingFile[], ctx?: AuditContext): Promise<string> {
  assertCan(actor, "objection.record");
  if (new Date(`${input.submittedAt}T00:00:00Z`).getTime() > Date.now()) throw new AppError("لا يجوز أن يكون تاريخ التقديم في المستقبل");
  const stored = files.length ? await prepareFiles(files, actor, ctx) : [];
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (!(OBJECTION_FROM as readonly string[]).includes(v.stage)) throw new AppError("لا يُسجَّل اعتراض في المرحلة الحالية للمعاملة");
    if (await tx.objection.count({ where: { violationId, status: "PENDING" } })) throw new AppError("يوجد اعتراض أو طعن قيد المراجعة");
    const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true } });
    const snap = d && readSnapshot(d);
    const bySuspendRule = snap?.rule.objectionEffect === "SUSPEND";
    const suspended = bySuspendRule ? await suspend(tx, violationId, "تعليق بحكم قاعدة المدة عند تقديم الاعتراض") : false;
    const o = await tx.objection.create({
      data: { violationId, ...input, submittedAt: new Date(`${input.submittedAt}T00:00:00Z`), previousStage: v.stage, suspendedDeadline: suspended, createdById: actor.id },
    });
    if (stored.length) await insertAttachments(tx, actor, stored, { violationId, ownerType: "Objection", ownerId: o.id, documentType: "OBJECTION_DOC", approvalStatus: "APPROVED", additionReason: "مستندات الاعتراض" }, ctx);
    await writeAudit(tx, { actor, action: "objection.recorded", entityType: "Objection", entityId: o.id, after: { ...input, previousStage: v.stage, suspendedByRule: suspended }, ctx });
    await applyTransition(tx, actor, violationId, "objection_filed", { system: true, ctx });
    await notify(tx, { userIds: (await recipientsFor(tx, v, ["objection.decide"])).filter((x) => x !== actor.id), type: "objection.recorded", title: "اعتراض أو طعن جديد قيد المراجعة", body: v.number, violationId, dedupeKey: `obj:${o.id}` });
    return o.id;
  });
}

/// تعليق المدة بقرار موثق (عندما تجعل القاعدة الأثر «بقرار»)
export async function suspendForObjection(actor: Actor, objectionId: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "objection.decide");
  if (!reason.trim()) throw new AppError("يجب بيان سند قرار التعليق");
  await prisma.$transaction(async (tx) => {
    const o = await tx.objection.findUnique({ where: { id: objectionId } });
    if (!o || o.status !== "PENDING") throw new AppError("الاعتراض غير موجود أو صدر فيه قرار");
    const v = await lockViolation(tx, o.violationId);
    if (!inScope(actor, v)) throw notFound();
    const d = await tx.deadlineCalculation.findFirst({ where: { violationId: v.id, isCurrent: true } });
    const snap = d && readSnapshot(d);
    if (snap?.rule.objectionEffect !== "MANUAL_DECISION") throw new AppError("قاعدة المدة المعتمدة لا تجيز تعليق المدة بقرار");
    if (!(await suspend(tx, v.id, reason.trim()))) throw new AppError("المدة ليست سارية لتعليقها");
    await tx.objection.update({ where: { id: objectionId }, data: { suspendedDeadline: true } });
    await writeAudit(tx, { actor, action: "deadline.suspended", entityType: "Objection", entityId: objectionId, reason, ctx });
  });
}

export async function addObjectionEvent(actor: Actor, objectionId: string, input: { eventAt: string; description: string }, files: IncomingFile[], ctx?: AuditContext) {
  assertCan(actor, "objection.record");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.eventAt) || input.description.trim().length < 3) throw new AppError("تاريخ الإجراء ووصفه مطلوبان");
  const stored = files.length ? await prepareFiles(files, actor, ctx) : [];
  await prisma.$transaction(async (tx) => {
    const o = await tx.objection.findUnique({ where: { id: objectionId }, include: { violation: true } });
    if (!o || !inScope(actor, o.violation)) throw notFound();
    const e = await tx.objectionEvent.create({ data: { objectionId, eventAt: new Date(`${input.eventAt}T00:00:00Z`), description: input.description.trim(), createdById: actor.id } });
    if (stored.length) await insertAttachments(tx, actor, stored, { violationId: o.violationId, ownerType: "ObjectionEvent", ownerId: e.id, documentType: "OBJECTION_DOC", approvalStatus: "APPROVED", additionReason: "مراسلة اعتراض" }, ctx);
    await writeAudit(tx, { actor, action: "objection.event_added", entityType: "Objection", entityId: objectionId, after: input, ctx });
  });
}

export const objectionDecisionSchema = z.object({
  accepted: z.enum(["yes", "no"]).transform((v) => v === "yes"),
  outcome: z.string().trim().min(5, "النتيجة النهائية للاعتراض مطلوبة").max(5000),
  effect: z.enum(["CONTINUE", "END_FILE"]),
  effectOnFlow: z.string().trim().min(3, "بيان أثر القرار على سير المخالفة مطلوب").max(2000),
});

/// قرار الاعتراض: صاحب القرار يحدد أثره صراحة (استمرار السير أو إنهاء المسار)، ولا يُستنتج آلياً
export async function decideObjection(actor: Actor, objectionId: string, input: z.infer<typeof objectionDecisionSchema>, ctx?: AuditContext) {
  assertCan(actor, "objection.decide");
  if (input.effect === "END_FILE" && !input.accepted) throw new AppError("لا يُنهى المسار باعتراض مرفوض");
  await prisma.$transaction(async (tx) => {
    const o = await tx.objection.findUnique({ where: { id: objectionId } });
    if (!o) throw notFound();
    const v = await lockViolation(tx, o.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (o.status !== "PENDING") throw new AppError("صدر قرار في هذا الاعتراض مسبقاً");
    if (o.suspendedDeadline) await unsuspend(tx, v.id);
    await tx.objection.update({
      where: { id: objectionId },
      data: { status: input.accepted ? "APPROVED" : "REJECTED", outcome: input.outcome, effectOnFlow: input.effectOnFlow, decidedById: actor.id, decidedAt: new Date() },
    });
    await writeAudit(tx, { actor, action: input.accepted ? "objection.accepted" : "objection.rejected", entityType: "Objection", entityId: objectionId, after: input, ctx });
    if (input.effect === "END_FILE") {
      await tx.deadlineCalculation.updateMany({ where: { violationId: v.id, isCurrent: true }, data: { status: "STOPPED" } });
      await applyTransition(tx, actor, v.id, "objection_ends_file", { system: true, reason: input.effectOnFlow, ctx });
      return;
    }
    // العودة إلى المرحلة السابقة، مع مراعاة ما آلت إليه المدة خلال المراجعة
    let target: ViolationStage = o.previousStage ?? "DEADLINE_RUNNING";
    if (target === "DEADLINE_RUNNING" || target === "DEADLINE_EXPIRED") {
      const d = await tx.deadlineCalculation.findFirst({ where: { violationId: v.id, isCurrent: true } });
      target = d?.dueDate && d.dueDate.getTime() < Date.now() ? "DEADLINE_EXPIRED" : "DEADLINE_RUNNING";
    }
    await applyTransition(tx, actor, v.id, "objection_continue", { system: true, targetStage: target, reason: input.effectOnFlow, ctx });
  });
}
