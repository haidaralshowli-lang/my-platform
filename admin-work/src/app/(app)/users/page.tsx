import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { COORDINATOR_DEFAULTS, COORDINATOR_GRANTABLE, PERMISSIONS, ROLE_LABELS } from "@/lib/rbac";
import { Badge, Card, DataTable, PageHeader } from "@/components/ui";
import { CreateUserForm } from "./forms";

export const metadata = { title: "المستخدمون والصلاحيات" };

export default async function UsersPage() {
  await requirePagePermission("users.manage");
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { fullName: "asc" }],
    select: { id: true, username: true, fullName: true, role: true, isActive: true, lastLoginAt: true, lockedUntil: true, mustChangePassword: true, permissions: true },
  });
  const options = COORDINATOR_GRANTABLE.map((code) => ({ code, label: PERMISSIONS[code].label, group: PERMISSIONS[code].group }));
  const now = new Date();
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" description="لا توجد حسابات عامة أو تسجيل ذاتي. ينشئ المدير الحسابات ويحدد صلاحيات المنسق العام التشغيلية." />
      <div className="flex flex-col gap-6">
        <Card title={`الحسابات (${users.length})`}>
          <DataTable>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>اسم المستخدم</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>الصلاحيات</th>
                <th>آخر دخول</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/users/${u.id}`} className="font-medium text-brand hover:underline">
                      {u.fullName}
                    </Link>
                  </td>
                  <td className="ltr-num">{u.username}</td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {u.isActive ? <Badge tone="success">نشط</Badge> : <Badge tone="danger">معطل</Badge>}
                      {u.lockedUntil && u.lockedUntil > now && <Badge tone="warning">مقفل مؤقتاً</Badge>}
                      {u.mustChangePassword && <Badge tone="neutral">كلمة مرور مؤقتة</Badge>}
                    </div>
                  </td>
                  <td className="ltr-num">{u.role === "ADMIN" ? "الكل" : `${u.permissions.length} / ${COORDINATOR_GRANTABLE.length}`}</td>
                  <td className="ltr-num whitespace-nowrap">{fmtDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
        <Card title="إنشاء حساب جديد">
          <CreateUserForm options={options} defaults={COORDINATOR_DEFAULTS} />
        </Card>
      </div>
    </>
  );
}
