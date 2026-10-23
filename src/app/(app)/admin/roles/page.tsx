import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui";
import { SYSADMIN_FORBIDDEN, type PermissionCode } from "@/lib/rbac/catalog";
import { RolePermissionsForm } from "./role-form";

export const metadata = { title: "الأدوار والصلاحيات" };

export default async function RolesPage() {
  const actor = await requirePagePermission("roles.manage");
  const [roles, perms] = await Promise.all([
    prisma.role.findMany({ orderBy: { createdAt: "asc" }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } }),
    prisma.permission.findMany({ orderBy: [{ groupAr: "asc" }, { code: "asc" }] }),
  ]);
  const groups = Object.entries(
    perms.reduce<Record<string, { code: string; nameAr: string }[]>>((acc, p) => {
      (acc[p.groupAr] ??= []).push({ code: p.code, nameAr: p.nameAr });
      return acc;
    }, {}),
  );
  return (
    <>
      <PageHeader title="الأدوار والصلاحيات" description="تُطبَّق الصلاحيات في الخادم على كل عملية. لا يمكن منح دور مدير النظام صلاحيات المصادقة الرسمية، ولا يمكن تعديل دور تحمله أنت." />
      <div className="flex flex-col gap-4">
        {roles.map((r) => (
          <Card key={r.id} title={`${r.nameAr} (${r._count.users} مستخدم)`}>
            <details>
              <summary className="cursor-pointer text-sm text-brand">عرض وتعديل الصلاحيات ({r.permissions.length})</summary>
              <RolePermissionsForm
                roleId={r.id}
                groups={groups}
                selected={r.permissions.map((p) => p.permission.code)}
                disabledCodes={r.code === "SYSADMIN" ? (SYSADMIN_FORBIDDEN as PermissionCode[]) : []}
                readOnly={actor.roles.includes(r.code)}
              />
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
