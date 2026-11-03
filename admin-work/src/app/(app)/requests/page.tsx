import Link from "next/link";
import { AlarmClock, Download, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { fmtDay } from "@/lib/dates";
import { PRIORITY, PRIORITIES, REQUEST_STATUS, REQUEST_STATUSES, REQUEST_TYPE, REQUEST_TYPES } from "@/lib/labels";
import { isOverdue, listRequests, requestFilterSchema, requestFormOptions } from "@/lib/services/requests";
import { Alert, Badge, Card, DataTable, LinkButton, PageHeader } from "@/components/ui";
import { buildQs, Pagination, RequestDisclaimer, SortHeader } from "@/components/list";

export const metadata = { title: "الطلبات" };

const DEFAULTS = { page: 1, sort: "createdAt", dir: "desc" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("requests.view");
  const sp = await searchParams;
  const f = requestFilterSchema.parse(sp);
  const [{ total, rows, pages }, { owners }] = await Promise.all([listRequests(f), requestFormOptions()]);
  const filtered = !!(f.q || f.type || f.status.length || f.outcome || f.overdue || f.owner || f.priority || f.from || f.to || f.applicant);
  const fq = { ...f, status: f.status.join(",") || undefined };
  const exportQs = buildQs(fq, { page: undefined }, DEFAULTS);
  return (
    <>
      <PageHeader
        title={f.overdue ? "كشف الطلبات المتأخرة" : "الطلبات"}
        description="استقبال الطلبات وتصنيفها ومتابعتها حتى الإنجاز أو التعذر."
        actions={
          <>
            {can(actor, "requests.create") && (
              <LinkButton href="/requests/new">
                <Plus className="h-4 w-4" aria-hidden /> تسجيل طلب
              </LinkButton>
            )}
            <LinkButton href="/requests?overdue=1&sort=followUpDate&dir=asc" variant="secondary">
              <AlarmClock className="h-4 w-4" aria-hidden /> الطلبات المتأخرة
            </LinkButton>
            <a href={`/api/requests/export${exportQs}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-band">
              <Download className="h-4 w-4" aria-hidden /> تصدير الكشف إلى Excel
            </a>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        <RequestDisclaimer />
        {sp.deleted === "1" && <Alert tone="success">تم حذف الطلب.</Alert>}
      </div>
      {can(actor, "requests.delete") && (
        <div className="mb-4 text-sm">
          <Link href="/requests/deleted" className="text-brand hover:underline">
            الطلبات المحذوفة
          </Link>
        </div>
      )}
      <Card>
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 xl:items-end">
          <div className="flex flex-col gap-1 xl:col-span-2">
            <label htmlFor="q" className="text-sm font-medium">
              بحث
            </label>
            <input id="q" name="q" defaultValue={f.q} placeholder="رقم الطلب، مقدم الطلب، الوصف" className="field-input" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="type" className="text-sm font-medium">
              النوع
            </label>
            <select id="type" name="type" defaultValue={f.type ?? ""} className="field-input">
              <option value="">الكل</option>
              {REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REQUEST_TYPE[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="status" className="text-sm font-medium">
              الحالة
            </label>
            <select id="status" name="status" defaultValue={f.status.join(",")} className="field-input">
              <option value="">الكل</option>
              <option value="NEW,UNDER_REVIEW,REFERRED,FOLLOWING">المفتوحة</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS[s].label}
                </option>
              ))}
              {f.status.length > 1 && !["NEW,UNDER_REVIEW,REFERRED,FOLLOWING"].includes(f.status.join(",")) && <option value={f.status.join(",")}>{f.status.map((s) => REQUEST_STATUS[s].label).join(" أو ")}</option>}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="owner" className="text-sm font-medium">
              المسؤول
            </label>
            <select id="owner" name="owner" defaultValue={f.owner ?? ""} className="field-input">
              <option value="">الكل</option>
              <option value="none">غير محدد</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName}
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
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="text-sm font-medium">
              استُلم من
            </label>
            <input id="from" name="from" type="date" defaultValue={f.from} className="field-input ltr-num" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="text-sm font-medium">
              إلى
            </label>
            <input id="to" name="to" type="date" defaultValue={f.to} className="field-input ltr-num" />
          </div>
          {f.outcome && <input type="hidden" name="outcome" value={f.outcome} />}
          {f.applicant && <input type="hidden" name="applicant" value={f.applicant} />}
          <input type="hidden" name="sort" value={f.sort} />
          <input type="hidden" name="dir" value={f.dir} />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4 xl:col-span-8">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="overdue" value="1" defaultChecked={!!f.overdue} className="h-4 w-4 accent-brand" />
              المتأخرة عن موعد المتابعة فقط
            </label>
            <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              بحث
            </button>
            {filtered && (
              <Link href="/requests" className="rounded-md px-4 py-2 text-sm text-brand hover:bg-brand-soft">
                مسح الفلاتر
              </Link>
            )}
            {f.outcome && <Badge tone={f.outcome === "done" ? "success" : "danger"}>{f.outcome === "done" ? "المنجزة (تشمل المغلقة على إنجاز)" : "المتعذرة (تشمل المغلقة على تعذر)"}</Badge>}
            <span className="ltr-num ms-auto text-sm text-muted">{total} طلب</span>
          </div>
        </form>
        <DataTable>
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <SortHeader base="/requests" f={fq} col="receivedAt" defaults={DEFAULTS}>
                الاستلام
              </SortHeader>
              <th>مقدم الطلب</th>
              <th>النوع</th>
              <th>الحالة</th>
              <th>المسؤول</th>
              <SortHeader base="/requests" f={fq} col="followUpDate" defaults={DEFAULTS}>
                موعد المتابعة
              </SortHeader>
              <SortHeader base="/requests" f={fq} col="priority" defaults={DEFAULTS}>
                الأولوية
              </SortHeader>
              <th className="hidden 2xl:table-cell">آخر إجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const late = isOverdue(r);
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/requests/${r.id}`} className="ltr-num font-medium text-brand hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="ltr-num whitespace-nowrap">{fmtDay(r.receivedAt)}</td>
                  <td className="min-w-40">{r.applicantName}</td>
                  <td className="whitespace-nowrap">{REQUEST_TYPE[r.type]}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
                      {late && <Badge tone="danger">متأخر</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">{r.owner?.fullName ?? "—"}</td>
                  <td className={`ltr-num whitespace-nowrap ${late ? "font-semibold text-tone-danger" : ""}`}>{fmtDay(r.followUpDate)}</td>
                  <td>
                    <Badge tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Badge>
                  </td>
                  <td className="hidden max-w-xs truncate text-xs text-muted 2xl:table-cell" title={r.lastAction ?? ""}>
                    {r.lastAction ?? "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted">
                  {filtered ? "لا توجد طلبات مطابقة." : "لا توجد طلبات بعد."}
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
        <Pagination base="/requests" f={fq} page={f.page} pages={pages} defaults={DEFAULTS} />
      </Card>
    </>
  );
}
