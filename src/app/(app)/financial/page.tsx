import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { canAny, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { formatNumberLocale } from "@/lib/datetime";

export const metadata = { title: "الملفات المالية والتسديدات" };
const PAY = { UNPAID: "غير مسدد", PARTIALLY_PAID: "مسدد جزئياً", PAID: "مسدد بالكامل", UNDER_AUDIT: "قيد التدقيق" } as const;

export default async function FinancialPage() {
  const actor = await requireActor();
  if (!canAny(actor, ["financial.view", "financial.record"])) redirect("/forbidden");
  const rows = await prisma.financialResponse.findMany({
    where: { response: { violation: { AND: [violationScopeWhere(actor), { isDemo: false }] } } },
    include: { payments: true, response: { include: { violation: { select: { id: true, number: true, offenderName: true } } } } },
    orderBy: { response: { createdAt: "desc" } },
    take: 200,
  });
  const sum = (xs: Prisma.Decimal[]) => xs.reduce((s, x) => s.plus(x), new Prisma.Decimal(0));
  const totalDue = sum(rows.map((r) => r.amountDue ?? new Prisma.Decimal(0)));
  const totalPaid = sum(rows.flatMap((r) => r.payments.map((p) => p.amount)));
  const fmt = (d: Prisma.Decimal) => `${formatNumberLocale(d.toString())} د.ع`;
  return (
    <>
      <PageHeader title="الملفات المالية والتسديدات" description="المبالغ تُدخل من سندات معتمدة ولا يحتسبها النظام. التسديدات لا تُعدَّل ولا تُحذف؛ التصحيح بقيد عكسي معتمد." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm"><div className="text-xs text-muted">إجمالي المستحق المعتمد</div><div className="mt-1 text-xl font-bold text-brand">{fmt(totalDue)}</div></div>
        <div className="rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm"><div className="text-xs text-muted">إجمالي المسدد</div><div className="mt-1 text-xl font-bold text-brand">{fmt(totalPaid)}</div></div>
        <div className="rounded-lg border-t-4 border-accent bg-white p-4 shadow-sm"><div className="text-xs text-muted">المتبقي</div><div className="mt-1 text-xl font-bold text-brand">{fmt(totalDue.minus(totalPaid))}</div></div>
      </div>
      <Card title={`الاستجابات المالية (${rows.length})`}>
        {rows.length === 0 ? <EmptyState>لا توجد استجابات مالية.</EmptyState> : (
          <DataTable>
            <thead><tr><th>المخالفة</th><th>الجهة</th><th>النوع</th><th>المستحق</th><th>المسدد</th><th>الحالة</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.responseId}>
                  <td><Link className="text-brand hover:underline" href={`/violations/${r.response.violation.id}`}><bdi>{r.response.violation.number}</bdi></Link></td>
                  <td>{r.response.violation.offenderName}</td>
                  <td className="text-xs">{r.financialType}</td>
                  <td className="text-xs whitespace-nowrap">{r.amountDue ? fmt(r.amountDue) : "—"}</td>
                  <td className="text-xs whitespace-nowrap">{fmt(sum(r.payments.map((p) => p.amount)))}</td>
                  <td><Badge tone={r.paymentStatus === "PAID" ? "success" : "warning"}>{PAY[r.paymentStatus]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
