import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { DEFAULT_TZ, formatDateTime, formatNumberLocale, zonedDateTimeToUtc } from "@/lib/datetime";
import { SYSTEM_ROLES } from "@/lib/rbac/catalog";
import { VerifyChain } from "./verify";

export const metadata = { title: "سجل التدقيق" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const and: Prisma.AuditLogWhereInput[] = [];
  if (sp.user) and.push({ username: { contains: sp.user.slice(0, 60), mode: "insensitive" } });
  if (sp.action) and.push({ action: { contains: sp.action.slice(0, 60) } });
  if (sp.entity) and.push({ entityType: sp.entity.slice(0, 60) });
  if (sp.entityId) and.push({ entityId: sp.entityId.slice(0, 60) });
  if (sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)) and.push({ at: { gte: zonedDateTimeToUtc(sp.from, "00:00", DEFAULT_TZ) } });
  if (sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) and.push({ at: { lt: new Date(zonedDateTimeToUtc(sp.to, "00:00", DEFAULT_TZ).getTime() + 86_400_000) } });
  const where = { AND: and };
  const [total, rows, entities] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.groupBy({ by: ["entityType"], _count: true, orderBy: { entityType: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page")) as Record<string, string>), page: String(p) })}`;
  return (
    <>
      <PageHeader title="سجل التدقيق" description="سجل إضافة فقط: قاعدة البيانات تمنع تعديل قيوده أو حذفها، والقيود متسلسلة بالتجزئة لكشف أي عبث. لا تُسجَّل كلمات المرور ولا الرموز السرية." />
      <Card className="mb-6"><VerifyChain /></Card>
      <Card className="mb-6">
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
          <input name="user" defaultValue={sp.user} placeholder="اسم المستخدم" aria-label="اسم المستخدم" className="field-input" />
          <input name="action" defaultValue={sp.action} placeholder="الإجراء (مثل closure)" aria-label="الإجراء" dir="ltr" className="field-input" />
          <select name="entity" defaultValue={sp.entity ?? ""} aria-label="نوع الكيان" className="field-input"><option value="">كل الكيانات</option>{entities.map((e) => <option key={e.entityType} value={e.entityType}>{e.entityType} ({e._count})</option>)}</select>
          <input name="entityId" defaultValue={sp.entityId} placeholder="معرّف الكيان" aria-label="معرّف الكيان" dir="ltr" className="field-input" />
          <input type="date" name="from" defaultValue={sp.from} aria-label="من" className="field-input" />
          <input type="date" name="to" defaultValue={sp.to} aria-label="إلى" className="field-input" />
          <div className="flex gap-2"><button className="rounded-md bg-brand px-4 py-2 text-sm text-white">بحث</button><Link href="/audit" className="rounded-md border border-line px-4 py-2 text-sm">مسح</Link></div>
        </form>
      </Card>
      <Card title={`القيود (${formatNumberLocale(total)})`}>
        {rows.length === 0 ? <EmptyState>لا توجد قيود مطابقة.</EmptyState> : (
          <DataTable>
            <thead><tr><th>#</th><th>الوقت</th><th>المستخدم والدور</th><th>الإجراء</th><th>الكيان</th><th>السبب</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="align-top">
                  <td className="text-xs">{String(r.id)}</td>
                  <td className="text-xs whitespace-nowrap">{formatDateTime(r.at)}</td>
                  <td className="text-xs">{r.username ?? "—"}<div className="text-muted">{r.roles.map((x) => SYSTEM_ROLES[x]?.nameAr ?? x).join("، ")}</div>{r.ip && <div dir="ltr" className="text-muted">{r.ip}</div>}</td>
                  <td className="text-xs" dir="ltr">{r.action}</td>
                  <td className="text-xs" dir="ltr">{r.entityType}{r.entityId && <div className="text-muted">{r.entityId}</div>}</td>
                  <td className="text-xs">{r.reason ?? "—"}</td>
                  <td className="text-xs">
                    {(r.before || r.after) ? (
                      <details>
                        <summary className="cursor-pointer text-brand">عرض القيم</summary>
                        {r.before !== null && <pre dir="ltr" className="mt-1 max-w-md overflow-x-auto rounded bg-band p-2 text-start whitespace-pre-wrap">قبل: {JSON.stringify(r.before, null, 1)}</pre>}
                        {r.after !== null && <pre dir="ltr" className="mt-1 max-w-md overflow-x-auto rounded bg-band p-2 text-start whitespace-pre-wrap">بعد: {JSON.stringify(r.after, null, 1)}</pre>}
                        {r.requestId && <div dir="ltr" className="mt-1 text-muted">request: {r.requestId}</div>}
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="الصفحات">
          <span className="text-muted">صفحة {page} من {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="rounded border border-line px-3 py-1" href={qs(page - 1)}>الأحدث</Link>}
            {page < pages && <Link className="rounded border border-line px-3 py-1" href={qs(page + 1)}>الأقدم</Link>}
          </span>
        </nav>
      </Card>
    </>
  );
}
