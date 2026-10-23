import type { Violation } from "@prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import type { PermissionCode } from "@/lib/rbac/catalog";

/// المستخدمون الفعالون الذين يملكون إحدى الصلاحيات ويقع ملف المخالفة ضمن نطاقهم
export async function recipientsFor(db: Db, v: Pick<Violation, "governorateId" | "officeId">, perms: PermissionCode[], opts: { excludeCentral?: boolean } = {}): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { permissions: { some: { permission: { code: { in: perms } } } } } } },
    },
    select: {
      id: true, scope: true, governorateId: true, officeId: true,
      roles: { select: { role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
    },
  });
  return users
    .filter((u) => {
      const central = u.scope === "CENTRAL" || u.roles.some((r) => r.role.permissions.some((p) => p.permission.code === "scope.central"));
      if (central) return !opts.excludeCentral;
      if (u.scope === "GOVERNORATE") return u.governorateId === v.governorateId;
      return u.officeId === v.officeId;
    })
    .map((u) => u.id);
}

export type NotifyInput = {
  userIds: string[];
  type: string;
  title: string;
  body?: string | null;
  violationId?: string | null;
  link?: string | null;
  /// مفتاح منع التكرار: الإشعار نفسه لا يُنشأ للمستخدم نفسه مرتين
  dedupeKey: string;
};

/// إنشاء إشعارات دون تكرار (القيد الفريد userId + dedupeKey مع skipDuplicates)
export async function notify(db: Db, n: NotifyInput): Promise<number> {
  const ids = [...new Set(n.userIds)];
  if (ids.length === 0) return 0;
  const r = await db.notification.createMany({
    data: ids.map((userId) => ({
      userId, type: n.type, title: n.title, body: n.body ?? null, violationId: n.violationId ?? null,
      link: n.link ?? (n.violationId ? `/violations/${n.violationId}` : null), dedupeKey: n.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/// من يُشعَر عند كل انتقال: صلاحية الجهة التي تنتظر الإجراء التالي، أو منشئ المعاملة عند الإعادة
const TRANSITION_NOTICES: Record<string, { perms?: PermissionCode[]; creator?: boolean; title: string }> = {
  submit_for_approval: { perms: ["approval.final_registration"], title: "مخالفة بانتظار المصادقة النهائية" },
  final_approve: { perms: ["technical.prepare"], title: "مخالفة مصادق عليها بانتظار الموقف الفني" },
  final_return: { creator: true, title: "أُعيدت المعاملة لاستكمال النواقص" },
  final_reject: { creator: true, title: "لم تتم الموافقة على المخالفة" },
  technical_complete: { perms: ["legal.prepare", "legal.approve"], title: "مخالفة بانتظار الرأي والمصادقة القانونية" },
  legal_clarify: { perms: ["technical.prepare"], title: "طلب إيضاح من الدائرة القانونية" },
  legal_return: { creator: true, title: "أعادت الدائرة القانونية المعاملة للاستكمال" },
  legal_approve: { perms: ["warning.approve_issue"], title: "مخالفة بانتظار الموافقة على إصدار الإنذار" },
  warning_approve: { perms: ["warning.prepare"], title: "تمت الموافقة على إصدار الإنذار" },
  warning_return: { perms: ["legal.prepare"], title: "أُعيدت المعاملة للدائرة القانونية" },
  warning_prepared: { perms: ["warning.upload_signed"], title: "إنذار معد بانتظار التوقيع ورفع النسخة الموقعة" },
  warning_signed: { perms: ["delivery.record"], title: "رُفع الإنذار الموقع وهو بانتظار التبليغ" },
  receipt_recorded: { perms: ["deadline.view"], title: "سُجِّل استلام الإنذار وبدأ احتساب المدة" },
  response_accepted: { creator: true, perms: ["closure.request"], title: "قُبلت الاستجابة والملف بانتظار التحقق النهائي والإغلاق" },
  response_insufficient: { perms: ["deadline.view"], title: "تقرر عدم كفاية الاستجابة واستُؤنفت المدة" },
  removal_approved: { perms: ["closure.request"], title: "اعتُمدت إزالة المخالفة بالكامل والملف بانتظار الإغلاق" },
  objection_continue: { perms: ["deadline.view"], title: "صدر قرار الاعتراض واستمر سير المعاملة" },
  objection_ends_file: { perms: ["closure.request"], title: "قُبل الاعتراض وانتهى المسار، والملف بانتظار الإغلاق" },
  deadline_expired: { perms: ["nonresponse.initiate", "deadline.view"], title: "انتهت المدة القانونية دون تسجيل استجابة" },
  extension_requested: { perms: ["extension.decide"], title: "طلب تمديد مدة بانتظار القرار" },
  extension_decided_running: { creator: true, title: "صدر قرار في طلب التمديد" },
  extension_decided_expired: { creator: true, title: "صدر قرار في طلب التمديد" },
};

/// يُستدعى من محرك سير العمل بعد كل انتقال ضمن المعاملة نفسها
export async function notifyTransition(tx: Tx, action: string, v: Violation, historyId: string, actorId: string) {
  const def = TRANSITION_NOTICES[action];
  if (!def) return;
  const ids = new Set<string>();
  if (def.perms) for (const id of await recipientsFor(tx, v, def.perms)) ids.add(id);
  if (def.creator) ids.add(v.createdById);
  ids.delete(actorId); // لا يُشعَر المنفذ بإجرائه
  await notify(tx, { userIds: [...ids], type: `transition.${action}`, title: def.title, body: v.number ? `المخالفة ${v.number} — ${v.offenderName}` : v.offenderName, violationId: v.id, dedupeKey: `t:${historyId}` });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, ids: string[] | "all"): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}
