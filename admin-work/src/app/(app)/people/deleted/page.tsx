import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, DataTable, PageHeader } from "@/components/ui";
import { RestoreButton } from "../row-actions";

export const metadata = { title: "السجلات المحذوفة" };

export default async function DeletedPeoplePage() {
  await requirePagePermission("people.delete");
  const rows = await prisma.person.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 200,
    include: { mergedInto: { select: { id: true, serial: true } } },
  });
  const deleters = new Map(
    (await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.deletedById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );
  return (
    <>
      <PageHeader
        title="السجلات المحذوفة"
        description="السجلات المحذوفة لا تظهر في القوائم والمؤشرات. يمكن استعادة أي سجل حُذف بالخطأ، أما السجلات المدمجة فارتباطاتها نُقلت إلى السجل الأساسي."
        actions={
          <Link href="/people" className="text-sm text-brand hover:underline">
            ← العودة إلى القائمة
          </Link>
        }
      />
      <Card>
        <DataTable>
          <thead>
            <tr>
              <th>الرقم</th>
              <th>الاسم</th>
              <th>حُذف في</th>
              <th>بواسطة</th>
              <th>السبب</th>
              <th>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="ltr-num text-muted">{r.serial}</td>
                <td>
                  <Link href={`/people/${r.id}`} className="text-brand hover:underline">
                    {r.fullName}
                  </Link>
                </td>
                <td className="ltr-num whitespace-nowrap">{fmtDateTime(r.deletedAt)}</td>
                <td>{(r.deletedById && deleters.get(r.deletedById)) ?? "—"}</td>
                <td>{r.deleteReason ?? "—"}</td>
                <td>
                  {r.mergedInto ? (
                    <Link href={`/people/${r.mergedInto.id}`} className="text-sm text-brand hover:underline">
                      مدمج في {r.mergedInto.serial}
                    </Link>
                  ) : (
                    <RestoreButton id={r.id} />
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  لا توجد سجلات محذوفة.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </Card>
    </>
  );
}
