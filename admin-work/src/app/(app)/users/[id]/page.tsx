import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { COORDINATOR_GRANTABLE, PERMISSIONS, ROLE_LABELS } from "@/lib/rbac";
import { Badge, Card, DataTable, PageHeader } from "@/components/ui";
import { AccountActions, EditUserForm } from "../forms";

export const metadata = { title: "بيانات المستخدم" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("users.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();
  const [sessions, history] = await Promise.all([
    prisma.session.findMany({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    prisma.auditLog.findMany({ where: { OR: [{ entityType: "User", entityId: id }, { userId: id, action: { startsWith: "auth." } }] }, orderBy: { id: "desc" }, take: 15 }),
  ]);
  const options = COORDINATOR_GRANTABLE.map((code) => ({ code, label: PERMISSIONS[code].label, group: PERMISSIONS[code].group }));
  return (
    <>
      <PageHeader
        title={user.fullName}
        description={`${ROLE_LABELS[user.role]} — ${user.username}`}
        actions={
          <Link href="/users" className="text-sm text-brand hover:underline">
            ← العودة إلى المستخدمين
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="البيانات والصلاحيات" className="lg:col-span-2">
          <EditUserForm userId={user.id} fullName={user.fullName} isAdmin={user.role === "ADMIN"} options={options} selected={user.permissions} />
        </Card>
        <Card title="إجراءات الحساب">
          <div className="mb-4 flex flex-wrap gap-1">
            {user.isActive ? <Badge tone="success">نشط</Badge> : <Badge tone="danger">معطل</Badge>}
            {user.mustChangePassword && <Badge tone="neutral">كلمة مرور مؤقتة</Badge>}
            {user.lockedUntil && user.lockedUntil > new Date() && <Badge tone="warning">مقفل حتى {fmtDateTime(user.lockedUntil)}</Badge>}
          </div>
          <AccountActions userId={user.id} isActive={user.isActive} isSelf={user.id === actor.id} />
        </Card>
        <Card title={`الجلسات النشطة (${sessions.length})`} className="lg:col-span-3">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted">لا توجد جلسات نشطة.</p>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>بدأت</th>
                  <th>آخر نشاط</th>
                  <th>عنوان IP</th>
                  <th>المتصفح</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="ltr-num whitespace-nowrap">{fmtDateTime(s.createdAt)}</td>
                    <td className="ltr-num whitespace-nowrap">{fmtDateTime(s.lastSeenAt)}</td>
                    <td className="ltr-num">{s.ip ?? "—"}</td>
                    <td className="max-w-xs truncate text-xs text-muted" dir="ltr">{s.userAgent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
        <Card title="آخر العمليات على الحساب" className="lg:col-span-3">
          <DataTable>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>العملية</th>
                <th>المنفذ</th>
                <th>السبب</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={String(h.id)}>
                  <td className="ltr-num whitespace-nowrap">{fmtDateTime(h.at)}</td>
                  <td className="ltr-num">{h.action}</td>
                  <td className="ltr-num">{h.username ?? "—"}</td>
                  <td>{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      </div>
    </>
  );
}
