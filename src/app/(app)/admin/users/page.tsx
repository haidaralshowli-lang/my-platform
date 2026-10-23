import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { can } from "@/lib/rbac/actor";

export const metadata = { title: "إدارة المستخدمين" };
const PAGE_SIZE = 25;

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; status?: string }> }) {
  const actor = await requirePagePermission("users.manage");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.UserWhereInput = {
    ...(q ? { OR: [{ username: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }] } : {}),
    ...(sp.status === "inactive" ? { isActive: false } : sp.status === "active" ? { isActive: true } : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { roles: { include: { role: true } }, office: true, governorate: true },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="إدارة المستخدمين والصلاحيات"
        description="إنشاء الحسابات وتعيين الأدوار ونطاق الاطلاع وتعطيل الحسابات وإنهاء الجلسات. جميع العمليات مسجلة في سجل التدقيق."
        actions={
          <>
            {can(actor, "roles.manage") && <LinkButton href="/admin/roles" variant="secondary">الأدوار والصلاحيات</LinkButton>}
            <LinkButton href="/admin/users/new">إنشاء حساب</LinkButton>
          </>
        }
      />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2" role="search">
          <input name="q" defaultValue={q} placeholder="بحث بالاسم أو اسم المستخدم" className="field-input max-w-xs" aria-label="بحث" />
          <select name="status" defaultValue={sp.status ?? ""} className="field-input max-w-40" aria-label="الحالة">
            <option value="">كل الحالات</option>
            <option value="active">مفعّل</option>
            <option value="inactive">معطّل</option>
          </select>
          <button className="rounded-md border border-line px-4 text-sm hover:bg-band">بحث</button>
        </form>
        {users.length === 0 ? (
          <EmptyState>لا توجد حسابات مطابقة.</EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr><th>الاسم</th><th>اسم المستخدم</th><th>الأدوار</th><th>المكتب</th><th>الحالة</th><th>آخر دخول</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><Link className="font-medium text-brand underline-offset-2 hover:underline" href={`/admin/users/${u.id}`}>{u.fullName}</Link></td>
                  <td dir="ltr" className="text-end font-mono text-xs">{u.username}</td>
                  <td className="text-xs">{u.roles.map((r) => r.role.nameAr).join("، ")}</td>
                  <td className="text-xs">{u.office?.nameAr ?? u.governorate?.nameAr ?? "—"}</td>
                  <td>{u.isActive ? <Badge tone="success">مفعّل</Badge> : <Badge tone="danger">معطّل</Badge>}{u.mustChangePassword && <span className="ms-1"><Badge tone="warning">كلمة مرور مؤقتة</Badge></span>}</td>
                  <td className="text-xs whitespace-nowrap">{formatDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="الصفحات">
          <span className="text-muted">إجمالي {total} حساب — صفحة {page} من {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="rounded border border-line px-3 py-1 hover:bg-band" href={qs(page - 1)}>السابق</Link>}
            {page < pages && <Link className="rounded border border-line px-3 py-1 hover:bg-band" href={qs(page + 1)}>التالي</Link>}
          </span>
        </nav>
      </Card>
    </>
  );
}
