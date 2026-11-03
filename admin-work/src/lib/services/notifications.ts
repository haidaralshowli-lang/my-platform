import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { effectivePermissions, type Actor, type Permission } from "@/lib/rbac";
import { getSetting } from "@/lib/settings";
import { addDays, dayInText, today } from "@/lib/dates";
import { OPEN_STATUSES } from "./requests";
import { ACTIVE_TASK_STATUSES } from "./tasks";

/// أنواع التنبيهات كما وردت في وثيقة المتطلبات
export const NOTIFICATION_KINDS = {
  request_new: "طلب جديد",
  request_due: "اقتراب موعد متابعة طلب",
  request_overdue: "تأخر طلب عن موعده",
  task_new: "إسناد مهمة جديدة",
  task_due: "اقتراب موعد إنجاز مهمة",
  task_overdue: "تأخر إنجاز مهمة",
  people_stale: "سجلات لم تُحدَّث منذ مدة",
} as const;
export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

type NewNotification = {
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /// مفتاح يمنع تكرار التنبيه نفسه للمستخدم نفسه
  dedupeKey: string;
};

/// المستخدمون النشطون الذين يملكون صلاحية معينة
async function usersWith(db: Db, perm: Permission): Promise<string[]> {
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, role: true, permissions: true } });
  return users.filter((u) => effectivePermissions(u.role, u.permissions).has(perm)).map((u) => u.id);
}

/// المستلمون: المسؤول المحدد إن كان نشطاً ويملك الصلاحية، وإلا جميع من يملكون الصلاحية
async function recipients(db: Db, perm: Permission, ownerId?: string | null, exclude?: string): Promise<string[]> {
  const all = await usersWith(db, perm);
  const list = ownerId && all.includes(ownerId) ? [ownerId] : all;
  return list.filter((id) => id !== exclude);
}

async function notify(db: Db, userIds: string[], n: NewNotification): Promise<number> {
  if (userIds.length === 0) return 0;
  const r = await db.notification.createMany({
    data: userIds.map((userId) => ({ userId, ...n })),
    skipDuplicates: true,
  });
  return r.count;
}

// ─────────────────────────── تنبيهات فورية ───────────────────────────

/// يُستدعى داخل معاملة تسجيل الطلب
export async function notifyNewRequest(db: Db, actor: Actor, r: { id: string; number: string; applicantName: string; ownerId: string | null }) {
  const users = await usersWith(db, "requests.view");
  const to = [...new Set([...(r.ownerId && users.includes(r.ownerId) ? [r.ownerId] : []), ...users])].filter((id) => id !== actor.id);
  await notify(db, to, {
    kind: "request_new",
    title: `طلب جديد ${r.number}`,
    body: `مقدم الطلب: ${r.applicantName} — سجّله ${actor.fullName}`,
    link: `/requests/${r.id}`,
    entityType: "Request",
    entityId: r.id,
    dedupeKey: `request_new:${r.id}`,
  });
}

/// يُستدعى داخل معاملة إنشاء المهمة أو إعادة إسنادها
export async function notifyTaskAssigned(db: Db, actor: Actor, t: { id: string; number: string; title: string; assigneeName: string; dueDate: Date }, reassigned = false) {
  const to = await recipients(db, "tasks.view", null, actor.id);
  await notify(db, to, {
    kind: "task_new",
    title: `${reassigned ? "إعادة إسناد" : "إسناد"} المهمة ${t.number}`,
    body: `${t.title} — المكلف: ${t.assigneeName}، الموعد ${dayInText(t.dueDate)}. بانتظار تسجيل موافقته.`,
    link: `/tasks/${t.id}`,
    entityType: "Task",
    entityId: t.id,
    dedupeKey: `task_new:${t.id}:${reassigned ? Date.now() : "first"}`,
  });
}

// ─────────────────────────── الفحص الدوري ───────────────────────────

export type ScanResult = Record<"request_due" | "request_overdue" | "task_due" | "task_overdue" | "people_stale", number>;

/// يفحص المواعيد ويولد التنبيهات المستحقة. آمن للتكرار: مفتاح المنع يتضمن الموعد، فلا يتكرر التنبيه
/// إلا إذا تغير الموعد نفسه، ويتكرر تنبيه السجلات القديمة مرة في الأسبوع على الأكثر.
export async function runNotificationScan(now = new Date()): Promise<ScanResult> {
  const t = today(now);
  const [reqDays, taskDays, staleDays] = await Promise.all([
    getSetting(prisma, "requests.reminderDays"),
    getSetting(prisma, "tasks.reminderDays"),
    getSetting(prisma, "people.staleDays"),
  ]);
  const result: ScanResult = { request_due: 0, request_overdue: 0, task_due: 0, task_overdue: 0, people_stale: 0 };

  const openReq: Prisma.RequestWhereInput = { deletedAt: null, status: { in: OPEN_STATUSES } };
  const dueReqs = await prisma.request.findMany({
    where: { ...openReq, followUpDate: { gte: t, lte: addDays(t, reqDays) } },
    select: { id: true, number: true, applicantName: true, ownerId: true, followUpDate: true },
  });
  for (const r of dueReqs) {
    result.request_due += await notify(prisma, await recipients(prisma, "requests.view", r.ownerId), {
      kind: "request_due",
      title: `اقتراب موعد متابعة الطلب ${r.number}`,
      body: `موعد المتابعة ${dayInText(r.followUpDate)} — ${r.applicantName}`,
      link: `/requests/${r.id}`,
      entityType: "Request",
      entityId: r.id,
      dedupeKey: `request_due:${r.id}:${r.followUpDate!.toISOString().slice(0, 10)}`,
    });
  }
  const lateReqs = await prisma.request.findMany({
    where: { ...openReq, followUpDate: { lt: t } },
    select: { id: true, number: true, applicantName: true, ownerId: true, followUpDate: true },
  });
  for (const r of lateReqs) {
    result.request_overdue += await notify(prisma, await recipients(prisma, "requests.view", r.ownerId), {
      kind: "request_overdue",
      title: `الطلب ${r.number} متأخر عن موعد المتابعة`,
      body: `كان موعد المتابعة ${dayInText(r.followUpDate)} — ${r.applicantName}`,
      link: `/requests/${r.id}`,
      entityType: "Request",
      entityId: r.id,
      dedupeKey: `request_overdue:${r.id}:${r.followUpDate!.toISOString().slice(0, 10)}`,
    });
  }

  const activeTask: Prisma.TaskWhereInput = { deletedAt: null, consentStatus: "ACCEPTED", status: { in: ACTIVE_TASK_STATUSES } };
  const taskSelect = { id: true, number: true, title: true, dueDate: true, assignee: { select: { fullName: true } } } as const;
  const taskTo = await recipients(prisma, "tasks.view");
  for (const k of await prisma.task.findMany({ where: { ...activeTask, dueDate: { gte: t, lte: addDays(t, taskDays) } }, select: taskSelect })) {
    result.task_due += await notify(prisma, taskTo, {
      kind: "task_due",
      title: `اقتراب موعد إنجاز المهمة ${k.number}`,
      body: `${k.title} — ${k.assignee.fullName}، الموعد ${dayInText(k.dueDate)}`,
      link: `/tasks/${k.id}`,
      entityType: "Task",
      entityId: k.id,
      dedupeKey: `task_due:${k.id}:${k.dueDate.toISOString().slice(0, 10)}`,
    });
  }
  for (const k of await prisma.task.findMany({ where: { ...activeTask, dueDate: { lt: t } }, select: taskSelect })) {
    result.task_overdue += await notify(prisma, taskTo, {
      kind: "task_overdue",
      title: `تأخر إنجاز المهمة ${k.number}`,
      body: `${k.title} — ${k.assignee.fullName}، كان الموعد ${dayInText(k.dueDate)}`,
      link: `/tasks/${k.id}`,
      entityType: "Task",
      entityId: k.id,
      dedupeKey: `task_overdue:${k.id}:${k.dueDate.toISOString().slice(0, 10)}`,
    });
  }

  // السجلات القديمة: تنبيه مجمّع لكل مسؤول متابعة (أو لمن يملك صلاحية الأشخاص إن لم يُحدَّد مسؤول)، مرة أسبوعياً
  const cutoff = new Date(now.getTime() - staleDays * 86_400_000);
  const stale = await prisma.person.groupBy({ by: ["followUpOwnerId"], where: { deletedAt: null, updatedAt: { lt: cutoff } }, _count: { _all: true } });
  const week = `${t.getUTCFullYear()}-w${Math.floor((t.getTime() / 86_400_000 + 3) / 7)}`;
  for (const g of stale) {
    const to = await recipients(prisma, "people.view", g.followUpOwnerId);
    const q = g.followUpOwnerId ? `status=needs&owner=${g.followUpOwnerId}` : "status=needs&owner=none";
    result.people_stale += await notify(prisma, to, {
      kind: "people_stale",
      title: `${g._count._all} سجلاً لم يُحدَّث منذ أكثر من ${staleDays} يوماً`,
      body: g.followUpOwnerId ? "سجلات أنت مسؤول عن متابعتها" : "سجلات دون مسؤول متابعة",
      link: `/people?${q}`,
      dedupeKey: `people_stale:${g.followUpOwnerId ?? "none"}:${week}`,
    });
  }
  return result;
}

const SCAN_KEY = "notifications.lastScan";
const SCAN_INTERVAL_MS = 60 * 60_000;

/// فحص احتياطي يُشغَّل بعد عرض الصفحات مرة كل ساعة على الأكثر، حتى تعمل التنبيهات دون مهمة مجدولة
export async function maybeRunScan(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: SCAN_KEY } });
  const last = typeof row?.value === "string" ? Date.parse(row.value) : 0;
  if (Date.now() - last < SCAN_INTERVAL_MS) return false;
  // تحديث مشروط يمنع تشغيلين متزامنين
  const stamp = new Date().toISOString();
  const updated = row
    ? await prisma.setting.updateMany({ where: { key: SCAN_KEY, value: { equals: row.value as Prisma.InputJsonValue } }, data: { value: stamp } })
    : await prisma.setting.createMany({ data: [{ key: SCAN_KEY, value: stamp }], skipDuplicates: true });
  if (updated.count === 0) return false;
  await runNotificationScan();
  return true;
}

// ─────────────────────────── القراءة ───────────────────────────

export function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, opts: { unread?: boolean; take?: number; before?: Date }) {
  return prisma.notification.findMany({
    where: { userId, ...(opts.unread ? { readAt: null } : {}), ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
  });
}

export async function markRead(userId: string, id: string) {
  const n = await prisma.notification.findFirst({ where: { id, userId } });
  if (!n) return null;
  if (!n.readAt) await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return n;
}

export async function markAllRead(userId: string) {
  return (await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })).count;
}
