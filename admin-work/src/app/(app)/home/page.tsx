import { requireActor } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { PERMISSIONS, ROLE_LABELS, type Permission } from "@/lib/rbac";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "الرئيسية" };

/// الصفحة الرئيسية في المرحلة الأولى: بيانات الحساب وصلاحياته الفعلية. تحل محلها لوحة المتابعة في المرحلة الثانية.
export default async function HomePage() {
  const actor = await requireActor();
  const [user, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { lastLoginAt: true, passwordChangedAt: true, createdAt: true } }),
    prisma.session.count({ where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const groups = new Map<string, Permission[]>();
  for (const p of actor.permissions) {
    const g = PERMISSIONS[p].group;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  return (
    <>
      <PageHeader title={`مرحباً، ${actor.fullName}`} description="بيانات حسابك والصلاحيات الممنوحة لك في النظام." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="الحساب">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">اسم المستخدم</dt>
            <dd className="ltr-num">{actor.username}</dd>
            <dt className="text-muted">الدور</dt>
            <dd>
              <Badge tone={actor.role === "ADMIN" ? "info" : "neutral"}>{ROLE_LABELS[actor.role]}</Badge>
            </dd>
            <dt className="text-muted">آخر دخول</dt>
            <dd className="ltr-num">{fmtDateTime(user.lastLoginAt)}</dd>
            <dt className="text-muted">آخر تغيير لكلمة المرور</dt>
            <dd className="ltr-num">{fmtDateTime(user.passwordChangedAt)}</dd>
            <dt className="text-muted">الجلسات النشطة</dt>
            <dd className="ltr-num">{sessions}</dd>
          </dl>
        </Card>
        <Card title="صلاحياتك" className="lg:col-span-2">
          {actor.role === "ADMIN" && <p className="mb-3 text-sm text-muted">بصفتك مدير النظام تملك جميع الصلاحيات.</p>}
          {groups.size === 0 ? (
            <p className="text-sm text-muted">لا توجد صلاحيات ممنوحة لحسابك حالياً. راجع مدير النظام.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {[...groups].map(([g, perms]) => (
                <div key={g}>
                  <h3 className="mb-1.5 text-sm font-semibold text-brand">{g}</h3>
                  <ul className="list-inside list-disc space-y-0.5 text-sm">
                    {perms.map((p) => (
                      <li key={p}>{PERMISSIONS[p].label}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
