import { prisma } from "@/lib/db";
import { doneWhere, failedWhere, overdueWhere } from "./requests";
import { overdueTaskWhere } from "./tasks";
import { getSetting } from "@/lib/settings";

/// مؤشرات قاعدة بيانات الأشخاص في لوحة المتابعة. كل مؤشر يقابله فلتر في صفحة الأشخاص يعرض السجلات نفسها.
export async function peopleIndicators() {
  const staleDays = await getSetting(prisma, "people.staleDays");
  const cutoff = new Date(Date.now() - staleDays * 86_400_000);
  const live = { deletedAt: null };
  const [total, complete, incomplete, needsUpdate, available, byRegion, byOwner, recent] = await Promise.all([
    prisma.person.count({ where: live }),
    prisma.person.count({ where: { ...live, dataStatus: "COMPLETE" } }),
    prisma.person.count({ where: { ...live, dataStatus: "INCOMPLETE" } }),
    prisma.person.count({ where: { ...live, OR: [{ dataStatus: "NEEDS_UPDATE" }, { updatedAt: { lt: cutoff } }] } }),
    prisma.person.count({ where: { ...live, availableForWork: true } }),
    prisma.person.groupBy({ by: ["regionId"], where: live, _count: { _all: true }, orderBy: { _count: { regionId: "desc" } } }),
    prisma.person.groupBy({ by: ["followUpOwnerId"], where: live, _count: { _all: true }, orderBy: { _count: { followUpOwnerId: "desc" } } }),
    prisma.person.findMany({ where: live, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, serial: true, fullName: true, createdAt: true, dataStatus: true } }),
  ]);
  const [regions, owners] = await Promise.all([
    prisma.region.findMany({ where: { id: { in: byRegion.map((r) => r.regionId).filter((x): x is number => x !== null) } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: byOwner.map((r) => r.followUpOwnerId).filter((x): x is string => x !== null) } }, select: { id: true, fullName: true } }),
  ]);
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  const ownerName = new Map(owners.map((o) => [o.id, o.fullName]));
  return {
    staleDays,
    total,
    complete,
    incomplete,
    needsUpdate,
    available,
    completionRate: total ? Math.round((complete / total) * 100) : 0,
    byRegion: byRegion.map((r) => ({ id: r.regionId, name: r.regionId ? (regionName.get(r.regionId) ?? "—") : "غير محددة", count: r._count._all })),
    byOwner: byOwner.map((r) => ({ id: r.followUpOwnerId, name: r.followUpOwnerId ? (ownerName.get(r.followUpOwnerId) ?? "—") : "غير محدد", count: r._count._all })),
    recent,
  };
}

/// مؤشرات الطلبات. «قيد المتابعة» تشمل المحال إلى الجهة المختصة، و«المنجزة/المتعذرة» تشمل المغلقة على النتيجة نفسها.
export async function requestIndicators() {
  const live = { deletedAt: null };
  const [total, fresh, review, following, done, failed, overdue, closed] = await Promise.all([
    prisma.request.count({ where: live }),
    prisma.request.count({ where: { ...live, status: "NEW" } }),
    prisma.request.count({ where: { ...live, status: "UNDER_REVIEW" } }),
    prisma.request.count({ where: { ...live, status: { in: ["REFERRED", "FOLLOWING"] } } }),
    prisma.request.count({ where: { ...live, ...doneWhere } }),
    prisma.request.count({ where: { ...live, ...failedWhere } }),
    prisma.request.count({ where: { ...live, ...overdueWhere() } }),
    prisma.request.count({ where: { ...live, status: "CLOSED" } }),
  ]);
  return { total, fresh, review, following, done, failed, overdue, closed };
}

/// مؤشرات المهام. نسبة الإنجاز العامة = المنجزة ÷ (الإجمالي − الملغاة).
export async function taskIndicators() {
  const live = { deletedAt: null };
  const [total, fresh, inProgress, done, stuck, cancelled, pendingConsent, overdue, awaitingClose] = await Promise.all([
    prisma.task.count({ where: live }),
    prisma.task.count({ where: { ...live, status: "NOT_STARTED" } }),
    prisma.task.count({ where: { ...live, status: { in: ["IN_PROGRESS", "WAITING"] } } }),
    prisma.task.count({ where: { ...live, status: "DONE" } }),
    prisma.task.count({ where: { ...live, status: "STUCK" } }),
    prisma.task.count({ where: { ...live, status: "CANCELLED" } }),
    prisma.task.count({ where: { ...live, consentStatus: { in: ["PENDING", "CHANGE_REQUESTED"] }, status: { not: "CANCELLED" } } }),
    prisma.task.count({ where: { ...live, ...overdueTaskWhere() } }),
    prisma.task.count({ where: { ...live, status: "DONE", closedAt: null } }),
  ]);
  const base = total - cancelled;
  return { total, fresh, inProgress, done, stuck, cancelled, pendingConsent, overdue, awaitingClose, completionRate: base ? Math.round((done / base) * 100) : 0 };
}
