import { Prisma, type RequestStatus } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, can, type Actor } from "@/lib/rbac";
import { nextNumber } from "@/lib/numbering";
import { addSheet, newWorkbook, toBuffer } from "@/lib/excel";
import { PRIORITY, REQUEST_STATUS, REQUEST_TYPE } from "@/lib/labels";
import { dayInText, fmtDay, parseDay, today } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";
import { notifyNewRequest } from "./notifications";

export const PAGE_SIZE = 25;

/// الحالات المفتوحة التي يُتابَع موعدها وتُحتسب متأخرة إذا فات موعد المتابعة
export const OPEN_STATUSES: RequestStatus[] = ["NEW", "UNDER_REVIEW", "REFERRED", "FOLLOWING"];

/// الانتقالات المسموحة بين حالات الطلب. الإغلاق وإعادة الفتح يتطلبان صلاحية «اعتماد إغلاق الطلبات».
export const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  NEW: ["UNDER_REVIEW", "REFERRED", "FOLLOWING", "DONE", "FAILED"],
  UNDER_REVIEW: ["REFERRED", "FOLLOWING", "DONE", "FAILED"],
  REFERRED: ["FOLLOWING", "DONE", "FAILED"],
  FOLLOWING: ["REFERRED", "DONE", "FAILED"],
  DONE: ["FOLLOWING", "CLOSED"],
  FAILED: ["FOLLOWING", "CLOSED"],
  CLOSED: ["FOLLOWING"],
};

export function needsClosePermission(from: RequestStatus, to: RequestStatus) {
  return to === "CLOSED" || from === "CLOSED";
}

/// الانتقالات التي يستطيع المستخدم تنفيذها من الحالة الحالية
export function allowedTransitions(actor: Actor, from: RequestStatus): RequestStatus[] {
  return TRANSITIONS[from].filter((to) => can(actor, needsClosePermission(from, to) ? "requests.close" : "requests.update"));
}

// ─────────────────────────── التحقق ───────────────────────────

const dayField = (msg: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        return parseDay(v || null);
      } catch {
        ctx.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
    });

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const requestSchema = z
  .object({
    receivedAt: dayField("تاريخ الاستلام غير صحيح"),
    applicantName: z.string().trim().min(3, "اسم مقدم الطلب مطلوب").max(150),
    applicantId: z.string().uuid().optional().nullable().catch(null),
    type: z.enum(["ADMINISTRATIVE", "PUBLIC_SERVICE", "INQUIRY", "TRANSACTION", "OTHER"], { message: "نوع الطلب مطلوب" }),
    description: z.string().trim().min(5, "وصف الطلب مطلوب").max(4000),
    authorityId: z.coerce.number().int().positive().optional().nullable().catch(null),
    ownerId: z.string().uuid().optional().nullable().catch(null),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    followUpDate: dayField("موعد المتابعة غير صحيح"),
  })
  .superRefine((d, ctx) => {
    if (!d.receivedAt) ctx.addIssue({ code: "custom", path: ["receivedAt"], message: "تاريخ الاستلام مطلوب" });
    else if (d.receivedAt > today()) ctx.addIssue({ code: "custom", path: ["receivedAt"], message: "تاريخ الاستلام لا يكون في المستقبل" });
    if (d.followUpDate && d.receivedAt && d.followUpDate < d.receivedAt) ctx.addIssue({ code: "custom", path: ["followUpDate"], message: "موعد المتابعة قبل تاريخ الاستلام" });
  });

export type RequestInput = z.input<typeof requestSchema>;

async function assertRefs(tx: Tx, d: { applicantId?: string | null; authorityId?: number | null; ownerId?: string | null }) {
  if (d.applicantId && !(await tx.person.findFirst({ where: { id: d.applicantId, deletedAt: null } }))) throw new AppError("الشخص المختار غير موجود في قاعدة البيانات");
  if (d.authorityId && !(await tx.authority.findFirst({ where: { id: d.authorityId } }))) throw new AppError("الجهة المختصة غير موجودة");
  if (d.ownerId && !(await tx.user.findFirst({ where: { id: d.ownerId, isActive: true } }))) throw new AppError("المسؤول عن المتابعة غير موجود أو معطل");
}

const AUDIT_FIELDS = {
  id: true,
  number: true,
  receivedAt: true,
  applicantName: true,
  applicantId: true,
  type: true,
  description: true,
  authorityId: true,
  ownerId: true,
  priority: true,
  status: true,
  lastAction: true,
  followUpDate: true,
  closedAt: true,
  failureReason: true,
  deletedAt: true,
} as const;

async function lockRequest(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Request" WHERE id = ${id}::uuid FOR UPDATE`;
  const r = await tx.request.findFirst({ where: { id, deletedAt: null }, select: AUDIT_FIELDS });
  if (!r) throw notFound();
  return r;
}

// ─────────────────────────── العمليات ───────────────────────────

export async function createRequest(actor: Actor, input: RequestInput, ctx?: AuditContext) {
  assertCan(actor, "requests.create");
  const d = requestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await assertRefs(tx, d);
    const number = await nextNumber(tx, "REQ", d.receivedAt!.getUTCFullYear());
    const r = await tx.request.create({
      data: {
        number,
        receivedAt: d.receivedAt!,
        applicantName: d.applicantName,
        applicantId: d.applicantId ?? null,
        type: d.type,
        description: d.description,
        authorityId: d.authorityId ?? null,
        ownerId: d.ownerId ?? null,
        priority: d.priority,
        followUpDate: d.followUpDate,
        status: "NEW",
        lastAction: "تسجيل الطلب",
        createdById: actor.id,
      },
      select: AUDIT_FIELDS,
    });
    await tx.requestEvent.create({ data: { requestId: r.id, userId: actor.id, kind: "created", toStatus: "NEW", note: "تسجيل الطلب" } });
    await writeAudit(tx, { actor, action: "request.create", entityType: "Request", entityId: r.id, after: r, ctx });
    await notifyNewRequest(tx, actor, r);
    return r;
  });
}

export async function updateRequest(actor: Actor, id: string, input: RequestInput, ctx?: AuditContext) {
  assertCan(actor, "requests.update");
  const d = requestSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    if (before.status === "CLOSED") throw new AppError("الطلب مغلق. أعد فتحه أولاً لتعديل بياناته");
    await assertRefs(tx, d);
    const after = await tx.request.update({
      where: { id },
      data: {
        receivedAt: d.receivedAt!,
        applicantName: d.applicantName,
        applicantId: d.applicantId ?? null,
        type: d.type,
        description: d.description,
        authorityId: d.authorityId ?? null,
        ownerId: d.ownerId ?? null,
        priority: d.priority,
        followUpDate: d.followUpDate,
      },
      select: AUDIT_FIELDS,
    });
    await tx.requestEvent.create({ data: { requestId: id, userId: actor.id, kind: "updated", note: "تعديل بيانات الطلب" } });
    await writeAudit(tx, { actor, action: "request.update", entityType: "Request", entityId: id, before, after, ctx });
    return after;
  });
}

export const transitionSchema = z.object({
  to: z.enum(["NEW", "UNDER_REVIEW", "REFERRED", "FOLLOWING", "DONE", "FAILED", "CLOSED"]),
  note: z.string().trim().min(3, "يرجى كتابة الإجراء المتخذ").max(1000),
  failureReason: optText(1000),
  authorityId: z.coerce.number().int().positive().optional().nullable().catch(null),
  followUpDate: dayField("موعد المتابعة غير صحيح"),
});

/// تغيير حالة الطلب مع تسجيل الإجراء في السجل الزمني. لا يعرض النظام أي وعد بالإنجاز: الحالة هي ما سُجِّل فعلاً.
export async function transitionRequest(actor: Actor, id: string, input: z.input<typeof transitionSchema>, ctx?: AuditContext) {
  const d = transitionSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    const from = before.status;
    if (!TRANSITIONS[from].includes(d.to)) throw new AppError(`لا يمكن نقل الطلب من «${REQUEST_STATUS[from].label}» إلى «${REQUEST_STATUS[d.to].label}»`);
    assertCan(actor, needsClosePermission(from, d.to) ? "requests.close" : "requests.update");
    if (d.to === "FAILED" && !d.failureReason) throw new AppError("يرجى ذكر سبب التعذر");
    const authorityId = d.authorityId ?? before.authorityId;
    if (d.to === "REFERRED" && !authorityId) throw new AppError("يرجى تحديد الجهة المختصة التي أُحيل إليها الطلب");
    if (d.authorityId && !(await tx.authority.findFirst({ where: { id: d.authorityId } }))) throw new AppError("الجهة المختصة غير موجودة");
    if (d.followUpDate && d.followUpDate < before.receivedAt) throw new AppError("موعد المتابعة قبل تاريخ الاستلام");
    const data: Prisma.RequestUncheckedUpdateInput = { status: d.to, lastAction: d.note, authorityId };
    if (d.followUpDate) data.followUpDate = d.followUpDate;
    if (d.to === "FAILED") data.failureReason = d.failureReason;
    // سبب التعذر يبقى عند الإغلاق ليعرف أن الإغلاق كان على تعذر، ويُمسح عند العودة للمتابعة
    else if (d.to !== "CLOSED") data.failureReason = null;
    if (d.to === "CLOSED") {
      data.closedAt = new Date();
      data.closedById = actor.id;
    } else if (from === "CLOSED") {
      data.closedAt = null;
      data.closedById = null;
    }
    const after = await tx.request.update({ where: { id }, data, select: AUDIT_FIELDS });
    const kind = d.to === "CLOSED" ? "closed" : from === "CLOSED" ? "reopened" : "status";
    await tx.requestEvent.create({ data: { requestId: id, userId: actor.id, kind, fromStatus: from, toStatus: d.to, note: d.note } });
    await writeAudit(tx, { actor, action: `request.${kind}`, entityType: "Request", entityId: id, before, after, reason: d.note, ctx });
    return after;
  });
}

/// تسجيل إجراء متابعة دون تغيير الحالة (اتصال، مراجعة، رد جزئي...) مع إمكانية تحديد موعد متابعة جديد
export async function addRequestAction(actor: Actor, id: string, input: { note: string; followUpDate?: string }, ctx?: AuditContext) {
  assertCan(actor, "requests.update");
  const note = z.string().trim().min(3, "يرجى كتابة الإجراء المتخذ").max(1000).parse(input.note);
  const followUpDate = parseDay(input.followUpDate || null);
  return prisma.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    if (before.status === "CLOSED") throw new AppError("الطلب مغلق");
    if (followUpDate && followUpDate < before.receivedAt) throw new AppError("موعد المتابعة قبل تاريخ الاستلام");
    const after = await tx.request.update({ where: { id }, data: { lastAction: note, ...(followUpDate ? { followUpDate } : {}) }, select: AUDIT_FIELDS });
    await tx.requestEvent.create({ data: { requestId: id, userId: actor.id, kind: "action", note: followUpDate ? `${note} (موعد المتابعة الجديد ${dayInText(followUpDate)})` : note } });
    await writeAudit(tx, { actor, action: "request.action", entityType: "Request", entityId: id, before, after, reason: note, ctx });
    return after;
  });
}

export async function deleteRequest(actor: Actor, id: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "requests.delete");
  if (reason.trim().length < 3) throw new AppError("يرجى ذكر سبب الحذف");
  return prisma.$transaction(async (tx) => {
    const before = await lockRequest(tx, id);
    const after = await tx.request.update({ where: { id }, data: { deletedAt: new Date() }, select: AUDIT_FIELDS });
    await tx.requestEvent.create({ data: { requestId: id, userId: actor.id, kind: "deleted", note: reason } });
    await writeAudit(tx, { actor, action: "request.delete", entityType: "Request", entityId: id, before, after, reason, ctx });
  });
}

// ─────────────────────────── البحث والقراءة ───────────────────────────

const statusList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter((s): s is RequestStatus => s in REQUEST_STATUS) : []))
  .catch([]);

export const requestFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(["ADMINISTRATIVE", "PUBLIC_SERVICE", "INQUIRY", "TRANSACTION", "OTHER"]).optional().catch(undefined),
  /// حالة أو أكثر مفصولة بفواصل
  status: statusList,
  /// done: منجز أو مغلق دون تعذر — failed: متعذر أو مغلق على تعذر
  outcome: z.enum(["done", "failed"]).optional().catch(undefined),
  overdue: z.enum(["1"]).optional().catch(undefined),
  owner: z.union([z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  applicant: z.string().uuid().optional().catch(undefined),
  sort: z.enum(["createdAt", "receivedAt", "followUpDate", "priority"]).default("createdAt").catch("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});
export type RequestFilter = z.infer<typeof requestFilterSchema>;

export const overdueWhere = (): Prisma.RequestWhereInput => ({ status: { in: OPEN_STATUSES }, followUpDate: { lt: today() } });
export const doneWhere: Prisma.RequestWhereInput = { OR: [{ status: "DONE" }, { status: "CLOSED", failureReason: null }] };
export const failedWhere: Prisma.RequestWhereInput = { OR: [{ status: "FAILED" }, { status: "CLOSED", failureReason: { not: null } }] };

export function requestWhere(f: RequestFilter): Prisma.RequestWhereInput {
  const and: Prisma.RequestWhereInput[] = [{ deletedAt: null }];
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { applicantName: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.type) and.push({ type: f.type });
  if (f.status.length) and.push({ status: { in: f.status } });
  if (f.outcome === "done") and.push(doneWhere);
  if (f.outcome === "failed") and.push(failedWhere);
  if (f.overdue) and.push(overdueWhere());
  if (f.owner) and.push({ ownerId: f.owner === "none" ? null : f.owner });
  if (f.priority) and.push({ priority: f.priority });
  if (f.applicant) and.push({ applicantId: f.applicant });
  if (f.from) and.push({ receivedAt: { gte: parseDay(f.from)! } });
  if (f.to) and.push({ receivedAt: { lte: parseDay(f.to)! } });
  return { AND: and };
}

function orderBy(f: RequestFilter): Prisma.RequestOrderByWithRelationInput[] {
  if (f.sort === "followUpDate") return [{ followUpDate: { sort: f.dir, nulls: "last" } }, { createdAt: "desc" }];
  return [{ [f.sort]: f.dir }, { createdAt: "desc" }];
}

export async function listRequests(f: RequestFilter) {
  const where = requestWhere(f);
  const [total, rows] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: orderBy(f),
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { owner: { select: { fullName: true } }, authority: { select: { name: true } } },
    }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function isOverdue(r: { status: RequestStatus; followUpDate: Date | null }) {
  return !!r.followUpDate && OPEN_STATUSES.includes(r.status) && r.followUpDate < today();
}

export async function getRequest(id: string) {
  const r = await prisma.request.findFirst({
    where: { id, deletedAt: null },
    include: {
      owner: { select: { id: true, fullName: true } },
      authority: { select: { id: true, name: true } },
      applicant: { select: { id: true, serial: true, fullName: true } },
      createdBy: { select: { fullName: true } },
      events: { orderBy: { id: "desc" }, include: { user: { select: { fullName: true } } } },
      tasks: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true, status: true, consentStatus: true, progress: true, dueDate: true } },
    },
  });
  if (!r) throw notFound();
  return r;
}

export async function requestFormOptions() {
  const [authorities, owners] = await Promise.all([
    prisma.authority.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
  ]);
  return { authorities, owners };
}

export async function exportRequests(actor: Actor, f: RequestFilter, ctx?: AuditContext) {
  assertCan(actor, "requests.view");
  const rows = await prisma.request.findMany({
    where: requestWhere(f),
    orderBy: orderBy(f),
    take: 50_000,
    include: { owner: { select: { fullName: true } }, authority: { select: { name: true } } },
  });
  const wb = newWorkbook();
  const ws = addSheet(wb, f.overdue ? "الطلبات المتأخرة" : "الطلبات", [
    { header: "رقم الطلب", key: "number", width: 16 },
    { header: "تاريخ الاستلام", key: "receivedAt", width: 14 },
    { header: "مقدم الطلب", key: "applicant", width: 26 },
    { header: "نوع الطلب", key: "type", width: 16 },
    { header: "وصف الطلب", key: "description", width: 44 },
    { header: "الجهة المختصة", key: "authority", width: 22 },
    { header: "المسؤول عن المتابعة", key: "owner", width: 22 },
    { header: "الأولوية", key: "priority", width: 10 },
    { header: "الحالة", key: "status", width: 20 },
    { header: "آخر إجراء", key: "lastAction", width: 36 },
    { header: "موعد المتابعة", key: "followUpDate", width: 14 },
    { header: "أيام التأخر", key: "late", width: 12 },
    { header: "تاريخ الإغلاق", key: "closedAt", width: 18 },
    { header: "سبب التعذر", key: "failureReason", width: 30 },
  ]);
  const t = today();
  for (const r of rows) {
    ws.addRow({
      number: r.number,
      receivedAt: fmtDay(r.receivedAt),
      applicant: r.applicantName,
      type: REQUEST_TYPE[r.type],
      description: r.description,
      authority: r.authority?.name ?? "",
      owner: r.owner?.fullName ?? "",
      priority: PRIORITY[r.priority].label,
      status: REQUEST_STATUS[r.status].label,
      lastAction: r.lastAction ?? "",
      followUpDate: fmtDay(r.followUpDate),
      late: isOverdue(r) ? Math.round((t.getTime() - r.followUpDate!.getTime()) / 86_400_000) : "",
      closedAt: r.closedAt ? fmtDateTime(r.closedAt) : "",
      failureReason: r.failureReason ?? "",
    });
  }
  await prisma.$transaction((tx) => writeAudit(tx, { actor, action: "request.export", entityType: "Request", after: { filters: f, count: rows.length }, ctx }));
  return { buf: await toBuffer(wb), count: rows.length };
}
