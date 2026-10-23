import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { getSetting } from "@/lib/settings";
import { nextOfficialNumber } from "@/lib/numbering";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { CASE_DOC_TYPES } from "@/lib/documents";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";
import { recordApproval } from "./approvals";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب");
const optDate = z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null));
const optText = (max = 5000) => z.string().trim().max(max).optional().transform((v) => v || null);
const notFuture = (d: Date | null, label: string) => {
  if (d && d.getTime() > Date.now()) throw new AppError(`لا يجوز أن يكون ${label} في المستقبل`);
};

// ─── عدم الاستجابة ───

/// بدء إجراء عدم الاستجابة: يتحقق الموظف المخول من الملف ويثبت عدم الاستجابة (لا تحويل تلقائي)
export async function initiateNonResponse(actor: Actor, violationId: string, proof: string, expectedVersion: number, ctx?: AuditContext) {
  if (proof.trim().length < 10) throw new AppError("يجب بيان إثبات عدم الاستجابة وما تحقق منه الموظف (10 أحرف على الأقل)");
  return prisma.$transaction((tx) => applyTransition(tx, actor, violationId, "nonresponse_initiate", { reason: proof, expectedVersion, ctx }));
}

/// قرار اعتماد عدم الاستجابة. عند الاعتماد يُنشأ ملف دعوى جزائية مستقل مرتبط بالمخالفة، مع بقاء كل مراحلها السابقة.
export async function decideNonResponse(actor: Actor, violationId: string, approve: boolean, notes: string | null, expectedVersion: number, ctx?: AuditContext): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    if (!approve) {
      await applyTransition(tx, actor, violationId, "nonresponse_return", { reason: notes, expectedVersion, ctx });
      await recordApproval(tx, actor, violationId, "NON_RESPONSE", "RETURNED", notes);
      return null;
    }
    const before = await lockViolation(tx, violationId);
    const initiation = await tx.violationStatusHistory.findFirst({ where: { violationId, action: "nonresponse_initiate" }, orderBy: { createdAt: "desc" } });
    if (initiation?.actorId === actor.id) throw forbidden("لا يعتمد عدم الاستجابة من بدأ إجراءه");
    const v = await applyTransition(tx, actor, violationId, "nonresponse_approve", { reason: notes, expectedVersion, ctx });
    await recordApproval(tx, actor, violationId, "NON_RESPONSE", "APPROVED", notes);
    const warning = await tx.warning.findFirst({ where: { violationId, status: "DELIVERED" }, orderBy: { preparedAt: "desc" } });
    const office = await tx.office.findUniqueOrThrow({ where: { id: before.officeId }, include: { governorate: true } });
    const number = await nextOfficialNumber(tx, "criminalCase", { governorateCode: office.governorate.code, officeCode: office.code });
    const c = await tx.criminalCase.create({
      data: { number, violationId, warningId: warning?.id ?? null, nonResponseProof: initiation?.reason ?? "—", status: "PREPARING", createdById: actor.id },
    });
    await writeAudit(tx, { actor, action: "criminal_case.opened", entityType: "CriminalCase", entityId: c.id, after: { number, violationId: v.id, warningId: warning?.id }, ctx });
    return c.id;
  });
}

// ─── ملف الدعوى ───

async function loadCase(tx: Tx, actor: Actor, caseId: string, perm: "criminal.manage" | "judgment.record" | "judgment.approve" | "criminal.view") {
  assertCan(actor, perm);
  const c = await tx.criminalCase.findUnique({ where: { id: caseId } });
  if (!c) throw notFound();
  const v = await lockViolation(tx, c.violationId);
  if (!inScope(actor, v)) throw notFound();
  return { c, v };
}

export const caseUpdateSchema = z.object({
  courtCaseNumber: optText(80),
  courtName: optText(200),
  courtRegisteredAt: optDate,
  lastAction: optText(2000),
  followUpOwnerId: z.string().optional().transform((v) => v || null),
  notes: optText(),
});

export async function updateCase(actor: Actor, caseId: string, input: z.infer<typeof caseUpdateSchema>, ctx?: AuditContext) {
  notFuture(input.courtRegisteredAt, "تاريخ تسجيل الدعوى");
  await prisma.$transaction(async (tx) => {
    const { c } = await loadCase(tx, actor, caseId, "criminal.manage");
    if (c.status === "CLOSED") throw new AppError("ملف الدعوى مغلق");
    if (input.followUpOwnerId && !(await tx.user.findFirst({ where: { id: input.followUpOwnerId, isActive: true } }))) throw new AppError("المسؤول عن المتابعة غير موجود");
    const before = { courtCaseNumber: c.courtCaseNumber, courtName: c.courtName, courtRegisteredAt: c.courtRegisteredAt, lastAction: c.lastAction, followUpOwnerId: c.followUpOwnerId, notes: c.notes };
    await tx.criminalCase.update({ where: { id: caseId }, data: { ...input, ...(input.courtCaseNumber && c.status === "REFERRED" ? { status: "IN_COURT" } : {}) } });
    await writeAudit(tx, { actor, action: "criminal_case.updated", entityType: "CriminalCase", entityId: caseId, before, after: input, ctx });
  });
}

export const caseDocSchema = z.object({
  documentType: z.enum(Object.keys(CASE_DOC_TYPES) as [keyof typeof CASE_DOC_TYPES, ...(keyof typeof CASE_DOC_TYPES)[]]),
  letterNumber: optText(60),
  letterDate: optDate,
  description: optText(500),
});

/// أرشفة مستندات الدعوى: لكل مستند نوع وتاريخ ورقم ورافع ووقت رفع، مع إصداراته (عبر خدمة المرفقات)
export async function uploadCaseDocuments(actor: Actor, caseId: string, meta: z.infer<typeof caseDocSchema>, files: IncomingFile[], ctx?: AuditContext): Promise<string[]> {
  assertCan(actor, "criminal.manage");
  const stored = await prepareFiles(files, actor, ctx);
  return prisma.$transaction(async (tx) => {
    const { c, v } = await loadCase(tx, actor, caseId, "criminal.manage");
    return insertAttachments(tx, actor, stored, { violationId: v.id, ownerType: "CriminalCase", ownerId: c.id, ...meta, approvalStatus: "APPROVED", additionReason: "مستند ملف الدعوى" }, ctx);
  });
}

/// تسجيل الإحالة: تتطلب كتاب الإحالة، وتنقل المعاملة إلى «بانتظار الحكم أو استكمال مستندات الدعوى»
export async function recordReferral(actor: Actor, caseId: string, input: { referralAt: string; letterNumber: string | null }, file: IncomingFile | undefined, ctx?: AuditContext) {
  assertCan(actor, "criminal.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.referralAt)) throw new AppError("تاريخ الإحالة مطلوب");
  const referralAt = new Date(`${input.referralAt}T00:00:00Z`);
  notFuture(referralAt, "تاريخ الإحالة");
  if (!file) throw new AppError("يجب إرفاق مستند الإحالة");
  const stored = await prepareFiles([file], actor, ctx);
  await prisma.$transaction(async (tx) => {
    const { c, v } = await loadCase(tx, actor, caseId, "criminal.manage");
    if (c.status !== "PREPARING") throw new AppError("سُجِّلت الإحالة مسبقاً");
    await insertAttachments(tx, actor, stored, { violationId: v.id, ownerType: "CriminalCase", ownerId: c.id, documentType: "REFERRAL_LETTER", letterNumber: input.letterNumber, letterDate: referralAt, approvalStatus: "APPROVED", additionReason: "مستند الإحالة" }, ctx);
    await tx.criminalCase.update({ where: { id: caseId }, data: { referralAt, status: "REFERRED", lastAction: "إحالة الدعوى" } });
    await writeAudit(tx, { actor, action: "criminal_case.referred", entityType: "CriminalCase", entityId: caseId, after: input, ctx });
    await applyTransition(tx, actor, v.id, "case_referred", { system: true, ctx });
  });
}

export const caseEventSchema = z.object({
  eventType: z.string().trim().min(2, "نوع الإجراء مطلوب").max(100),
  eventAt: dateKey,
  description: z.string().trim().min(3, "وصف الإجراء مطلوب").max(5000),
  nextHearingAt: optDate,
});

export async function addCaseEvent(actor: Actor, caseId: string, input: z.infer<typeof caseEventSchema>, ctx?: AuditContext) {
  const eventAt = new Date(`${input.eventAt}T00:00:00Z`);
  notFuture(eventAt, "تاريخ الإجراء");
  await prisma.$transaction(async (tx) => {
    const { c } = await loadCase(tx, actor, caseId, "criminal.manage");
    if (c.status === "CLOSED") throw new AppError("ملف الدعوى مغلق");
    const e = await tx.criminalCaseEvent.create({ data: { caseId, eventType: input.eventType, eventAt, description: input.description, nextHearingAt: input.nextHearingAt, createdById: actor.id } });
    await tx.criminalCase.update({ where: { id: caseId }, data: { lastAction: `${input.eventType}: ${input.description}`.slice(0, 2000), ...(c.status === "REFERRED" ? { status: "IN_COURT" } : {}) } });
    await writeAudit(tx, { actor, action: "criminal_case.event_added", entityType: "CriminalCase", entityId: caseId, after: { eventId: e.id, ...input }, ctx });
  });
}

// ─── الحكم القضائي ───

export const judgmentSchema = z.object({
  number: z.string().trim().min(1, "رقم الحكم مطلوب").max(80),
  judgmentDate: dateKey,
  courtName: z.string().trim().min(2, "اسم المحكمة مطلوب").max(200),
  summary: z.string().trim().min(5, "منطوق الحكم أو ملخصه الرسمي مطلوب").max(10000),
  resultTypeId: z.string().optional().transform((v) => v || null),
  copyReceivedAt: optDate,
  proceduralStatus: z.enum(["UNKNOWN", "NOT_FINAL", "APPEALED", "FINAL"]),
  appealNote: optText(),
  legalNotes: optText(),
});

/// تسجيل الحكم: نسخة الحكم إلزامية؛ ولا يُفترض أن الحكم نهائي ولا تُستنتج نتيجته من اسم الملف
export async function recordJudgment(actor: Actor, caseId: string, input: z.infer<typeof judgmentSchema>, copy: IncomingFile | undefined, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "judgment.record");
  if (!copy) throw new AppError("يجب إرفاق نسخة ضوئية من الحكم");
  const judgmentDate = new Date(`${input.judgmentDate}T00:00:00Z`);
  notFuture(judgmentDate, "تاريخ الحكم");
  notFuture(input.copyReceivedAt, "تاريخ استلام نسخة الحكم");
  const stored = await prepareFiles([copy], actor, ctx);
  const requireApproval = await getSetting(prisma, "workflow.requireJudgmentApproval");
  return prisma.$transaction(async (tx) => {
    const { c, v } = await loadCase(tx, actor, caseId, "judgment.record");
    if (v.stage !== "AWAITING_JUDGMENT") throw new AppError("الدعوى ليست في مرحلة انتظار الحكم (يجب تسجيل الإحالة أولاً)");
    if (input.resultTypeId && !(await tx.judgmentResultType.findFirst({ where: { id: input.resultTypeId, isActive: true } }))) throw new AppError("تصنيف نتيجة الحكم غير موجود");
    const [attId] = await insertAttachments(tx, actor, stored, { violationId: v.id, ownerType: "CriminalCase", ownerId: c.id, documentType: "JUDGMENT_COPY", letterNumber: input.number, letterDate: judgmentDate, approvalStatus: "APPROVED", additionReason: "نسخة الحكم" }, ctx);
    const j = await tx.courtJudgment.create({ data: { caseId, ...input, judgmentDate, attachmentId: attId, enteredById: actor.id } });
    await tx.criminalCase.update({ where: { id: caseId }, data: { status: "JUDGMENT_ISSUED", lastAction: `صدور الحكم ${input.number}` } });
    await writeAudit(tx, { actor, action: "judgment.recorded", entityType: "CourtJudgment", entityId: j.id, after: input, ctx });
    if (!requireApproval) await approveJudgmentTx(tx, actor, j.id, v.id, ctx);
    return j.id;
  });
}

async function approveJudgmentTx(tx: Tx, actor: Actor, judgmentId: string, violationId: string, ctx?: AuditContext) {
  await tx.courtJudgment.update({ where: { id: judgmentId }, data: { approvedById: actor.id, approvedAt: new Date() } });
  await recordApproval(tx, actor, violationId, "JUDGMENT_APPROVAL", "APPROVED", null, { type: "CourtJudgment", id: judgmentId });
  await applyTransition(tx, actor, violationId, "judgment_approved", { system: true, ctx });
}

/// اعتماد بيانات الحكم (عند اشتراطه): من غير مدخلها
export async function approveJudgment(actor: Actor, judgmentId: string, ctx?: AuditContext) {
  assertCan(actor, "judgment.approve");
  await prisma.$transaction(async (tx) => {
    const j = await tx.courtJudgment.findUnique({ where: { id: judgmentId } });
    if (!j) throw notFound();
    const { v } = await loadCase(tx, actor, j.caseId, "judgment.approve");
    if (j.approvedById) throw new AppError("الحكم معتمد مسبقاً");
    if (j.enteredById === actor.id) throw forbidden("لا يعتمد بيانات الحكم مدخلها");
    if (v.stage !== "AWAITING_JUDGMENT") throw new AppError("المعاملة ليست بانتظار الحكم", "CONFLICT");
    await approveJudgmentTx(tx, actor, judgmentId, v.id, ctx);
    await writeAudit(tx, { actor, action: "judgment.approved", entityType: "CourtJudgment", entityId: judgmentId, ctx });
  });
}

/// تحديث الحالة الإجرائية للحكم (طعن، اكتساب الدرجة القطعية…). الطعن بعد الاعتماد يعيد الدعوى للمتابعة.
export async function updateJudgmentStatus(actor: Actor, judgmentId: string, status: "UNKNOWN" | "NOT_FINAL" | "APPEALED" | "FINAL", note: string, ctx?: AuditContext) {
  assertCan(actor, "judgment.record");
  if (!note.trim()) throw new AppError("يجب بيان سند تغيير الحالة الإجرائية");
  await prisma.$transaction(async (tx) => {
    const j = await tx.courtJudgment.findUnique({ where: { id: judgmentId } });
    if (!j) throw notFound();
    const { v } = await loadCase(tx, actor, j.caseId, "judgment.record");
    if (v.generalStatus === "CLOSED") throw new AppError("المخالفة مغلقة؛ يلزم إعادة فتحها أولاً");
    await tx.courtJudgment.update({ where: { id: judgmentId }, data: { proceduralStatus: status, appealNote: [j.appealNote, note.trim()].filter(Boolean).join(" — ") } });
    await writeAudit(tx, { actor, action: "judgment.status_changed", entityType: "CourtJudgment", entityId: judgmentId, before: { proceduralStatus: j.proceduralStatus }, after: { proceduralStatus: status }, reason: note, ctx });
    if (status === "APPEALED" && v.stage === "AWAITING_FINAL_VERIFICATION") {
      await tx.criminalCase.update({ where: { id: j.caseId }, data: { status: "IN_COURT", lastAction: `طعن في الحكم ${j.number}` } });
      await applyTransition(tx, actor, v.id, "judgment_reopened", { system: true, reason: note, ctx });
    }
  });
}

export async function getCaseForActor(actor: Actor, caseId: string) {
  if (!can(actor, "criminal.view") && !can(actor, "criminal.manage")) throw notFound();
  const c = await prisma.criminalCase.findUnique({
    where: { id: caseId },
    include: {
      violation: { include: { office: { include: { governorate: true } }, violationType: true } },
      followUpOwner: { select: { id: true, fullName: true } },
      events: { orderBy: { eventAt: "desc" } },
      judgments: { orderBy: { judgmentDate: "desc" }, include: { resultType: true } },
    },
  });
  if (!c || !inScope(actor, c.violation)) throw notFound();
  return c;
}
