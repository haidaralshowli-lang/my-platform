import Link from "next/link";
import { AlarmClock, Download, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDay } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";
import { CONSENT, CONSENTS, PRIORITY, PRIORITIES, TASK_STATUS, TASK_STATUSES } from "@/lib/labels";
import { isTaskOverdue, listTasks, taskFilterSchema } from "@/lib/services/tasks";
import { Alert, Badge, Card, DataTable, LinkButton, PageHeader } from "@/components/ui";
import { buildQs, Pagination, ProgressBar, SortHeader } from "@/components/list";

export const metadata = { title: "المهام" };

const DEFAULTS = { page: 1, sort: "createdAt", dir: "desc" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("tasks.view");
  const sp = await searchParams;
  const f = taskFilterSchema.parse(sp);
  const { total, rows, pages } = await listTasks(f);
  const assignee = f.assignee ? await prisma.person.findUnique({ where: { id: f.assignee }, select: { fullName: true, serial: true } }) : null;
  const filtered = !!(f.q || f.status.length || f.consent || f.assignee || f.request || f.priority || f.overdue || f.awaitingClose);
  const fq = { ...f, status: f.status.join(",") || undefined };
  return (
    <>
      <PageHeader
        title={f.overdue ? "المهام المتأخرة" : f.awaitingClose ? "مهام منجزة بانتظار اعتماد الإغلاق" : "المهام"}
        description="لا تتحول المهمة إلى تكليف نافذ إلا بعد موافقة الشخص المكلف على تنفيذها وعلى الموعد."
        actions={
          <>
            {can(actor, "tasks.create") && (
              <LinkButton href="/tasks/new">
                <Plus className="h-4 w-4" aria-hidden /> مهمة جديدة
              </LinkButton>
            )}
            <LinkButton href="/tasks?overdue=1&sort=dueDate&dir=asc" variant="secondary">
              <AlarmClock className="h-4 w-4" aria-hidden /> المتأخرة
            </LinkButton>
            <a href={`/api/tasks/export${buildQs(fq, { page: undefined }, DEFAULTS)}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-band">
              <Download className="h-4 w-4" aria-hidden /> تصدير إلى Excel
            </a>
          </>
        }
      />
      {sp.deleted === "1" && (
        <div className="mb-4">
          <Alert tone="success">تم حذف المهمة.</Alert>
        </div>
      )}
      <Card>
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="flex flex-col gap-1 lg:col-span-2">
            <label htmlFor="q" className="text-sm font-medium">
              بحث
            </label>
            <input id="q" name="q" defaultValue={f.q} placeholder="رقم المهمة، العنوان، اسم المكلف" className="field-input" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-sm font-medium">
              الحالة
            </label>
            <select id="status" name="status" defaultValue={f.status.join(",")} className="field-input">
              <option value="">الكل</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS[s].label}
                </option>
              ))}
              {f.status.length > 1 && <option value={f.status.join(",")}>{f.status.map((s) => TASK_STATUS[s].label).join(" أو ")}</option>}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="consent" className="text-sm font-medium">
              موافقة المكلف
            </label>
            <select id="consent" name="consent" defaultValue={f.consent ?? ""} className="field-input">
              <option value="">الكل</option>
              {CONSENTS.map((c) => (
                <option key={c} value={c}>
                  {CONSENT[c].label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="priority" className="text-sm font-medium">
              الأولوية
            </label>
            <select id="priority" name="priority" defaultValue={f.priority ?? ""} className="field-input">
              <option value="">الكل</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </div>
          {f.assignee && <input type="hidden" name="assignee" value={f.assignee} />}
          {f.request && <input type="hidden" name="request" value={f.request} />}
          {f.awaitingClose && <input type="hidden" name="awaitingClose" value="1" />}
          <input type="hidden" name="sort" value={f.sort} />
          <input type="hidden" name="dir" value={f.dir} />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="overdue" value="1" defaultChecked={!!f.overdue} className="h-4 w-4 accent-brand" />
              المتأخرة فقط
            </label>
            <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              بحث
            </button>
            {filtered && (
              <Link href="/tasks" className="rounded-md px-4 py-2 text-sm text-brand hover:bg-brand-soft">
                مسح الفلاتر
              </Link>
            )}
            {assignee && (
              <Badge tone="info">
                المكلف: {assignee.fullName} (<span className="ltr-num">{assignee.serial}</span>)
              </Badge>
            )}
            <span className="ltr-num ms-auto text-sm text-muted">{total} مهمة</span>
          </div>
        </form>
        <DataTable>
          <thead>
            <tr>
              <th>رقم المهمة</th>
              <th>العنوان</th>
              <th>المكلف</th>
              <th>الحالة</th>
              <SortHeader base="/tasks" f={fq} col="progress" defaults={DEFAULTS}>
                الإنجاز
              </SortHeader>
              <SortHeader base="/tasks" f={fq} col="dueDate" defaults={DEFAULTS}>
                الموعد
              </SortHeader>
              <th>الأولوية</th>
              <SortHeader base="/tasks" f={fq} col="lastUpdateAt" defaults={DEFAULTS} className="hidden 2xl:table-cell">
                آخر تحديث
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const late = isTaskOverdue(t);
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/tasks/${t.id}`} className="ltr-num font-medium text-brand hover:underline">
                      {t.number}
                    </Link>
                  </td>
                  <td className="min-w-48">
                    {t.title}
                    {t.request && (
                      <Link href={`/requests/${t.request.id}`} className="ltr-num ms-2 text-xs text-muted hover:underline">
                        {t.request.number}
                      </Link>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <Link href={`/people/${t.assignee.id}`} className="hover:underline">
                      {t.assignee.fullName}
                    </Link>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                      {t.consentStatus !== "ACCEPTED" && t.status !== "CANCELLED" && <Badge tone={CONSENT[t.consentStatus].tone}>{CONSENT[t.consentStatus].label}</Badge>}
                      {late && <Badge tone="danger">متأخرة</Badge>}
                      {t.status === "DONE" && !t.closedAt && <Badge tone="warning">بانتظار اعتماد الإغلاق</Badge>}
                    </div>
                  </td>
                  <td>
                    <ProgressBar value={t.progress} />
                  </td>
                  <td className={`ltr-num whitespace-nowrap ${late ? "font-semibold text-tone-danger" : ""}`}>{fmtDay(t.dueDate)}</td>
                  <td>
                    <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
                  </td>
                  <td className="ltr-num hidden whitespace-nowrap text-xs text-muted 2xl:table-cell">{fmtDateTime(t.lastUpdateAt)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted">
                  {filtered ? "لا توجد مهام مطابقة." : "لا توجد مهام بعد."}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
        <Pagination base="/tasks" f={fq} page={f.page} pages={pages} defaults={DEFAULTS} />
      </Card>
    </>
  );
}
