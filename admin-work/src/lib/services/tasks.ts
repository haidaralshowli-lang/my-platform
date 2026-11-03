import { Prisma, type TaskStatus } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac";
import { nextNumber } from "@/lib/numbering";
import { addSheet, newWorkbook, toBuffer } from "@/lib/excel";
import { CONSENT, PRIORITY, TASK_STATUS } from "@/lib/labels";
import { dayInText, fmtDay, parseDay, today } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";

export const PAGE_SIZE = 25;

/// الحالات التي تُحتسب فيها المهمة جارية (يُتابَع موعدها)
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "STUCK"];
/// الحالات التي يستطيع المنفذ تسجيلها عند تحديث الإنجاز
export const PROGRESS_STATUSES = ["IN_PROGRESS", "WAITING", "STUCK", "DONE"] as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

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

const AUDIT_FIELDS = {
  id: true,
  number: true,
  title: true,
  details: true,
  assigneeId: true,
  requestId: true,
  dueDate: true,
  priority: true,
  status: true,
  progress: true,
  consentStatus: true,
  consentNote: true,
  proposedDueDate: true,
  obstacles: true,
  finalResult: true,
  closedAt: true,
  deletedAt: true,
} as const;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof AUDIT_FIELDS }>;

async function lockTask(tx: Tx, id: string): Promise<TaskRow> {
  await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id}::uuid FOR UPDATE`;
  const t = await tx.task.findFirst({ where: { id, deletedAt: null }, select: AUDIT_FIELDS });
  if (!t) throw notFound();
  return t;
}

function assertOpen(t: TaskRow) {
  if (t.closedAt) throw new AppError("المهمة مغلقة. يلزم إعادة فتحها أولاً");
  if (t.status === "CANCELLED") throw new AppError("المهمة ملغاة");
}

async function assertAssignee(tx: Tx, personId: string) {
  if (!(await tx.person.findFirst({ where: { id: personId, deletedAt: null } }))) throw new AppError("الشخص المكلف غير موجود في قاعدة البيانات");
}

async function assertRequest(tx: Tx, requestId: string | null | undefined) {
  if (!requestId) return;
  const r = await tx.request.findFirst({ where: { id: requestId, deletedAt: null }, select: { status: true } });
  if (!r) throw new AppError("الطلب المرتبط غير موجود");
  if (r.status === "CLOSED") throw new AppError("لا تُربط مهمة جديدة بطلب مغلق");
}

async function log(
  tx: Tx,
  actor: Actor,
  t: { before: TaskRow; after: TaskRow },
  kind: string,
  note: string | null,
  ctx?: AuditContext,
) {
  await tx.taskEvent.create({
    data: {
      taskId: t.after.id,
      userId: actor.id,
      kind,
      fromStatus: t.before.status !== t.after.status ? t.before.status : null,
      toStatus: t.before.status !== t.after.status ? t.after.status : null,
      progress: t.before.progress !== t.after.progress ? t.after.progress : null,
      note,
    },
  });
  await writeAudit(tx, { actor, action: `task.${kind}`, entityType: "Task", entityId: t.after.id, before: t.before, after: t.after, reason: note, ctx });
}

// ─────────────────────────── الإنشاء والتعديل ───────────────────────────

export const taskSchema = z
  .object({
    title: z.string().trim().min(3, "عنوان المهمة مطلوب").max(200),
    details: optText(4000),
    assigneeId: z.string({ message: "يرجى اختيار الشخص المكلف" }).uuid("يرجى اختيار الشخص المكلف"),
    dueDate: dayField("الموعد المحدد غير صحيح"),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    requestId: z.string().uuid().optional().nullable().catch(null),
  })
  .superRefine((d, ctx) => {
    if (!d.dueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "الموعد المحدد مطلوب" });
    else if (d.dueDate < today()) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "الموعد المحدد لا يكون في الماضي" });
  });

export type TaskInput = z.input<typeof taskSchema>;

/// تُنشأ المهمة «بانتظار موافقة المكلف». لا تصبح تكليفاً نافذاً إلا بعد تسجيل موافقته على المهمة والموعد.
export async function createTask(actor: Actor, input: TaskInput, ctx?: AuditContext) {
  assertCan(actor, "tasks.create");
  const d = taskSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await assertAssignee(tx, d.assigneeId);
    await assertRequest(tx, d.requestId);
    const number = await nextNumber(tx, "TSK", today().getUTCFullYear());
    const t = await tx.task.create({
      data: {
        number,
        title: d.title,
        details: d.details,
        assigneeId: d.assigneeId,
        dueDate: d.dueDate!,
        priority: d.priority,
        requestId: d.requestId ?? null,
        status: "NOT_STARTED",
        consentStatus: "PENDING",
        createdById: actor.id,
      },
      select: AUDIT_FIELDS,
    });
    await tx.taskEvent.create({ data: { taskId: t.id, userId: actor.id, kind: "created", toStatus: "NOT_STARTED", note: "إنشاء المهمة بانتظار موافقة المكلف" } });
    await writeAudit(tx, { actor, action: "task.create", entityType: "Task", entityId: t.id, after: t, ctx });
    if (d.requestId) {
      await tx.requestEvent.create({ data: { requestId: d.requestId, userId: actor.id, kind: "task_linked", note: `ربط المهمة ${number}: ${d.title}` } });
    }
    return t;
  });
}

export const taskDetailsSchema = z.object({
  title: z.string().trim().min(3, "عنوان المهمة مطلوب").max(200),
  details: optText(4000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueDate: dayField("الموعد المحدد غير صحيح"),
});

/// تعديل بيانات المهمة. الموعد لا يتغير هنا بعد موافقة المكلف، بل عبر «طلب تعديل الموعد».
export async function updateTaskDetails(actor: Actor, id: string, input: z.input<typeof taskDetailsSchema>, ctx?: AuditContext) {
  assertCan(actor, "tasks.update");
  const d = taskDetailsSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    const data: Prisma.TaskUncheckedUpdateInput = { title: d.title, details: d.details, priority: d.priority, lastUpdateAt: new Date() };
    if (d.dueDate && d.dueDate.getTime() !== before.dueDate.getTime()) {
      if (before.consentStatus === "ACCEPTED" || before.consentStatus === "CHANGE_REQUESTED")
        throw new AppError("الموعد متفق عليه مع المكلف. يُعدَّل عبر طلب تعديل الموعد وموافقة الطرفين");
      if (d.dueDate < today()) throw new AppError("الموعد المحدد لا يكون في الماضي");
      data.dueDate = d.dueDate;
    }
    const after = await tx.task.update({ where: { id }, data, select: AUDIT_FIELDS });
    await log(tx, actor, { before, after }, "updated", "تعديل بيانات المهمة", ctx);
    return after;
  });
}

// ─────────────────────────── موافقة المكلف ───────────────────────────

export const consentSchema = z.object({
  response: z.enum(["ACCEPT", "DECLINE", "REQUEST_CHANGE"]),
  note: optText(1000),
  proposedDueDate: dayField("الموعد المقترح غير صحيح"),
});

/// تسجيل رد الشخص المكلف: الموافقة على المهمة وموعدها، أو الاعتذار، أو طلب تعديل الموعد. كل رد موثق في السجل.
export async function recordConsent(actor: Actor, id: string, input: z.input<typeof consentSchema>, ctx?: AuditContext) {
  assertCan(actor, "tasks.update");
  const d = consentSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    if (before.status === "DONE") throw new AppError("المهمة منجزة");
    const data: Prisma.TaskUncheckedUpdateInput = { consentAt: new Date(), consentNote: d.note, lastUpdateAt: new Date() };
    let kind: string;
    let note: string;
    if (d.response === "ACCEPT") {
      if (before.consentStatus !== "PENDING") throw new AppError("الموافقة تُسجَّل للمهمة التي بانتظار موافقة المكلف فقط");
      Object.assign(data, { consentStatus: "ACCEPTED", proposedDueDate: null });
      kind = "accepted";
      note = `وافق المكلف على المهمة والموعد ${dayInText(before.dueDate)}${d.note ? ` — ${d.note}` : ""}`;
    } else if (d.response === "DECLINE") {
      if (before.consentStatus === "DECLINED") throw new AppError("الاعتذار مسجل مسبقاً");
      if (!d.note || d.note.length < 3) throw new AppError("يرجى تسجيل سبب الاعتذار");
      Object.assign(data, { consentStatus: "DECLINED", proposedDueDate: null });
      // الاعتذار بعد البدء يوقف التنفيذ حتى يُعاد الإسناد أو تُلغى المهمة
      if (before.status !== "NOT_STARTED") data.status = "WAITING";
      kind = "declined";
      note = `اعتذر المكلف عن المهمة: ${d.note}`;
    } else {
      if (before.consentStatus === "DECLINED") throw new AppError("المكلف معتذر عن المهمة. أعد إسنادها أو ألغها");
      if (!d.proposedDueDate) throw new AppError("يرجى تحديد الموعد المقترح");
      if (d.proposedDueDate < today()) throw new AppError("الموعد المقترح لا يكون في الماضي");
      if (d.proposedDueDate.getTime() === before.dueDate.getTime()) throw new AppError("الموعد المقترح يساوي الموعد الحالي");
      Object.assign(data, { consentStatus: "CHANGE_REQUESTED", proposedDueDate: d.proposedDueDate });
      kind = "change_requested";
      note = `طلب المكلف تعديل الموعد من ${dayInText(before.dueDate)} إلى ${dayInText(d.proposedDueDate)}${d.note ? ` — ${d.note}` : ""}`;
    }
    const after = await tx.task.update({ where: { id }, data, select: AUDIT_FIELDS });
    await log(tx, actor, { before, after }, kind, note, ctx);
    return after;
  });
}

/// قرار الإدارة على طلب تعديل الموعد: القبول يعتمد الموعد المقترح ويجعل التكليف نافذاً (لأن المكلف اقترحه)،
/// والرفض يعيد المهمة بانتظار موافقة المكلف على الموعد الأصلي.
export async function decideDueDateChange(actor: Actor, id: string, approve: boolean, note: string | null, ctx?: AuditContext) {
  assertCan(actor, "tasks.update");
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    if (before.consentStatus !== "CHANGE_REQUESTED" || !before.proposedDueDate) throw new AppError("لا يوجد طلب تعديل موعد بانتظار القرار");
    const after = await tx.task.update({
      where: { id },
      data: approve
        ? { dueDate: before.proposedDueDate, proposedDueDate: null, consentStatus: "ACCEPTED", consentAt: new Date(), lastUpdateAt: new Date() }
        : { proposedDueDate: null, consentStatus: "PENDING", lastUpdateAt: new Date() },
      select: AUDIT_FIELDS,
    });
    const text = approve
      ? `اعتُمد الموعد الجديد ${dayInText(before.proposedDueDate)} بدلاً من ${dayInText(before.dueDate)}`
      : `رُفض طلب تعديل الموعد، والموعد يبقى ${dayInText(before.dueDate)} بانتظار موافقة المكلف`;
    await log(tx, actor, { before, after }, approve ? "change_approved" : "change_rejected", note ? `${text} — ${note}` : text, ctx);
    return after;
  });
}

export const reassignSchema = z.object({
  assigneeId: z.string({ message: "يرجى اختيار الشخص المكلف" }).uuid("يرجى اختيار الشخص المكلف"),
  dueDate: dayField("الموعد المحدد غير صحيح"),
  note: optText(1000),
});

/// إعادة إسناد المهمة لشخص آخر (بعد اعتذار المكلف أو قبل موافقته). تعود المهمة بانتظار موافقة المكلف الجديد.
export async function reassignTask(actor: Actor, id: string, input: z.input<typeof reassignSchema>, ctx?: AuditContext) {
  assertCan(actor, "tasks.update");
  const d = reassignSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    if (before.consentStatus === "ACCEPTED") throw new AppError("المكلف الحالي وافق على المهمة. يُعاد الإسناد بعد تسجيل اعتذاره");
    if (d.assigneeId === before.assigneeId) throw new AppError("اختر شخصاً غير المكلف الحالي");
    await assertAssignee(tx, d.assigneeId);
    if (d.dueDate && d.dueDate < today()) throw new AppError("الموعد المحدد لا يكون في الماضي");
    const person = await tx.person.findUniqueOrThrow({ where: { id: d.assigneeId }, select: { fullName: true, serial: true } });
    const after = await tx.task.update({
      where: { id },
      data: {
        assigneeId: d.assigneeId,
        dueDate: d.dueDate ?? before.dueDate,
        consentStatus: "PENDING",
        consentAt: null,
        consentNote: null,
        proposedDueDate: null,
        assignedAt: new Date(),
        status: before.progress > 0 ? "WAITING" : "NOT_STARTED",
        lastUpdateAt: new Date(),
      },
      select: AUDIT_FIELDS,
    });
    await log(tx, actor, { before, after }, "reassigned", `أُعيد إسناد المهمة إلى ${person.fullName} (رقم ${person.serial})${d.note ? ` — ${d.note}` : ""}`, ctx);
    return after;
  });
}

// ─────────────────────────── الإنجاز والإغلاق ───────────────────────────

export const progressSchema = z.object({
  status: z.enum(PROGRESS_STATUSES),
  progress: z.coerce.number({ message: "نسبة الإنجاز مطلوبة" }).int().min(0, "بين 0 و100").max(100, "بين 0 و100"),
  obstacles: optText(2000),
  finalResult: optText(2000),
  note: optText(1000),
});

/// تحديث مرحلة الإنجاز. لا يُسمح به إلا للتكليف النافذ (بعد موافقة المكلف).
export async function updateProgress(actor: Actor, id: string, input: z.input<typeof progressSchema>, ctx?: AuditContext) {
  assertCan(actor, "tasks.update");
  const d = progressSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    if (before.consentStatus !== "ACCEPTED") throw new AppError("لا تتحول المهمة إلى تكليف نافذ قبل موافقة المكلف على المهمة والموعد. سجّل موافقته أولاً");
    if (d.status === "STUCK" && !(d.obstacles ?? before.obstacles)) throw new AppError("يرجى تسجيل المعوقات عند تعثر المهمة");
    if (d.status === "DONE" && !d.finalResult) throw new AppError("يرجى تسجيل النتيجة النهائية للمهمة المنجزة");
    const progress = d.status === "DONE" ? 100 : d.progress;
    if (d.status !== "DONE" && progress === 100) throw new AppError("نسبة 100% تعني الإنجاز. اختر الحالة «منجزة» وسجّل النتيجة");
    const after = await tx.task.update({
      where: { id },
      data: {
        status: d.status,
        progress,
        // المعوقات الحالية: ما سُجِّل الآن، أو السابقة إذا بقيت المهمة متعثرة (تاريخها كاملاً في السجل الزمني)
        obstacles: d.obstacles ?? (d.status === "STUCK" ? before.obstacles : null),
        finalResult: d.status === "DONE" ? d.finalResult : null,
        lastUpdateAt: new Date(),
      },
      select: AUDIT_FIELDS,
    });
    const parts = [`${TASK_STATUS[after.status].label} — \u2066${after.progress}%\u2069`, d.note, d.obstacles ? `المعوقات: ${d.obstacles}` : null, d.finalResult ? `النتيجة: ${d.finalResult}` : null];
    await log(tx, actor, { before, after }, "progress", parts.filter(Boolean).join(" — "), ctx);
    return after;
  });
}

/// اعتماد إغلاق مهمة منجزة (صلاحية المدير)
export async function approveTaskClosure(actor: Actor, id: string, note: string | null, ctx?: AuditContext) {
  assertCan(actor, "tasks.close");
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    if (before.closedAt) throw new AppError("المهمة مغلقة مسبقاً");
    if (before.status !== "DONE") throw new AppError("يُعتمد إغلاق المهمة المنجزة فقط");
    const after = await tx.task.update({ where: { id }, data: { closedAt: new Date(), closedById: actor.id, lastUpdateAt: new Date() }, select: AUDIT_FIELDS });
    await log(tx, actor, { before, after }, "closed", note ? `اعتماد الإغلاق — ${note}` : "اعتماد الإغلاق", ctx);
    return after;
  });
}

export async function reopenTask(actor: Actor, id: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "tasks.close");
  if (reason.trim().length < 3) throw new AppError("يرجى ذكر سبب إعادة الفتح");
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    if (!before.closedAt && before.status !== "CANCELLED" && before.status !== "DONE") throw new AppError("المهمة ليست مغلقة أو منجزة");
    const after = await tx.task.update({
      where: { id },
      data: { closedAt: null, closedById: null, status: before.consentStatus === "ACCEPTED" ? "IN_PROGRESS" : "NOT_STARTED", progress: Math.min(before.progress, 99), lastUpdateAt: new Date() },
      select: AUDIT_FIELDS,
    });
    await log(tx, actor, { before, after }, "reopened", `إعادة فتح: ${reason}`, ctx);
    return after;
  });
}

export async function cancelTask(actor: Actor, id: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "tasks.close");
  if (reason.trim().length < 3) throw new AppError("يرجى ذكر سبب الإلغاء");
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    assertOpen(before);
    if (before.status === "DONE") throw new AppError("المهمة منجزة؛ اعتمد إغلاقها بدلاً من إلغائها");
    const after = await tx.task.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: actor.id, lastUpdateAt: new Date() }, select: AUDIT_FIELDS });
    await log(tx, actor, { before, after }, "cancelled", `إلغاء: ${reason}`, ctx);
    return after;
  });
}

export async function deleteTask(actor: Actor, id: string, reason: string, ctx?: AuditContext) {
  assertCan(actor, "tasks.delete");
  if (reason.trim().length < 3) throw new AppError("يرجى ذكر سبب الحذف");
  return prisma.$transaction(async (tx) => {
    const before = await lockTask(tx, id);
    const after = await tx.task.update({ where: { id }, data: { deletedAt: new Date() }, select: AUDIT_FIELDS });
    await log(tx, actor, { before, after }, "deleted", reason, ctx);
  });
}

// ─────────────────────────── البحث والقراءة ───────────────────────────

export const taskFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter((s): s is TaskStatus => s in TASK_STATUS) : []))
    .catch([]),
  consent: z.enum(["PENDING", "ACCEPTED", "DECLINED", "CHANGE_REQUESTED"]).optional().catch(undefined),
  assignee: z.string().uuid().optional().catch(undefined),
  request: z.string().uuid().optional().catch(undefined),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional().catch(undefined),
  overdue: z.enum(["1"]).optional().catch(undefined),
  /// منجزة بانتظار اعتماد الإغلاق
  awaitingClose: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(["createdAt", "dueDate", "progress", "lastUpdateAt"]).default("createdAt").catch("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  page: z.coerce.number().int().min(1).max(100000).default(1).catch(1),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

/// المهمة المتأخرة: تكليف نافذ لم يُنجز وفات موعده
export const overdueTaskWhere = (): Prisma.TaskWhereInput => ({ consentStatus: "ACCEPTED", status: { in: ACTIVE_TASK_STATUSES }, dueDate: { lt: today() } });

export function isTaskOverdue(t: { consentStatus: string; status: TaskStatus; dueDate: Date }) {
  return t.consentStatus === "ACCEPTED" && ACTIVE_TASK_STATUSES.includes(t.status) && t.dueDate < today();
}

export function taskWhere(f: TaskFilter): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [{ deletedAt: null }];
  if (f.q) and.push({ OR: [{ number: { contains: f.q, mode: "insensitive" } }, { title: { contains: f.q, mode: "insensitive" } }, { assignee: { fullName: { contains: f.q, mode: "insensitive" } } }] });
  if (f.status.length) and.push({ status: { in: f.status } });
  if (f.consent) and.push({ consentStatus: f.consent });
  if (f.assignee) and.push({ assigneeId: f.assignee });
  if (f.request) and.push({ requestId: f.request });
  if (f.priority) and.push({ priority: f.priority });
  if (f.overdue) and.push(overdueTaskWhere());
  if (f.awaitingClose) and.push({ status: "DONE", closedAt: null });
  return { AND: and };
}

export async function listTasks(f: TaskFilter) {
  const where = taskWhere(f);
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy: [{ [f.sort]: f.dir }, { createdAt: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { assignee: { select: { id: true, serial: true, fullName: true } }, request: { select: { id: true, number: true } } },
    }),
  ]);
  return { total, rows, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getTask(id: string) {
  const t = await prisma.task.findFirst({
    where: { id, deletedAt: null },
    include: {
      assignee: { select: { id: true, serial: true, fullName: true, phone: true } },
      request: { select: { id: true, number: true, applicantName: true, status: true } },
      createdBy: { select: { fullName: true } },
      events: { orderBy: { id: "desc" }, include: { user: { select: { fullName: true } } } },
    },
  });
  if (!t) throw notFound();
  return t;
}

export async function exportTasks(actor: Actor, f: TaskFilter, ctx?: AuditContext) {
  assertCan(actor, "tasks.view");
  const rows = await prisma.task.findMany({
    where: taskWhere(f),
    orderBy: [{ [f.sort]: f.dir }, { createdAt: "desc" }],
    take: 50_000,
    include: { assignee: { select: { serial: true, fullName: true } }, request: { select: { number: true } } },
  });
  const wb = newWorkbook();
  const ws = addSheet(wb, "المهام", [
    { header: "رقم المهمة", key: "number", width: 16 },
    { header: "عنوان المهمة", key: "title", width: 34 },
    { header: "الشخص المكلف", key: "assignee", width: 26 },
    { header: "موافقة المكلف", key: "consent", width: 22 },
    { header: "تاريخ التكليف", key: "assignedAt", width: 18 },
    { header: "الموعد المحدد", key: "dueDate", width: 14 },
    { header: "الأولوية", key: "priority", width: 10 },
    { header: "الحالة", key: "status", width: 14 },
    { header: "نسبة الإنجاز", key: "progress", width: 12 },
    { header: "متأخرة", key: "overdue", width: 10 },
    { header: "آخر تحديث", key: "lastUpdateAt", width: 18 },
    { header: "المعوقات", key: "obstacles", width: 34 },
    { header: "النتيجة النهائية", key: "finalResult", width: 34 },
    { header: "الطلب المرتبط", key: "request", width: 16 },
    { header: "مغلقة في", key: "closedAt", width: 18 },
  ]);
  for (const t of rows) {
    ws.addRow({
      number: t.number,
      title: t.title,
      assignee: `${t.assignee.fullName} (${t.assignee.serial})`,
      consent: CONSENT[t.consentStatus].label,
      assignedAt: fmtDateTime(t.assignedAt),
      dueDate: fmtDay(t.dueDate),
      priority: PRIORITY[t.priority].label,
      status: TASK_STATUS[t.status].label,
      progress: `${t.progress}%`,
      overdue: isTaskOverdue(t) ? "نعم" : "",
      lastUpdateAt: fmtDateTime(t.lastUpdateAt),
      obstacles: t.obstacles ?? "",
      finalResult: t.finalResult ?? "",
      request: t.request?.number ?? "",
      closedAt: t.closedAt ? fmtDateTime(t.closedAt) : "",
    });
  }
  await prisma.$transaction((tx) => writeAudit(tx, { actor, action: "task.export", entityType: "Task", after: { filters: f, count: rows.length }, ctx }));
  return { buf: await toBuffer(wb), count: rows.length };
}
