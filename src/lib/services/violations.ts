import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, Violation, ViolationStage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, forbidden, notFound } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { assertCan, can, inScope, violationScopeWhere, type Actor } from "@/lib/rbac/actor";
import { applyTransition, hasActiveReport } from "@/lib/workflow";
import { zonedDateTimeToUtc } from "@/lib/datetime";

/// المراحل التي يجوز فيها تعديل البيانات الأساسية (قبل المصادقة النهائية)
export const EDITABLE_STAGES: ViolationStage[] = ["DRAFT", "REGISTERED", "AWAITING_REPORT"];

const opt = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `الحد الأقصى ${max} حرف`)
    .optional()
    .transform((v) => (v ? v : null));

const optId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const optCoord = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "إحداثية غير صحيحة" });
        return z.NEVER;
      }
      return n;
    });

export const violationInputSchema = z.object({
  paperReportNumber: opt(60),
  officialLetterNumber: opt(60),
  discoveredAt: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "تاريخ غير صحيح" });
        return z.NEVER;
      }
      const d = zonedDateTimeToUtc(v, "00:00");
      if (d.getTime() > Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "لا يجوز أن يكون تاريخ الاكتشاف في المستقبل" });
        return z.NEVER;
      }
      return d;
    }),
  governorateId: z.string().trim().min(1, "المحافظة مطلوبة"),
  officeId: z.string().trim().min(1, "الفرع أو المكتب مطلوب"),
  divisionId: optId,
  violationTypeId: optId,
  offenderName: z.string().trim().min(2, "اسم الجهة المخالفة مطلوب").max(200),
  entityTypeId: optId,
  offenderLicenseNo: opt(60),
  activityTypeId: optId,
  offenderAddress: opt(300),
  latitude: optCoord(-90, 90),
  longitude: optCoord(-180, 180),
  description: opt(5000),
  detectionSourceId: optId,
  organizerName: opt(120),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  internalNotes: opt(3000),
});

export type ViolationInput = z.infer<typeof violationInputSchema>;

/// المكاتب التي يجوز للمستخدم التسجيل باسمها
export function officeScopeWhere(actor: Actor): Prisma.OfficeWhereInput {
  if (actor.scope === "CENTRAL") return { isActive: true };
  if (actor.scope === "GOVERNORATE") return { isActive: true, governorateId: actor.governorateId ?? "__none__" };
  return { isActive: true, id: actor.officeId ?? "__none__" };
}

async function validateRefs(actor: Actor, input: ViolationInput) {
  // AND صريح: لا يجوز دمج الشرطين بالنشر لأن شرط النطاق قد يحمل الحقل id نفسه فيستبدل المعرف المدخل
  const office = await prisma.office.findFirst({ where: { AND: [{ id: input.officeId }, officeScopeWhere(actor)] } });
  if (!office) throw new AppError("الفرع أو المكتب المحدد غير متاح ضمن نطاق صلاحياتك");
  if (office.governorateId !== input.governorateId) throw new AppError("الفرع المحدد لا يتبع المحافظة المختارة");
  const checks: [string | null, () => Promise<unknown>, string][] = [
    [input.divisionId, () => prisma.division.findFirst({ where: { id: input.divisionId!, isActive: true, OR: [{ officeId: office.id }, { officeId: null }] } }), "الشعبة"],
    [input.violationTypeId, () => prisma.violationType.findFirst({ where: { id: input.violationTypeId!, isActive: true } }), "نوع المخالفة"],
    [input.entityTypeId, () => prisma.entityType.findFirst({ where: { id: input.entityTypeId!, isActive: true } }), "نوع الجهة"],
    [input.activityTypeId, () => prisma.activityType.findFirst({ where: { id: input.activityTypeId!, isActive: true } }), "نوع النشاط"],
    [input.detectionSourceId, () => prisma.detectionSource.findFirst({ where: { id: input.detectionSourceId!, isActive: true } }), "مصدر الاكتشاف"],
  ];
  for (const [id, find, label] of checks) {
    if (id && !(await find())) throw new AppError(`${label} المحدد غير موجود أو معطل`);
  }
}

const AUDITED_FIELDS = Object.keys(violationInputSchema.shape) as (keyof ViolationInput)[];

function pick(v: Partial<Violation> | ViolationInput) {
  const out: Record<string, unknown> = {};
  for (const k of AUDITED_FIELDS) {
    const val = (v as Record<string, unknown>)[k];
    out[k] = val instanceof Date ? val.toISOString() : val === undefined ? null : typeof val === "object" && val !== null ? String(val) : val;
  }
  return out;
}

export async function createDraft(actor: Actor, input: ViolationInput, ctx?: AuditContext, opts: { isDemo?: boolean } = {}): Promise<Violation> {
  assertCan(actor, "violation.create");
  await validateRefs(actor, input);
  return prisma.$transaction(async (tx) => {
    const v = await tx.violation.create({
      data: {
        ...input,
        draftRef: `مسودة-${randomBytes(4).toString("hex").toUpperCase()}`,
        createdById: actor.id,
        stage: "DRAFT",
        generalStatus: "OPEN",
        isDemo: opts.isDemo === true,
      },
    });
    await tx.violationStatusHistory.create({
      data: { violationId: v.id, fromStage: null, toStage: "DRAFT", fromStatus: null, toStatus: "OPEN", action: "create_draft", actorId: actor.id, actorRoles: actor.roles },
    });
    await writeAudit(tx, { actor, action: "violation.draft_created", entityType: "Violation", entityId: v.id, after: { ...pick(input), ...(v.isDemo ? { isDemo: true } : {}) }, ctx });
    return v;
  });
}

export async function updateViolation(actor: Actor, id: string, input: ViolationInput, expectedVersion: number, reason: string | null, ctx?: AuditContext): Promise<Violation> {
  assertCan(actor, "violation.edit");
  await validateRefs(actor, input);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Violation" WHERE id = ${id} FOR UPDATE`;
    if (!rows.length) throw notFound();
    const v = await tx.violation.findUniqueOrThrow({ where: { id } });
    if (!inScope(actor, v)) throw notFound();
    if (!EDITABLE_STAGES.includes(v.stage)) throw new AppError("لا يجوز تعديل بيانات المخالفة بعد إحالتها للمصادقة");
    if (v.version !== expectedVersion) throw new AppError("تم تعديل المعاملة من مستخدم آخر بعد فتحك لها. يرجى تحديث الصفحة.", "CONFLICT");
    // بعد التسجيل الرسمي يجب بيان سبب أي تعديل
    if (v.stage !== "DRAFT" && !reason?.trim()) throw new AppError("يجب بيان سبب التعديل بعد التسجيل الرسمي");
    const before = pick(v);
    const after = pick(input);
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (changed.length === 0) return v;
    const updated = await tx.violation.update({ where: { id, version: v.version }, data: { ...input, version: { increment: 1 } } });
    await writeAudit(tx, {
      actor,
      action: "violation.updated",
      entityType: "Violation",
      entityId: id,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      reason: reason?.trim() || null,
      ctx,
    });
    return updated;
  });
}

/// التسجيل الرسمي: يولّد الرقم الرسمي، ثم ينقل المخالفة إلى «بانتظار رفع المحضر» إن لم يُرفع بعد
export async function registerViolation(actor: Actor, id: string, expectedVersion: number, ctx?: AuditContext): Promise<Violation> {
  return prisma.$transaction(async (tx) => {
    let v = await applyTransition(tx, actor, id, "register", { expectedVersion, ctx });
    if (!(await hasActiveReport(tx, id))) v = await applyTransition(tx, actor, id, "await_report", { system: true, ctx });
    return v;
  });
}

export async function submitForApproval(actor: Actor, id: string, expectedVersion: number, ctx?: AuditContext): Promise<Violation> {
  return prisma.$transaction((tx) => applyTransition(tx, actor, id, "submit_for_approval", { expectedVersion, ctx }));
}

/// أرشفة مسودة غير مسجلة (حذف منطقي)؛ لا يجوز بعد التسجيل الرسمي
export async function archiveDraft(actor: Actor, id: string, reason: string, ctx?: AuditContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const v = await tx.violation.findUnique({ where: { id } });
    if (!v || !inScope(actor, v)) throw notFound();
    if (v.stage !== "DRAFT") throw new AppError("لا تُؤرشف إلا المسودات غير المسجلة");
    if (v.createdById !== actor.id && !can(actor, "violation.edit")) throw forbidden();
    if (!reason.trim()) throw new AppError("يجب بيان سبب الأرشفة");
    await tx.violation.update({ where: { id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    await writeAudit(tx, { actor, action: "violation.draft_archived", entityType: "Violation", entityId: id, reason, ctx });
  });
}

/// قراءة مخالفة ضمن نطاق المستخدم فقط؛ خارج النطاق تُعامل كأنها غير موجودة
export async function getViolationForActor(actor: Actor, id: string) {
  const v = await prisma.violation.findFirst({
    where: { AND: [{ id }, violationScopeWhere(actor)] },
    include: {
      governorate: true, office: true, division: true, violationType: true, entityType: true,
      activityType: true, detectionSource: true, createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!v) throw notFound();
  // المسودات لا يطلع عليها إلا منشئها أو من يملك صلاحية التعديل
  if (v.stage === "DRAFT" && v.createdById !== actor.id && !can(actor, "violation.edit")) throw notFound();
  return v;
}

// ─── البحث ───

export const searchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  number: z.string().trim().max(60).optional(),
  paperReportNumber: z.string().trim().max(60).optional(),
  officialLetterNumber: z.string().trim().max(60).optional(),
  offenderName: z.string().trim().max(120).optional(),
  offenderLicenseNo: z.string().trim().max(60).optional(),
  warningNumber: z.string().trim().max(60).optional(),
  caseNumber: z.string().trim().max(60).optional(),
  courtCaseNumber: z.string().trim().max(60).optional(),
  judgmentNumber: z.string().trim().max(60).optional(),
  governorateId: z.string().trim().max(40).optional(),
  officeId: z.string().trim().max(40).optional(),
  violationTypeId: z.string().trim().max(40).optional(),
  stage: z.string().trim().max(40).optional(),
  status: z.enum(["OPEN", "CLOSED", ""]).optional(),
  createdById: z.string().trim().max(40).optional(),
  registeredFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  registeredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  receivedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  receivedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  drafts: z.enum(["mine", ""]).optional(),
  sort: z.enum(["registeredAt_desc", "registeredAt_asc", "updatedAt_desc", "number_asc", "offenderName_asc"]).default("updatedAt_desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type SearchInput = z.infer<typeof searchSchema>;

const contains = (s?: string) => (s ? { contains: s, mode: "insensitive" as const } : undefined);

function dayRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: zonedDateTimeToUtc(from, "00:00") } : {}),
    ...(to ? { lt: new Date(zonedDateTimeToUtc(to, "00:00").getTime() + 86_400_000) } : {}),
  };
}

export function buildSearchWhere(actor: Actor, s: SearchInput): Prisma.ViolationWhereInput {
  const and: Prisma.ViolationWhereInput[] = [violationScopeWhere(actor), { archivedAt: null }];
  if (s.drafts === "mine") {
    and.push({ stage: "DRAFT", createdById: actor.id });
  } else if (s.stage === "DRAFT") {
    and.push(can(actor, "violation.edit") ? { stage: "DRAFT" } : { stage: "DRAFT", createdById: actor.id });
  } else {
    and.push({ stage: s.stage ? (s.stage as ViolationStage) : { not: "DRAFT" } });
  }
  if (s.q) {
    and.push({
      OR: [
        { number: contains(s.q) },
        { offenderName: contains(s.q) },
        { paperReportNumber: contains(s.q) },
        { officialLetterNumber: contains(s.q) },
        { offenderLicenseNo: contains(s.q) },
        { draftRef: contains(s.q) },
      ],
    });
  }
  if (s.number) and.push({ number: contains(s.number) });
  if (s.paperReportNumber) and.push({ paperReportNumber: contains(s.paperReportNumber) });
  if (s.officialLetterNumber) and.push({ officialLetterNumber: contains(s.officialLetterNumber) });
  if (s.offenderName) and.push({ offenderName: contains(s.offenderName) });
  if (s.offenderLicenseNo) and.push({ offenderLicenseNo: contains(s.offenderLicenseNo) });
  if (s.warningNumber) and.push({ warnings: { some: { number: contains(s.warningNumber) } } });
  if (s.caseNumber) and.push({ criminalCase: { number: contains(s.caseNumber) } });
  if (s.courtCaseNumber) and.push({ criminalCase: { courtCaseNumber: contains(s.courtCaseNumber) } });
  if (s.judgmentNumber) and.push({ criminalCase: { judgments: { some: { number: contains(s.judgmentNumber) } } } });
  if (s.governorateId) and.push({ governorateId: s.governorateId });
  if (s.officeId) and.push({ officeId: s.officeId });
  if (s.violationTypeId) and.push({ violationTypeId: s.violationTypeId });
  if (s.status) and.push({ generalStatus: s.status });
  if (s.createdById) and.push({ createdById: s.createdById });
  const reg = dayRange(s.registeredFrom || undefined, s.registeredTo || undefined);
  if (reg) and.push({ registeredAt: reg });
  const rec = dayRange(s.receivedFrom || undefined, s.receivedTo || undefined);
  if (rec) and.push({ warnings: { some: { deliveries: { some: { receivedAt: rec } } } } });
  const due = dayRange(s.dueFrom || undefined, s.dueTo || undefined);
  if (due) and.push({ deadlines: { some: { isCurrent: true, dueDate: due } } });
  return { AND: and };
}

const SORTS: Record<SearchInput["sort"], Prisma.ViolationOrderByWithRelationInput[]> = {
  registeredAt_desc: [{ registeredAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  registeredAt_asc: [{ registeredAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  updatedAt_desc: [{ updatedAt: "desc" }],
  number_asc: [{ number: { sort: "asc", nulls: "last" } }],
  offenderName_asc: [{ offenderName: "asc" }],
};

export const PAGE_SIZE = 20;

export async function searchViolations(actor: Actor, s: SearchInput) {
  assertCan(actor, "violation.view");
  const where = buildSearchWhere(actor, s);
  const [total, rows] = await Promise.all([
    prisma.violation.count({ where }),
    prisma.violation.findMany({
      where,
      orderBy: SORTS[s.sort],
      skip: (s.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, number: true, draftRef: true, offenderName: true, stage: true, generalStatus: true, priority: true,
        registeredAt: true, updatedAt: true, isDemo: true,
        governorate: { select: { nameAr: true } }, office: { select: { nameAr: true } }, violationType: { select: { nameAr: true } },
      },
    }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}
