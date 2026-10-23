import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, inScope, type Actor } from "@/lib/rbac/actor";
import { DEFAULT_TZ, localDateKey, zonedDateTimeToUtc } from "@/lib/datetime";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";
import { recomputeCurrent, startDeadline } from "./deadlines";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب");
const timeOpt = z
  .string()
  .optional()
  .transform((v) => (v && /^\d{2}:\d{2}$/.test(v) ? v : "00:00"));

/// تاريخ ووقت محليان (بتوقيت المنطقة المعتمدة) إلى لحظة UTC، مع منع المستقبل
function localInstant(date: string, time: string, label: string): Date {
  const d = zonedDateTimeToUtc(date, time, DEFAULT_TZ);
  if (d.getTime() > Date.now() + 60_000) throw new AppError(`لا يجوز أن يكون ${label} في المستقبل`);
  return d;
}

export const dispatchSchema = z.object({
  sentAt: dateKey,
  method: z.enum(["HAND", "REGISTERED_MAIL", "OFFICIAL_COURIER", "EMAIL", "OTHER"]),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

/// تسجيل إرسال الإنذار الموقع للتبليغ. تاريخ الإرسال مستقل عن تاريخ الإصدار وتاريخ الاستلام.
export async function recordDispatch(actor: Actor, warningId: string, input: z.infer<typeof dispatchSchema>, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "delivery.record");
  return prisma.$transaction(async (tx) => {
    const w = await tx.warning.findUnique({ where: { id: warningId } });
    if (!w) throw notFound();
    const v = await lockViolation(tx, w.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (w.status !== "SIGNED") throw new AppError("لا يُرسل إلا الإنذار الموقع");
    const sentAt = localInstant(input.sentAt, "00:00", "تاريخ الإرسال");
    if (w.signedAt && input.sentAt < localDateKey(w.signedAt, "UTC")) throw new AppError("لا يجوز أن يسبق تاريخ الإرسال تاريخ التوقيع");
    const d = await tx.deliveryRecord.create({ data: { warningId, sentAt, method: input.method, notes: input.notes, recordedById: actor.id } });
    await tx.warning.update({ where: { id: warningId }, data: { status: "SENT" } });
    await writeAudit(tx, { actor, action: "delivery.dispatched", entityType: "DeliveryRecord", entityId: d.id, after: input, ctx });
    await applyTransition(tx, actor, v.id, "warning_sent", { ctx });
    return d.id;
  });
}

export const receiptSchema = z.object({
  receivedDate: dateKey,
  receivedTime: timeOpt,
  recipientName: z.string().trim().min(3, "اسم المستلم مطلوب").max(150),
  recipientCapacity: z.string().trim().max(150).optional().transform((v) => v || null),
  receiptNumber: z.string().trim().min(1, "رقم وصل الاستلام مطلوب").max(60),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

/// تسجيل الاستلام الفعلي بإثباته (صورة الوصل إلزامية). بهذا وحده يبدأ احتساب المدة القانونية.
export async function recordReceipt(actor: Actor, deliveryId: string, input: z.infer<typeof receiptSchema>, receipt: IncomingFile | undefined, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "delivery.record");
  if (!receipt) throw new AppError("يجب رفع صورة ضوئية من وصل الاستلام لإثبات التبليغ");
  const d0 = await prisma.deliveryRecord.findUnique({ where: { id: deliveryId }, include: { warning: { include: { violation: true } } } });
  if (!d0 || !inScope(actor, d0.warning.violation)) throw notFound();
  const receivedAt = localInstant(input.receivedDate, input.receivedTime, "تاريخ الاستلام");
  if (d0.sentAt && receivedAt.getTime() < d0.sentAt.getTime()) throw new AppError("لا يجوز أن يسبق تاريخ الاستلام تاريخ الإرسال");
  const stored = await prepareFiles([receipt], actor, ctx);
  await prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, d0.warning.violationId);
    const d = await tx.deliveryRecord.findUniqueOrThrow({ where: { id: deliveryId } });
    if (d.receivedAt) throw new AppError("سُجِّل الاستلام مسبقاً؛ استخدم تصحيح تاريخ الاستلام إن لزم");
    const [attId] = await insertAttachments(tx, actor, stored, {
      violationId: v.id, ownerType: "DeliveryRecord", ownerId: deliveryId, documentType: "RECEIPT",
      letterNumber: input.receiptNumber, description: `وصل استلام الإنذار ${d0.warning.number}`, approvalStatus: "APPROVED",
    }, ctx);
    await tx.deliveryRecord.update({
      where: { id: deliveryId },
      data: { receivedAt, recipientName: input.recipientName, recipientCapacity: input.recipientCapacity, receiptNumber: input.receiptNumber, receiptAttachmentId: attId, notes: input.notes ?? d.notes },
    });
    await tx.warning.update({ where: { id: d.warningId }, data: { status: "DELIVERED" } });
    await writeAudit(tx, { actor, action: "delivery.receipt_recorded", entityType: "DeliveryRecord", entityId: deliveryId, after: { ...input, receivedAt: receivedAt.toISOString() }, ctx });
    await startDeadline(tx, v, d.warningId, receivedAt);
    await applyTransition(tx, actor, v.id, "receipt_recorded", { system: true, ctx });
  });
}

/// تصحيح تاريخ الاستلام: تُحفظ القيمة السابقة والجديدة والسبب وهوية المعتمد، ويُعاد احتساب المدة بقاعدتها المحفوظة
export async function correctReceipt(actor: Actor, deliveryId: string, input: { receivedDate: string; receivedTime?: string; reason: string }, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "delivery.correct_receipt");
  if (!input.reason?.trim()) throw new AppError("يجب بيان سبب التصحيح");
  const newAt = localInstant(input.receivedDate, input.receivedTime && /^\d{2}:\d{2}$/.test(input.receivedTime) ? input.receivedTime : "00:00", "تاريخ الاستلام");
  await prisma.$transaction(async (tx) => {
    const d = await tx.deliveryRecord.findUnique({ where: { id: deliveryId }, include: { warning: true } });
    if (!d) throw notFound();
    const v = await lockViolation(tx, d.warning.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (!d.receivedAt) throw new AppError("لم يُسجَّل الاستلام بعد");
    if (d.sentAt && newAt.getTime() < d.sentAt.getTime()) throw new AppError("لا يجوز أن يسبق تاريخ الاستلام تاريخ الإرسال");
    if (newAt.getTime() === d.receivedAt.getTime()) throw new AppError("التاريخ الجديد مطابق للحالي");
    await tx.receiptCorrection.create({ data: { deliveryRecordId: deliveryId, oldReceivedAt: d.receivedAt, newReceivedAt: newAt, reason: input.reason.trim(), approvedById: actor.id } });
    await tx.deliveryRecord.update({ where: { id: deliveryId }, data: { receivedAt: newAt } });
    const dl = await recomputeCurrent(tx, v.id, newAt);
    await writeAudit(tx, {
      actor, action: "delivery.receipt_corrected", entityType: "DeliveryRecord", entityId: deliveryId,
      before: { receivedAt: d.receivedAt.toISOString() }, after: { receivedAt: newAt.toISOString(), newDueDate: dl?.dueDate?.toISOString() ?? null }, reason: input.reason, ctx,
    });
    // إن أعاد التصحيح المدة للسريان بعد انتهائها
    if (dl?.dueDate && dl.dueDate.getTime() > Date.now() && v.stage === "DEADLINE_EXPIRED") {
      await applyTransition(tx, actor, v.id, "deadline_reopened", { system: true, reason: input.reason, ctx });
    }
  });
}
