import { z } from "zod";
import { Prisma, type DeadlineCalculation, type LegalDeadlineRule, type Violation } from "@prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, type Actor } from "@/lib/rbac/actor";
import { getSetting } from "@/lib/settings";
import { DEFAULT_TZ, localDateKey } from "@/lib/datetime";
import { addDaysKey, computeDue, extendDue, liveStatus, type Calendar, type RuleSpec } from "@/lib/deadlines/compute";
import { applyTransition, lockViolation, SYSTEM_ACTOR } from "@/lib/workflow";
import { notify, recipientsFor } from "./notifications";
import { insertAttachments, prepareFiles, type IncomingFile } from "./attachments";

// ─── القواعد والعطل ───

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صحيح");

export const ruleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/, "الرمز: حروف لاتينية وأرقام"),
  nameAr: z.string().trim().min(3, "اسم القاعدة مطلوب").max(150),
  violationTypeId: z.string().optional().transform((v) => v || null),
  duration: z.coerce.number().int().min(1, "المدة يجب أن تكون يوماً على الأقل").max(3650),
  unit: z.enum(["CALENDAR_DAYS", "WORKING_DAYS"]),
  startEvent: z.enum(["RECEIPT_DATE", "DAY_AFTER_RECEIPT"]),
  excludeHolidays: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  legalBasis: z.string().trim().min(5, "السند القانوني أو القرار المعتمد للقاعدة مطلوب").max(1000),
  extensionAllowed: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  maxExtensionDays: z.preprocess((v) => (v === "" || v === undefined || v === null ? null : Number(v)), z.number().int().min(1).max(3650).nullable()),
  objectionEffect: z.enum(["NONE", "SUSPEND", "MANUAL_DECISION"]),
  warnBeforeDays: z.coerce.number().int().min(0).max(60),
  effectiveFrom: dateKey,
});

/// إنشاء قاعدة احتساب. القواعد لا تُعدَّل بعد إنشائها (لا أثر رجعي): يُنشأ بديل بتاريخ سريان جديد وتُنهى القديمة.
export async function createRule(actor: Actor, input: z.infer<typeof ruleSchema>, ctx?: AuditContext): Promise<string> {
  assertCan(actor, "deadline.rules_manage");
  if (input.violationTypeId && !(await prisma.violationType.findUnique({ where: { id: input.violationTypeId } }))) throw new AppError("نوع المخالفة غير موجود");
  return prisma.$transaction(async (tx) => {
    const r = await tx.legalDeadlineRule.create({
      data: { ...input, effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), createdById: actor.id },
    });
    await writeAudit(tx, { actor, action: "deadline_rule.created", entityType: "LegalDeadlineRule", entityId: r.id, after: input, ctx });
    return r.id;
  });
}

/// إنهاء سريان قاعدة (لا تؤثر على المدد المحتسبة سابقاً لأن كل مدة تحتفظ بنسخة من قاعدتها)
export async function endRule(actor: Actor, ruleId: string, effectiveTo: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "deadline.rules_manage");
  if (!reason.trim()) throw new AppError("يجب بيان سبب إنهاء السريان");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) throw new AppError("تاريخ نهاية السريان غير صحيح");
  await prisma.$transaction(async (tx) => {
    const r = await tx.legalDeadlineRule.findUnique({ where: { id: ruleId } });
    if (!r) throw notFound();
    if (`${effectiveTo}` < r.effectiveFrom.toISOString().slice(0, 10)) throw new AppError("نهاية السريان تسبق بدايته");
    await tx.legalDeadlineRule.update({ where: { id: ruleId }, data: { effectiveTo: new Date(`${effectiveTo}T00:00:00Z`) } });
    await writeAudit(tx, { actor, action: "deadline_rule.ended", entityType: "LegalDeadlineRule", entityId: ruleId, before: { effectiveTo: r.effectiveTo }, after: { effectiveTo }, reason, ctx });
  });
}

export async function addHoliday(actor: Actor, date: string, nameAr: string, ctx?: AuditContext) {
  assertCan(actor, "deadline.rules_manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !nameAr.trim()) throw new AppError("التاريخ واسم العطلة مطلوبان");
  await prisma.$transaction(async (tx) => {
    const h = await tx.holiday.create({ data: { date: new Date(`${date}T00:00:00Z`), nameAr: nameAr.trim() } });
    await writeAudit(tx, { actor, action: "holiday.added", entityType: "Holiday", entityId: h.id, after: { date, nameAr }, ctx });
  });
}

export async function removeHoliday(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "deadline.rules_manage");
  await prisma.$transaction(async (tx) => {
    const h = await tx.holiday.delete({ where: { id } });
    await writeAudit(tx, { actor, action: "holiday.removed", entityType: "Holiday", entityId: id, before: { date: h.date, nameAr: h.nameAr }, ctx });
  });
}

/// التقويم الحالي (المنطقة الزمنية، نهاية الأسبوع، العطل الرسمية)
export async function currentCalendar(db: Db): Promise<Calendar> {
  const [weekendDays, holidays] = await Promise.all([getSetting(db, "deadline.weekendDays"), db.holiday.findMany({ select: { date: true } })]);
  return { timezone: DEFAULT_TZ, weekendDays: weekendDays as number[], holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))) };
}

/// القاعدة السارية بتاريخ الاستلام: الخاصة بنوع المخالفة أولاً، ثم العامة، والأحدث سرياناً
export async function findApplicableRule(db: Db, violationTypeId: string | null, atKey: string): Promise<LegalDeadlineRule | null> {
  const at = new Date(`${atKey}T00:00:00Z`);
  const rules = await db.legalDeadlineRule.findMany({
    where: {
      isActive: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [{ OR: [{ violationTypeId }, { violationTypeId: null }] }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  return rules.find((r) => r.violationTypeId === violationTypeId) ?? rules.find((r) => r.violationTypeId === null) ?? null;
}

type Snapshot = {
  rule: RuleSpec & { id: string; code: string; nameAr: string; legalBasis: string; extensionAllowed: boolean; maxExtensionDays: number | null; objectionEffect: string; warnBeforeDays: number; effectiveFrom: string };
  calendar: { timezone: string; weekendDays: number[]; holidays: string[] };
  receivedAt: string;
};

function snapshotOf(rule: LegalDeadlineRule, cal: Calendar, receivedAt: Date): Snapshot {
  const receiptKey = localDateKey(receivedAt, cal.timezone);
  const horizon = addDaysKey(receiptKey, 3 * 365);
  return {
    rule: {
      id: rule.id, code: rule.code, nameAr: rule.nameAr, legalBasis: rule.legalBasis, duration: rule.duration, unit: rule.unit, startEvent: rule.startEvent,
      excludeHolidays: rule.excludeHolidays, extensionAllowed: rule.extensionAllowed, maxExtensionDays: rule.maxExtensionDays, objectionEffect: rule.objectionEffect,
      warnBeforeDays: rule.warnBeforeDays, effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
    },
    // نسخة من التقويم وقت الاحتساب حتى لا يغير تعديل العطل لاحقاً مدداً سارية بأثر رجعي
    calendar: { timezone: cal.timezone, weekendDays: cal.weekendDays, holidays: [...cal.holidays].filter((d) => d >= receiptKey && d <= horizon).sort() },
    receivedAt: receivedAt.toISOString(),
  };
}

export function snapshotCalendar(s: Snapshot): Calendar {
  return { timezone: s.calendar.timezone, weekendDays: s.calendar.weekendDays, holidays: new Set(s.calendar.holidays) };
}

export function readSnapshot(d: Pick<DeadlineCalculation, "ruleSnapshot">): Snapshot | null {
  const s = d.ruleSnapshot as unknown as Snapshot | Record<string, never>;
  return s && "rule" in s ? (s as Snapshot) : null;
}

/// يبدأ احتساب المدة عند تسجيل الاستلام الموثق. إن لم توجد قاعدة سارية تُسجَّل المدة «بانتظار مراجعة الموظف المختص» دون اختراع مدة.
export async function startDeadline(tx: Tx, v: Violation, warningId: string, receivedAt: Date, now = new Date()): Promise<DeadlineCalculation> {
  await tx.deadlineCalculation.updateMany({ where: { violationId: v.id, isCurrent: true }, data: { isCurrent: false } });
  const cal = await currentCalendar(tx);
  const rule = await findApplicableRule(tx, v.violationTypeId, localDateKey(receivedAt, cal.timezone));
  if (!rule) {
    const d = await tx.deadlineCalculation.create({
      data: { violationId: v.id, warningId, ruleId: null, ruleSnapshot: { receivedAt: receivedAt.toISOString(), noApplicableRule: true }, status: "PENDING_REVIEW" },
    });
    await notify(tx, {
      userIds: await recipientsFor(tx, v, ["deadline.rules_manage"]), type: "deadline.no_rule", title: "لا توجد قاعدة مدة سارية لمخالفة مبلَّغة",
      body: v.number, violationId: v.id, dedupeKey: `no-rule:${d.id}`,
    });
    return d;
  }
  const snap = snapshotOf(rule, cal, receivedAt);
  const due = computeDue(receivedAt, snap.rule, cal);
  return tx.deadlineCalculation.create({
    data: {
      violationId: v.id, warningId, ruleId: rule.id, ruleSnapshot: snap as unknown as Prisma.InputJsonValue,
      startDate: new Date(`${due.startKey}T00:00:00Z`), originalDueDate: due.dueDate, dueDate: due.dueDate,
      status: liveStatus(due.dueDate, rule.warnBeforeDays, now, cal.timezone),
    },
  });
}

/// إعادة احتساب المدة الحالية بعد تصحيح تاريخ الاستلام: بالقاعدة والتقويم المحفوظين، مع إعادة تطبيق التمديدات المعتمدة
export async function recomputeCurrent(tx: Tx, violationId: string, receivedAt: Date, now = new Date()) {
  const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true }, include: { extensions: { where: { status: "APPROVED" }, orderBy: { decidedAt: "asc" } } } });
  const snap = d && readSnapshot(d);
  if (!d || !snap) return null;
  const cal = snapshotCalendar(snap);
  let due = computeDue(receivedAt, snap.rule, cal);
  const originalDue = due.dueDate;
  for (const e of d.extensions) due = extendDue(due.dueKey, e.grantedDays!, snap.rule, cal);
  const status = d.status === "SUSPENDED" || d.status === "STOPPED" ? d.status : liveStatus(due.dueDate, snap.rule.warnBeforeDays, now, cal.timezone);
  return tx.deadlineCalculation.update({
    where: { id: d.id },
    data: { ruleSnapshot: { ...snap, receivedAt: receivedAt.toISOString() } as unknown as Prisma.InputJsonValue, startDate: new Date(`${due.startKey}T00:00:00Z`), originalDueDate: originalDue, dueDate: due.dueDate, status: status === "RUNNING" && d.extensions.length ? "EXTENDED" : status },
  });
}

/// تطبيق القاعدة السارية على مدة كانت «بانتظار المراجعة» لعدم وجود قاعدة وقت الاستلام
export async function applyRuleToPending(actor: Actor, violationId: string, ctx?: AuditContext) {
  if (!can(actor, "deadline.rules_manage") && !can(actor, "delivery.correct_receipt")) throw new AppError("لا تملك صلاحية تنفيذ هذا الإجراء", "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v) && !can(actor, "deadline.rules_manage")) throw notFound();
    const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true } });
    if (!d || d.status !== "PENDING_REVIEW") throw new AppError("لا توجد مدة بانتظار المراجعة");
    const receivedAt = new Date((d.ruleSnapshot as { receivedAt: string }).receivedAt);
    const created = await startDeadline(tx, v, d.warningId, receivedAt);
    if (created.status === "PENDING_REVIEW") throw new AppError("لا توجد بعد قاعدة سارية بتاريخ الاستلام لنوع هذه المخالفة");
    await writeAudit(tx, { actor, action: "deadline.rule_applied", entityType: "DeadlineCalculation", entityId: created.id, after: { dueDate: created.dueDate, ruleId: created.ruleId }, ctx });
  });
}

// ─── طلبات التمديد ───

export const extensionSchema = z.object({
  requestedAt: dateKey,
  requestedDays: z.coerce.number().int().min(1, "المدة الإضافية يجب أن تكون يوماً على الأقل").max(3650),
  reasons: z.string().trim().min(5, "أسباب الطلب مطلوبة").max(5000),
  opinion: z.string().trim().max(5000).optional().transform((v) => v || null),
});

/// تسجيل طلب تمديد: لا يغير تاريخ الاستحقاق ولا يوقف المدة
export async function recordExtension(actor: Actor, violationId: string, input: z.infer<typeof extensionSchema>, files: IncomingFile[], ctx?: AuditContext) {
  assertCan(actor, "extension.record");
  const stored = files.length ? await prepareFiles(files, actor, ctx) : [];
  return prisma.$transaction(async (tx) => {
    const v = await lockViolation(tx, violationId);
    if (!inScope(actor, v)) throw notFound();
    const d = await tx.deadlineCalculation.findFirst({ where: { violationId, isCurrent: true } });
    const snap = d && readSnapshot(d);
    if (!d || !snap) throw new AppError("لا توجد مدة قانونية محتسبة لهذه المخالفة");
    if (!snap.rule.extensionAllowed) throw new AppError("قاعدة المدة المعتمدة لهذه المخالفة لا تجيز التمديد");
    if (snap.rule.maxExtensionDays && d.totalExtensionDays + input.requestedDays > snap.rule.maxExtensionDays) {
      throw new AppError(`يتجاوز الطلب الحد الأقصى للتمديد في القاعدة (${snap.rule.maxExtensionDays} يوماً، الممنوح سابقاً ${d.totalExtensionDays})`);
    }
    if (await tx.extensionRequest.count({ where: { violationId, status: "PENDING" } })) throw new AppError("يوجد طلب تمديد قيد المراجعة");
    const e = await tx.extensionRequest.create({
      data: { violationId, deadlineId: d.id, requestedAt: new Date(`${input.requestedAt}T00:00:00Z`), requestedDays: input.requestedDays, reasons: input.reasons, opinion: input.opinion, createdById: actor.id },
    });
    if (stored.length) await insertAttachments(tx, actor, stored, { violationId, ownerType: "ExtensionRequest", ownerId: e.id, documentType: "EXTENSION_REQUEST", approvalStatus: "APPROVED", additionReason: "مرفق طلب تمديد" }, ctx);
    await writeAudit(tx, { actor, action: "extension.recorded", entityType: "ExtensionRequest", entityId: e.id, after: input, ctx });
    await applyTransition(tx, actor, violationId, "extension_requested", { system: true, ctx });
    return e.id;
  });
}

/// قرار صاحب الصلاحية في طلب التمديد. عند الموافقة يُحتسب تاريخ الاستحقاق الجديد بوحدة القاعدة وتقويمها المحفوظين.
export async function decideExtension(actor: Actor, requestId: string, approve: boolean, grantedDays: number | null, notes: string | null, ctx?: AuditContext, now = new Date()) {
  assertCan(actor, "extension.decide");
  return prisma.$transaction(async (tx) => {
    const e = await tx.extensionRequest.findUnique({ where: { id: requestId }, include: { deadline: true } });
    if (!e) throw notFound();
    const v = await lockViolation(tx, e.violationId);
    if (!inScope(actor, v)) throw notFound();
    if (e.status !== "PENDING") throw new AppError("صدر قرار في هذا الطلب مسبقاً");
    if (!approve && !notes?.trim()) throw new AppError("يجب بيان سبب رفض طلب التمديد");
    const snap = readSnapshot(e.deadline)!;
    let newDue: Date | null = null;
    if (approve) {
      const days = grantedDays ?? e.requestedDays;
      if (!Number.isInteger(days) || days < 1) throw new AppError("المدة الممنوحة غير صحيحة");
      if (snap.rule.maxExtensionDays && e.deadline.totalExtensionDays + days > snap.rule.maxExtensionDays) throw new AppError("يتجاوز التمديد الحد الأقصى في القاعدة");
      const cal = snapshotCalendar(snap);
      const due = extendDue(localDateKey(e.deadline.dueDate!, cal.timezone), days, snap.rule, cal);
      newDue = due.dueDate;
      const live = liveStatus(newDue, snap.rule.warnBeforeDays, now, cal.timezone);
      await tx.deadlineCalculation.update({
        where: { id: e.deadlineId },
        data: { dueDate: newDue, totalExtensionDays: { increment: days }, status: live === "RUNNING" ? "EXTENDED" : live },
      });
      await tx.extensionRequest.update({ where: { id: requestId }, data: { status: "APPROVED", grantedDays: days, newDueDate: newDue, decidedById: actor.id, decidedAt: new Date(), decisionNotes: notes } });
    } else {
      await tx.extensionRequest.update({ where: { id: requestId }, data: { status: "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNotes: notes } });
    }
    await writeAudit(tx, { actor, action: approve ? "extension.approved" : "extension.rejected", entityType: "ExtensionRequest", entityId: requestId, before: { dueDate: e.deadline.dueDate }, after: { dueDate: newDue ?? e.deadline.dueDate }, reason: notes, ctx });
    const current = await tx.deadlineCalculation.findUniqueOrThrow({ where: { id: e.deadlineId } });
    const expired = current.dueDate ? current.dueDate.getTime() < now.getTime() : false;
    await applyTransition(tx, actor, v.id, expired ? "extension_decided_expired" : "extension_decided_running", { system: true, reason: notes, ctx });
  });
}

// ─── المهمة المجدولة ───

/// المرحلة → الصلاحية المسؤولة عن الإجراء التالي (لتنبيهات التأخر عن المدة الإدارية)
export const STAGE_OWNER: Partial<Record<Violation["stage"], Parameters<typeof recipientsFor>[2]>> = {
  AWAITING_REPORT: ["violation.submit"],
  REGISTERED: ["violation.submit"],
  AWAITING_FINAL_APPROVAL: ["approval.final_registration"],
  AWAITING_TECHNICAL: ["technical.prepare", "technical.review"],
  AWAITING_LEGAL: ["legal.prepare", "legal.approve"],
  AWAITING_WARNING_APPROVAL: ["warning.approve_issue"],
  WARNING_PREPARATION: ["warning.prepare"],
  AWAITING_WARNING_SIGNATURE: ["warning.upload_signed"],
  AWAITING_DELIVERY: ["delivery.record"],
  AWAITING_RECEIPT_PROOF: ["delivery.record"],
  EXTENSION_UNDER_REVIEW: ["extension.decide"],
  DEADLINE_EXPIRED: ["nonresponse.initiate"],
};

export type RefreshResult = { checked: number; nearExpiry: number; expired: number; stageExpired: number; slaAlerts: number; notifications: number };

/// تحديث حالات المدد وإرسال التنبيهات. آمنة للتكرار: الإشعارات تُمنع من التكرار بمفتاح فريد، والانتقالات تُطبق مرة واحدة.
export async function refreshDeadlines(now = new Date()): Promise<RefreshResult> {
  const res: RefreshResult = { checked: 0, nearExpiry: 0, expired: 0, stageExpired: 0, slaAlerts: 0, notifications: 0 };
  const active = await prisma.deadlineCalculation.findMany({
    where: { isCurrent: true, dueDate: { not: null }, status: { in: ["RUNNING", "NEAR_EXPIRY", "EXTENDED", "EXPIRED"] } },
    include: { violation: true },
  });
  for (const d of active) {
    res.checked++;
    const snap = readSnapshot(d);
    if (!snap) continue;
    const live = liveStatus(d.dueDate!, snap.rule.warnBeforeDays, now, snap.calendar.timezone);
    await prisma.$transaction(async (tx) => {
      if (live === "NEAR_EXPIRY") {
        if (d.status === "RUNNING" || d.status === "EXTENDED") {
          await tx.deadlineCalculation.update({ where: { id: d.id }, data: { status: "NEAR_EXPIRY" } });
          res.nearExpiry++;
        }
        res.notifications += await notify(tx, {
          userIds: await recipientsFor(tx, d.violation, ["deadline.view"], { excludeCentral: true }),
          type: "deadline.near_expiry", title: "اقترب انتهاء المدة القانونية", body: `${d.violation.number} — تنتهي ${localDateKey(d.dueDate!, snap.calendar.timezone)}`,
          violationId: d.violationId, dedupeKey: `near:${d.id}:${d.dueDate!.toISOString()}`,
        });
      } else if (live === "EXPIRED") {
        if (d.status !== "EXPIRED") {
          await tx.deadlineCalculation.update({ where: { id: d.id }, data: { status: "EXPIRED" } });
          res.expired++;
        }
        const v = await tx.violation.findUniqueOrThrow({ where: { id: d.violationId } });
        if (v.stage === "DEADLINE_RUNNING") {
          await applyTransition(tx, SYSTEM_ACTOR, v.id, "deadline_expired", { system: true, reason: "انتهاء المدة القانونية المحتسبة دون تسجيل استجابة" });
          res.stageExpired++;
        }
      } else if (d.status === "NEAR_EXPIRY" || d.status === "EXPIRED") {
        // بعد تمديد أو تصحيح أعاد المدة للسريان
        await tx.deadlineCalculation.update({ where: { id: d.id }, data: { status: d.totalExtensionDays > 0 ? "EXTENDED" : "RUNNING" } });
      }
    });
  }

  // تنبيهات التأخر عن المدة الإدارية لكل مرحلة (إن ضُبطت في إعداد المراحل)
  const slas = await prisma.workflowStageConfig.findMany({ where: { slaDays: { not: null } } });
  for (const s of slas) {
    const owners = STAGE_OWNER[s.stage];
    if (!owners || !s.slaDays) continue;
    const late = await prisma.violation.findMany({
      where: { stage: s.stage, generalStatus: "OPEN", archivedAt: null, updatedAt: { lt: new Date(now.getTime() - s.slaDays * 86_400_000) } },
      include: { statusHistory: { orderBy: { createdAt: "desc" }, take: 1 } },
      take: 500,
    });
    for (const v of late) {
      const h = v.statusHistory[0];
      if (!h || h.createdAt.getTime() > now.getTime() - s.slaDays * 86_400_000) continue;
      const n = await notify(prisma, {
        userIds: await recipientsFor(prisma, v, owners), type: "sla.overdue", title: `تأخر إجراء عن المدة الإدارية (${s.slaDays} يوم): ${s.labelAr}`,
        body: v.number ?? v.draftRef, violationId: v.id, dedupeKey: `sla:${h.id}`,
      });
      if (n) res.slaAlerts++;
      res.notifications += n;
    }
  }

  await prisma.systemSetting.upsert({
    where: { key: "jobs.deadlines.lastRun" },
    update: { value: { at: now.toISOString(), ...res } },
    create: { key: "jobs.deadlines.lastRun", value: { at: now.toISOString(), ...res } },
  });
  return res;
}

export function canManageDeadlines(actor: Actor) {
  return can(actor, "deadline.rules_manage");
}

const JOB_KEY = "job.deadlines.lastRunAt";

/// يحجز تشغيل المهمة ذرياً: ينجح لطلب واحد فقط إذا مضى على آخر تشغيل أكثر من minMinutes
async function claimDeadlineJob(minMinutes: number, now: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
    VALUES (${JOB_KEY}, to_jsonb(${now.toISOString()}::text), ${now})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
    WHERE "SystemSetting"."updatedAt" < ${new Date(now.getTime() - minMinutes * 60_000)}
    RETURNING "key"`;
  return rows.length > 0;
}

/// تشغيل احتياطي من داخل التطبيق: حين يتعذّر على المجدول الخارجي الوصول (مثلاً حماية الموقع بتسجيل دخول الفريق)
/// تُشغَّل المهمة بعد استجابة أول طلب لمستخدم مسجّل، مرة واحدة كل ساعة على الأكثر. المهمة نفسها متساوية القوى (idempotent).
export async function maybeRefreshDeadlines(now = new Date()): Promise<RefreshResult | null> {
  if (!(await claimDeadlineJob(55, now))) return null;
  return refreshDeadlines(now);
}

/// يسجّل تشغيلاً تمّ عبر المجدول حتى لا يتكرر التشغيل الاحتياطي في الساعة نفسها
export async function markDeadlineJobRun(now = new Date()): Promise<void> {
  await claimDeadlineJob(0, now);
}
