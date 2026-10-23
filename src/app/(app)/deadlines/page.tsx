import Link from "next/link";
import type { DeadlineStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/lib/auth/server";
import { can, violationScopeWhere } from "@/lib/rbac/actor";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DEFAULT_TZ, formatDateTime } from "@/lib/datetime";
import { daysRemaining } from "@/lib/deadlines/compute";
import { DEADLINE_LABELS, DEADLINE_TONE } from "../violations/[id]/delivery-panels";

export const metadata = { title: "المدد القانونية والتنبيهات" };

export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requirePagePermission("deadline.view");
  const sp = await searchParams;
  const status = sp.status && sp.status in DEADLINE_LABELS ? (sp.status as DeadlineStatus) : undefined;
  const [rows, counts, lastRun] = await Promise.all([
    prisma.deadlineCalculation.findMany({
      where: { isCurrent: true, violation: { AND: [violationScopeWhere(actor), { generalStatus: "OPEN" }] }, ...(status ? { status } : { status: { not: "STOPPED" } }) },
      orderBy: [{ dueDate: { sort: "asc", nulls: "first" } }],
      take: 200,
      include: { violation: { select: { id: true, number: true, offenderName: true, stage: true } } },
    }),
    prisma.deadlineCalculation.groupBy({ by: ["status"], where: { isCurrent: true, violation: { AND: [violationScopeWhere(actor), { generalStatus: "OPEN" }] } }, _count: true }),
    prisma.systemSetting.findUnique({ where: { key: "jobs.deadlines.lastRun" } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const last = lastRun?.value as { at?: string } | undefined;
  return (
    <>
      <PageHeader
        title="المدد القانونية والتنبيهات"
        description={`تُحدَّث الحالات بمهمة مجدولة في الخادم بتوقيت ${DEFAULT_TZ}. آخر تشغيل: ${last?.at ? formatDateTime(last.at) : "لم تُشغَّل بعد"}.`}
        actions={can(actor, "deadline.rules_manage") ? <LinkButton href="/deadlines/rules" variant="secondary">قواعد المدد والعطل</LinkButton> : undefined}
      />
      <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="تصفية">
        <Link href="/deadlines" className={!status ? "font-semibold text-brand" : "text-muted"}>الكل</Link>
        {(["RUNNING", "EXTENDED", "NEAR_EXPIRY", "EXPIRED", "PENDING_REVIEW", "SUSPENDED"] as const).map((s) => (
          <Link key={s} href={`/deadlines?status=${s}`} className={status === s ? "font-semibold text-brand" : "text-muted"}>{DEADLINE_LABELS[s]} ({count(s)})</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? <EmptyState>لا توجد مدد ضمن هذا التصنيف.</EmptyState> : (
          <DataTable>
            <thead><tr><th>المخالفة</th><th>الجهة</th><th>الحالة</th><th>تاريخ الانتهاء</th><th>المتبقي</th></tr></thead>
            <tbody>
              {rows.map((d) => {
                const left = d.dueDate ? daysRemaining(d.dueDate, new Date(), DEFAULT_TZ) : null;
                return (
                  <tr key={d.id}>
                    <td><Link className="text-brand hover:underline" href={`/violations/${d.violation.id}`}><bdi>{d.violation.number}</bdi></Link></td>
                    <td>{d.violation.offenderName}</td>
                    <td><Badge tone={DEADLINE_TONE[d.status]}>{DEADLINE_LABELS[d.status]}</Badge></td>
                    <td className="text-xs whitespace-nowrap">{formatDateTime(d.dueDate)}</td>
                    <td className="text-xs">{left === null ? "—" : left < 0 ? `انتهت منذ ${-left} يوم` : left === 0 ? "اليوم" : `${left} يوم`}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>
    </>
  );
}
