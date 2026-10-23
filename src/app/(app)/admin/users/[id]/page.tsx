import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Badge, Card, DataTable, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { updateUserAction } from "../actions";
import { orgOptions } from "../data";
import { UserForm } from "../user-form";
import { UserAdminPanel } from "./admin-panel";

export const metadata = { title: "بيانات الحساب" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("users.manage");
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!user) notFound();
  const [opts, attempts, sessions] = await Promise.all([
    orgOptions(),
    prisma.loginAttempt.findMany({ where: { username: user.username }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return (
    <>
      <PageHeader title={user.fullName} description={`اسم المستخدم: ${user.username}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="البيانات والأدوار" className="lg:col-span-2">
          <UserForm
            action={updateUserAction}
            initial={{ ...user, roleIds: user.roles.map((r) => r.roleId) }}
            {...opts}
            submitLabel="حفظ التعديلات"
          />
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="حالة الحساب">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">الحالة</dt><dd>{user.isActive ? <Badge tone="success">مفعّل</Badge> : <Badge tone="danger">معطّل</Badge>}</dd>
              <dt className="text-muted">آخر دخول</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
              <dt className="text-muted">محاولات فاشلة</dt><dd>{user.failedLoginCount}</dd>
              <dt className="text-muted">مقفل حتى</dt><dd>{formatDateTime(user.lockedUntil)}</dd>
              <dt className="text-muted">الجلسات النشطة</dt><dd>{sessions}</dd>
            </dl>
            {user.id !== actor.id && <UserAdminPanel id={user.id} active={user.isActive} />}
          </Card>
          <Card title="آخر محاولات الدخول">
            <DataTable>
              <thead><tr><th>الوقت</th><th>النتيجة</th></tr></thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}><td className="text-xs">{formatDateTime(a.createdAt)}</td><td>{a.success ? <Badge tone="success">ناجحة</Badge> : <Badge tone="danger">فاشلة</Badge>}</td></tr>
                ))}
              </tbody>
            </DataTable>
          </Card>
        </div>
      </div>
    </>
  );
}
