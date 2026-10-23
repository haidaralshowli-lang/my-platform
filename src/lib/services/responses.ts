import { z } from "zod";
import { Prisma, type ResponseKind, type Violation, type ViolationOutcome } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { applyTransition, lockViolation } from "@/lib/workflow";
import { liveStatus } from "@/lib/deadlines/compute";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";
import { readSnapshot } from "./deadlines";
import { recordApproval } from "./approvals";
import { notify, recipientsFor } from "./notifications";

const Decimal = Prisma.Decimal;
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ مطلوب");
const optDate = z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null));
const optText = (max = 5000) => z.string().trim().max(max).optional().transform((v) => v || null);
const money = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,2})?$/, "مبلغ غير صحيح (رقم بخانتين عشريتين كحد أقصى)");

export const RESPONSE_STAGES = ["DEADLINE_RUNNING", "DEADLINE_EXPIRED", "AWAITING_RESPONSE_RECORD", "AWAITING_RESPONSE_VERIFICATION"] as const;

export const responseBaseSchema = z.object({
  receivedAt: dateKey,
  letterNumber: optText(60),
  letterDate: optDate,
  summary: z.string().trim().min(5, "مضمون الاستجابة مطلوب").max(5000),
});

export const financialSchema = z.object({
  financialType: z.string().trim().min(2, "نوع الاستجابة المالية مطلوب").max(150),
  transactionNumber: optText(60),
  amountDue: z.string().trim().optional().transform((v) => v || null).pipe(money.nullable()),
  amountDueBasis: optText(1000),
  officerName: optText(150),
}).refine((d) => !d.amountDue || !!d.amountDueBasis, { message: "يجب بيان السند المعتمد للمبلغ المستحق", path: ["amountDueBasis"] });

export const technicalResponseSchema = z.object({
  correctiveAction: z.string().trim().min(5, "وصف الإجراء التصحيحي مطلوب").max(5000),
  implementedAt: optDate,
  inspectionReport: optText(),
  recommendation: optText(),
});

export const legalResponseSchema = z.object({
  legalType: z.string().trim().min(2, "نوع الاستجابة القانونية مطلوب").max(150),
  content: z.string().trim().min(5, "مضمون الاستجابة القانونية مطلوب").max(10000),
  proposedAction: optText(),
});

const KIND_PERM = { FINANCIAL: "financial.record", TECHNICAL: "response.record", LEGAL: "response.record" } as const;
const KIND_OUTCOME: Record<ResponseKind, ViolationOutcome> = { FINANCIAL: "FINANCIAL_RESPONSE", TECHNICAL: "TECHNICAL_RESPONSE", LEGAL: "LEGAL_RESPONSE" };
const KIND_VERIFIERS = { FINANCIAL: ["financial.record"], TECHNICAL: ["response.technical_verify"], LEGAL: ["response.legal_decide"] } as const;

/// إيقاف احتساب المدة بتسجيل استجابة (يُستأنف إن تقرر عدم كفايتها)
async function stopDeadline(tx: Tx, violationId: string) {
  await tx.deadlineCalculation.updateMany({
    where: { violationId, isCurrent: true, status: { in: ["RUNNING", "NEAR_EXPIRY", "EXTENDED", "EXPIRED"] } },
    data: { status: "STOPPED" },
  });
}

/// استئناف المدة: تعود حالتها وفق تاريخ استحقاقها، وتُعاد المرحلة إلى «سارية» أو «منتهية»
export async function resumeDeadline(tx: Tx, violationId: string, now = new Date()): Promise<"DEADLINE_RUNNING" | "DEADLINE_EXPIRED"> {
  const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true } });
  const snap = d && readSnapshot(d);
  if (!d || !snap || !d.dueDate) return "DEADLINE_RUNNING";
  const live = liveStatus(d.dueDate, snap.rule.warnBeforeDays, now, snap.calendar.timezone);
  if (d.status === "STOPPED" || d.status === "SUSPENDED") {
    await tx.deadlineCalculation.update({ where: { id: d.id }, data: { status: live === "RUNNING" && d.totalExtensionDays > 0 ? "EXTENDED" : live, suspendedAt: null } });
  }
  return live === "EXPIRED" ? "DEADLINE_EXPIRED" : "DEADLINE_RUNNING";
}

type Specific = { kind: "FINANCIAL"; data: z.infer<typeof financialSchema> } | { kind: "TECHNICAL"; data: z.infer<typeof technicalResponseSchema> } | { kind: "LEGAL"; data: z.infer<typeof legalResponseSchema> };

/// تسجيل استجابة من الجهة المخالفة. يجوز تعدد الاستجابات للملف نفسه، ولكل منها تاريخها ونتيجتها.
export async function recordResponse(actor: Actor, violationId: string, base: z.infer<typeof responseBaseSchema>, sp: Specific, files: IncomingFile[], ctx?: AuditContext): Promise<string> {
  assertCan(actor, KIND_PERM[sp.kind]);
  const receivedAt = new Date(`${base.receivedAt}T00:00:00Z`);
  if (receivedAt.getTime() > Date.now()) throw new AppError("لا يجوز أن يكون تاريخ ورود الاستجابة في المستقبل");
  const stored = files.length ? await prepareFiles(files, actor, ctx) : [];
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (!(RESPONSE_STAGES as readonly string[]).includes(v.stage)) throw new AppError("لا تُسجَّل الاستجابات إلا بعد تبليغ الإنذار وخلال مرحلة المدة أو التحقق");
    const r = await tx.response.create({
      data: {
        violationId, kind: sp.kind, receivedAt, letterNumber: base.letterNumber, letterDate: base.letterDate, summary: base.summary, createdById: actor.id, status: "UNDER_VERIFICATION",
        ...(sp.kind === "FINANCIAL" ? { financial: { create: { ...sp.data, amountDue: sp.data.amountDue ? new Decimal(sp.data.amountDue) : null, paymentStatus: sp.data.amountDue ? "UNPAID" : "UNDER_AUDIT" } } } : {}),
        ...(sp.kind === "TECHNICAL" ? { technical: { create: sp.data } } : {}),
        ...(sp.kind === "LEGAL" ? { legal: { create: sp.data } } : {}),
      },
    });
    if (stored.length) await insertAttachments(tx, actor, stored, { violationId, ownerType: "Response", ownerId: r.id, documentType: `RESPONSE_${sp.kind}`, approvalStatus: "APPROVED", additionReason: "مرفق استجابة" }, ctx);
    await writeAudit(tx, { actor, action: `response.recorded`, entityType: "Response", entityId: r.id, after: { kind: sp.kind, ...base, ...sp.data }, ctx });
    await stopDeadline(tx, violationId);
    await applyTransition(tx, actor, violationId, "response_recorded", { system: true, ctx });
    await notify(tx, { userIds: (await recipientsFor(tx, v, [...KIND_VERIFIERS[sp.kind]])).filter((id) => id !== actor.id), type: "response.recorded", title: "استجابة جديدة بانتظار التحقق", body: v.number, violationId, dedupeKey: `resp:${r.id}` });
    return r.id;
  });
}

async function loadResponse(tx: Tx, actor: Actor, responseId: string) {
  const r = await tx.response.findUnique({ where: { id: responseId }, include: { financial: { include: { payments: true } }, technical: true, legal: true } });
  if (!r) throw notFound();
  const v = await lockViolation(tx, r.violationId);
  if (!inScope(actor, v)) throw notFound();
  if (r.status === "ACCEPTED" || r.status === "REJECTED" || r.status === "PARTIALLY_ACCEPTED") throw new AppError("صدر قرار في هذه الاستجابة؛ لا تُعدَّل بياناتها");
  return { r, v };
}

// ─── المالية ───

function computeStatus(due: Prisma.Decimal | null, paid: Prisma.Decimal): "UNPAID" | "PARTIALLY_PAID" | "PAID" | "UNDER_AUDIT" {
  if (!due) return "UNDER_AUDIT";
  if (paid.lte(0)) return "UNPAID";
  return paid.gte(due) ? "PAID" : "PARTIALLY_PAID";
}

export const paymentSchema = z.object({
  amount: money,
  paidAt: dateKey,
  receiptNumber: z.string().trim().min(1, "رقم الوصل مطلوب").max(60),
  overpaymentReason: optText(1000),
});

/// تسجيل تسديد (جزئي أو متعدد). لا يُحتسب أي مبلغ تلقائياً؛ وتجاوز المستحق أو القيد العكسي يتطلب صلاحية معتمدة وسبباً.
export async function addPayment(actor: Actor, responseId: string, input: z.infer<typeof paymentSchema>, ctx?: AuditContext) {
  assertCan(actor, "financial.record");
  await prisma.$transaction(async (tx) => {
    const { r } = await loadResponse(tx, actor, responseId);
    if (!r.financial) throw new AppError("ليست استجابة مالية");
    const amount = new Decimal(input.amount);
    if (amount.isZero()) throw new AppError("المبلغ لا يكون صفراً");
    if (new Date(`${input.paidAt}T00:00:00Z`).getTime() > Date.now()) throw new AppError("لا يجوز أن يكون تاريخ التسديد في المستقبل");
    const paid = r.financial.payments.reduce((s, p) => s.plus(p.amount), new Decimal(0));
    const after = paid.plus(amount);
    const due = r.financial.amountDue;
    const special = amount.isNegative() || (due !== null && after.gt(due));
    if (special) {
      if (!can(actor, "financial.approve_overpayment")) {
        throw forbidden(amount.isNegative() ? "القيد العكسي يتطلب صلاحية اعتماد معتمدة" : "المبلغ يتجاوز المستحق المعتمد؛ يتطلب ذلك صلاحية اعتماد وسبباً");
      }
      if (!input.overpaymentReason) throw new AppError("يجب بيان سبب القيد العكسي أو تجاوز المستحق");
    }
    if (after.isNegative()) throw new AppError("لا يجوز أن يصبح مجموع التسديد سالباً");
    if (r.financial.payments.some((p) => p.receiptNumber === input.receiptNumber)) throw new AppError("رقم الوصل مسجل مسبقاً لهذه الاستجابة");
    const pay = await tx.payment.create({
      data: {
        financialResponseId: r.id, amount, paidAt: new Date(`${input.paidAt}T00:00:00Z`), receiptNumber: input.receiptNumber,
        overpaymentReason: special ? input.overpaymentReason : null, overpaymentApprover: special ? actor.id : null, recordedById: actor.id,
      },
    });
    await tx.financialResponse.update({ where: { responseId: r.id }, data: { paymentStatus: computeStatus(due, after) } });
    await writeAudit(tx, { actor, action: amount.isNegative() ? "payment.reversed" : "payment.recorded", entityType: "Payment", entityId: pay.id, before: { totalPaid: paid.toString() }, after: { amount: amount.toString(), totalPaid: after.toString(), receiptNumber: input.receiptNumber }, reason: input.overpaymentReason, ctx });
  });
}

/// تعديل المبلغ المستحق أو نتيجة التدقيق المالي (يُدخل من سند معتمد ويُسجَّل التعديل وسببه)
export async function updateFinancial(actor: Actor, responseId: string, input: { amountDue: string | null; amountDueBasis: string | null; auditResult: string | null; reason: string }, ctx?: AuditContext) {
  assertCan(actor, "financial.record");
  if (input.amountDue && !money.safeParse(input.amountDue).success) throw new AppError("مبلغ غير صحيح");
  if (input.amountDue && !input.amountDueBasis?.trim()) throw new AppError("يجب بيان السند المعتمد للمبلغ المستحق");
  await prisma.$transaction(async (tx) => {
    const { r } = await loadResponse(tx, actor, responseId);
    if (!r.financial) throw new AppError("ليست استجابة مالية");
    const newDue = input.amountDue ? new Decimal(input.amountDue) : null;
    const dueChanged = String(r.financial.amountDue ?? "") !== String(newDue ?? "");
    if (dueChanged && r.financial.amountDue !== null && !input.reason.trim()) throw new AppError("يجب بيان سبب تعديل المبلغ المستحق");
    const paid = r.financial.payments.reduce((s, p) => s.plus(p.amount), new Decimal(0));
    if (newDue && paid.gt(newDue) && !can(actor, "financial.approve_overpayment")) throw forbidden("المسدَّد يتجاوز المبلغ المستحق الجديد؛ يتطلب ذلك صلاحية اعتماد");
    await tx.financialResponse.update({
      where: { responseId: r.id },
      data: { amountDue: newDue, amountDueBasis: input.amountDueBasis?.trim() || null, auditResult: input.auditResult?.trim() || null, paymentStatus: computeStatus(newDue, paid) },
    });
    await writeAudit(tx, {
      actor, action: dueChanged ? "financial.amount_due_changed" : "financial.audit_updated", entityType: "FinancialResponse", entityId: r.id,
      before: { amountDue: r.financial.amountDue?.toString() ?? null, auditResult: r.financial.auditResult }, after: { amountDue: newDue?.toString() ?? null, auditResult: input.auditResult }, reason: input.reason || null, ctx,
    });
  });
}

// ─── التحقق الفني والرأي القانوني ───

export const technicalVerifySchema = z.object({
  verificationResult: z.string().trim().min(5, "نتيجة التحقق الفني مطلوبة").max(5000),
  compliance: z.enum(["FULL", "PARTIAL", "NOT_VERIFIED"]),
  recommendation: optText(),
});

/// رفع الملفات وحده لا يثبت إزالة المخالفة؛ يجب أن يتحقق الموظف الفني المخول ويحدد حالة الامتثال
export async function verifyTechnicalResponse(actor: Actor, responseId: string, input: z.infer<typeof technicalVerifySchema>, ctx?: AuditContext) {
  assertCan(actor, "response.technical_verify");
  await prisma.$transaction(async (tx) => {
    const { r } = await loadResponse(tx, actor, responseId);
    if (!r.technical) throw new AppError("ليست استجابة فنية");
    await tx.technicalResponse.update({ where: { responseId: r.id }, data: input });
    await writeAudit(tx, { actor, action: "response.technical_verified", entityType: "TechnicalResponse", entityId: r.id, before: { compliance: r.technical.compliance }, after: input, ctx });
  });
}

export const legalOpinionSchema = z.object({ legalOpinion: z.string().trim().min(5, "الرأي القانوني مطلوب").max(10000), proposedAction: optText() });

export async function giveLegalOpinion(actor: Actor, responseId: string, input: z.infer<typeof legalOpinionSchema>, ctx?: AuditContext) {
  assertCan(actor, "response.legal_decide");
  await prisma.$transaction(async (tx) => {
    const { r } = await loadResponse(tx, actor, responseId);
    if (!r.legal) throw new AppError("ليست استجابة قانونية");
    await tx.legalResponse.update({ where: { responseId: r.id }, data: input });
    await writeAudit(tx, { actor, action: "response.legal_opinion", entityType: "LegalResponse", entityId: r.id, after: input, ctx });
  });
}

// ─── قرار كفاية الاستجابة ───

export async function decideResponse(actor: Actor, responseId: string, decision: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED", notes: string | null, ctx?: AuditContext): Promise<Violation> {
  assertCan(actor, "response.decide");
  if (decision !== "ACCEPTED" && !notes?.trim()) throw new AppError("يجب بيان أسباب القرار");
  return prisma.$transaction(async (tx) => {
    const { r, v } = await loadResponse(tx, actor, responseId);
    if (v.stage !== "AWAITING_RESPONSE_VERIFICATION") throw new AppError("المعاملة ليست في مرحلة التحقق من الاستجابة", "CONFLICT");
    // شروط الاكتمال قبل القرار حسب نوع الاستجابة
    if (r.financial) {
      if (!r.financial.auditResult) throw new AppError("يجب تسجيل نتيجة التدقيق المالي قبل القرار");
      if (decision === "ACCEPTED" && r.financial.paymentStatus !== "PAID") throw new AppError("لا تُقبل الاستجابة المالية كاملة قبل تسديد المبلغ المستحق المعتمد بالكامل");
    }
    if (r.technical) {
      if (r.technical.compliance === "NOT_VERIFIED") throw new AppError("يجب أن يتحقق القسم الفني من الاستجابة ويحدد حالة الامتثال قبل القرار");
      if (decision === "ACCEPTED" && r.technical.compliance !== "FULL") throw new AppError("لا تُقبل الاستجابة الفنية كاملة إلا بامتثال كامل متحقق منه");
    }
    if (r.legal && !r.legal.legalOpinion) throw new AppError("يجب إبداء الرأي القانوني في الاستجابة قبل القرار");

    await tx.response.update({ where: { id: r.id }, data: { status: decision, decisionNotes: notes?.trim() || null, decidedById: actor.id, decidedAt: new Date() } });
    await recordApproval(tx, actor, v.id, "RESPONSE_VERIFICATION", decision === "ACCEPTED" ? "APPROVED" : decision === "REJECTED" ? "REJECTED" : "RETURNED", notes, { type: "Response", id: r.id });
    await writeAudit(tx, { actor, action: `response.${decision.toLowerCase()}`, entityType: "Response", entityId: r.id, reason: notes, ctx });
    if (decision === "ACCEPTED") {
      return applyTransition(tx, actor, v.id, "response_accepted", { system: true, outcome: KIND_OUTCOME[r.kind], reason: notes, ctx });
    }
    // تبقى المعاملة في التحقق إن وُجدت استجابات أخرى لم يُبت فيها؛ وإلا تُستأنف المدة
    const pending = await tx.response.count({ where: { violationId: v.id, status: { in: ["RECORDED", "UNDER_VERIFICATION"] } } });
    if (pending > 0) return v;
    const target = await resumeDeadline(tx, v.id);
    return applyTransition(tx, actor, v.id, "response_insufficient", { system: true, targetStage: target, reason: notes, ctx });
  });
}

// ─── إزالة المخالفة بالكامل ───

export const removalSchema = z.object({
  description: z.string().trim().min(5, "وصف المعالجة مطلوب").max(5000),
  treatedAt: dateKey,
  verificationReport: optText(),
  inspectionResult: optText(),
  verifiedByName: z.string().trim().min(3, "اسم الجهة التي تحققت من الإزالة مطلوب").max(200),
});

/// تسجيل إزالة المخالفة: يشترط استجابة فنية متحققاً من امتثالها الكامل، ولا يُغلق الملف تلقائياً
export async function recordRemoval(actor: Actor, violationId: string, input: z.infer<typeof removalSchema>, files: IncomingFile[], ctx?: AuditContext): Promise<string> {
  assertCan(actor, "removal.record");
  const stored = files.length ? await prepareFiles(files, actor, ctx) : [];
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    if (!["AWAITING_RESPONSE_VERIFICATION", "AWAITING_FINAL_VERIFICATION"].includes(v.stage)) throw new AppError("لا تُسجَّل الإزالة إلا بعد ورود الاستجابة");
    const full = await tx.technicalResponse.count({ where: { compliance: "FULL", response: { violationId, status: { not: "REJECTED" } } } });
    if (full === 0) throw new AppError("لا تُسجَّل إزالة المخالفة قبل التحقق الفني من امتثال كامل");
    if (await tx.removalRecord.count({ where: { violationId, status: "PENDING" } })) throw new AppError("يوجد سجل إزالة بانتظار الاعتماد");
    const rec = await tx.removalRecord.create({ data: { violationId, ...input, treatedAt: new Date(`${input.treatedAt}T00:00:00Z`), createdById: actor.id } });
    if (stored.length) await insertAttachments(tx, actor, stored, { violationId, ownerType: "RemovalRecord", ownerId: rec.id, documentType: "REMOVAL_EVIDENCE", approvalStatus: "APPROVED", additionReason: "أدلة إزالة المخالفة" }, ctx);
    await writeAudit(tx, { actor, action: "removal.recorded", entityType: "RemovalRecord", entityId: rec.id, after: input, ctx });
    await notify(tx, { userIds: await recipientsFor(tx, v, ["removal.approve"]), type: "removal.recorded", title: "إزالة مخالفة بانتظار الاعتماد", body: v.number, violationId, dedupeKey: `removal:${rec.id}` });
    return rec.id;
  });
}

export async function decideRemoval(actor: Actor, removalId: string, approve: boolean, notes: string | null, ctx?: AuditContext) {
  assertCan(actor, "removal.approve");
  if (!approve && !notes?.trim()) throw new AppError("يجب بيان سبب عدم قبول المعالجة");
  await prisma.$transaction(async (tx) => {
    const rec = await tx.removalRecord.findUnique({ where: { id: removalId } });
    if (!rec) throw notFound();
    const v = await lockViolation(tx, rec.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (rec.status !== "PENDING") throw new AppError("صدر قرار مسبقاً");
    await tx.removalRecord.update({ where: { id: removalId }, data: { status: approve ? "APPROVED" : "REJECTED", decisionNotes: notes, approvedById: actor.id, approvedAt: new Date() } });
    await recordApproval(tx, actor, v.id, "REMOVAL_ACCEPTANCE", approve ? "APPROVED" : "REJECTED", notes, { type: "RemovalRecord", id: removalId });
    await writeAudit(tx, { actor, action: approve ? "removal.approved" : "removal.rejected", entityType: "RemovalRecord", entityId: removalId, reason: notes, ctx });
    if (approve) await applyTransition(tx, actor, v.id, "removal_approved", { system: true, reason: notes, ctx });
  });
}
