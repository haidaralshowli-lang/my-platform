import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { orNotFound } from "@/lib/page-helpers";
import { dayInput, fmtDay, todayStr } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";
import { CONSENT, PRIORITY, REQUEST_STATUS, REQUEST_TYPE, TASK_STATUS } from "@/lib/labels";
import { allowedTransitions, getRequest, isOverdue, requestFormOptions } from "@/lib/services/requests";
import { Alert, Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { ProgressBar, RequestDisclaimer } from "@/components/list";
import { updateRequestAction } from "../actions";
import { AddActionForm, DeleteRequestForm, RequestForm, TransitionForm } from "../forms";

export const metadata = { title: "تفاصيل الطلب" };

const EVENT_LABELS: Record<string, string> = {
  created: "تسجيل الطلب",
  updated: "تعديل البيانات",
  status: "تغيير الحالة",
  action: "إجراء متابعة",
  closed: "اعتماد الإغلاق",
  reopened: "إعادة فتح",
  task_linked: "ربط مهمة",
  deleted: "حذف",
  restored: "استعادة",
};

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("requests.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await orNotFound(getRequest(id));
  const { authorities, owners } = await requestFormOptions();
  const allowed = allowedTransitions(actor, r.status);
  const late = isOverdue(r);
  const closed = r.status === "CLOSED";
  const canUpdate = can(actor, "requests.update");
  // يُبقي القيم الحالية في القوائم حتى لو عُطِّلت لاحقاً
  const authorityOpts = r.authority && !authorities.some((a) => a.id === r.authority!.id) ? [...authorities, { id: r.authority.id, name: `${r.authority.name} (معطلة)` }] : authorities;
  const ownerOpts = owners.map((o) => ({ id: o.id, name: o.fullName }));
  if (r.owner && !owners.some((o) => o.id === r.owner!.id)) ownerOpts.push({ id: r.owner.id, name: `${r.owner.fullName} (معطل)` });

  return (
    <>
      <PageHeader
        title={`الطلب ${r.number}`}
        description={`${REQUEST_TYPE[r.type]} — مقدم الطلب: ${r.applicantName}`}
        actions={
          <Link href="/requests" className="text-sm text-brand hover:underline">
            ← العودة إلى الطلبات
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        {sp.created === "1" && r.events.length === 1 && <Alert tone="success">تم تسجيل الطلب برقم {r.number}.</Alert>}
        {late && <Alert tone="danger">الطلب متأخر عن موعد المتابعة ({fmtDay(r.followUpDate)}).</Alert>}
        <RequestDisclaimer />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="بيانات الطلب" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">الحالة</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                <Badge tone={REQUEST_STATUS[r.status].tone}>{REQUEST_STATUS[r.status].label}</Badge>
                {closed && r.failureReason && <Badge tone="danger">أُغلق على تعذر</Badge>}
                {late && <Badge tone="danger">متأخر</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">الأولوية</dt>
              <dd className="mt-0.5">
                <Badge tone={PRIORITY[r.priority].tone}>{PRIORITY[r.priority].label}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted">تاريخ الاستلام</dt>
              <dd className="ltr-num">{fmtDay(r.receivedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">موعد المتابعة</dt>
              <dd className={`ltr-num ${late ? "font-semibold text-tone-danger" : ""}`}>{fmtDay(r.followUpDate)}</dd>
            </div>
            <div>
              <dt className="text-muted">مقدم الطلب</dt>
              <dd>
                {r.applicantName}
                {r.applicant && (
                  <Link href={`/people/${r.applicant.id}`} className="ms-2 text-xs text-brand hover:underline">
                    (السجل رقم {r.applicant.serial})
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted">الجهة المختصة</dt>
              <dd>{r.authority?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">المسؤول عن المتابعة</dt>
              <dd>{r.owner?.fullName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">سجّله</dt>
              <dd>
                {r.createdBy?.fullName ?? "—"} <span className="ltr-num text-xs text-muted">{fmtDateTime(r.createdAt)}</span>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted">وصف الطلب</dt>
              <dd className="whitespace-pre-line">{r.description}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted">آخر إجراء</dt>
              <dd>{r.lastAction ?? "—"}</dd>
            </div>
            {r.failureReason && (
              <div className="sm:col-span-2">
                <dt className="text-muted">سبب التعذر</dt>
                <dd className="text-tone-danger">{r.failureReason}</dd>
              </div>
            )}
            {r.closedAt && (
              <div>
                <dt className="text-muted">تاريخ الإغلاق</dt>
                <dd className="ltr-num">{fmtDateTime(r.closedAt)}</dd>
              </div>
            )}
          </dl>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="تحديث الحالة">
            <TransitionForm id={r.id} allowed={allowed} authorities={authorityOpts} currentAuthorityId={r.authorityId} />
          </Card>
          {canUpdate && !closed && (
            <Card title="تسجيل إجراء متابعة">
              <AddActionForm id={r.id} />
            </Card>
          )}
        </div>
        <Card title="السجل الزمني للطلب" className="lg:col-span-2">
          <ol className="relative space-y-4 border-s border-line ps-4">
            {r.events.map((e) => (
              <li key={String(e.id)} className="text-sm">
                <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-accent" aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span>
                  {e.toStatus && e.fromStatus && (
                    <span className="text-xs">
                      {REQUEST_STATUS[e.fromStatus].label} ← <b>{REQUEST_STATUS[e.toStatus].label}</b>
                    </span>
                  )}
                  <span className="ltr-num text-xs text-muted">{fmtDateTime(e.at)}</span>
                  <span className="text-xs text-muted">بواسطة {e.user?.fullName ?? "—"}</span>
                </div>
                {e.note && <p className="mt-0.5 text-muted">{e.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
        <Card
          title={`المهام المرتبطة (${r.tasks.length})`}
          actions={
            can(actor, "tasks.create") && !closed ? (
              <LinkButton href={`/tasks/new?request=${r.id}`} size="sm" variant="secondary">
                <Plus className="h-3.5 w-3.5" aria-hidden /> مهمة
              </LinkButton>
            ) : undefined
          }
        >
          {r.tasks.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مهام مرتبطة.</p>
          ) : (
            <ul className="divide-y divide-line">
              {r.tasks.map((t) => (
                <li key={t.id} className="py-2 text-sm">
                  <Link href={`/tasks/${t.id}`} className="text-brand hover:underline">
                    <span className="ltr-num text-muted">{t.number}</span> {t.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                    {t.consentStatus !== "ACCEPTED" && <Badge tone={CONSENT[t.consentStatus].tone}>{CONSENT[t.consentStatus].label}</Badge>}
                    <ProgressBar value={t.progress} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canUpdate && !closed && (
          <Card title="تعديل بيانات الطلب" className="lg:col-span-2">
            <details>
              <summary className="cursor-pointer text-sm text-brand">عرض نموذج التعديل</summary>
              <div className="mt-4">
                <RequestForm
                  action={updateRequestAction.bind(null, r.id)}
                  authorities={authorityOpts}
                  owners={ownerOpts}
                  today={todayStr()}
                  submitLabel="حفظ التعديلات"
                  initial={{
                    receivedAt: dayInput(r.receivedAt),
                    applicantName: r.applicantName,
                    applicant: r.applicant,
                    type: r.type,
                    description: r.description,
                    authorityId: r.authorityId,
                    ownerId: r.ownerId,
                    priority: r.priority,
                    followUpDate: dayInput(r.followUpDate),
                  }}
                />
              </div>
            </details>
          </Card>
        )}
        {can(actor, "requests.delete") && (
          <Card title="حذف الطلب">
            <DeleteRequestForm id={r.id} />
          </Card>
        )}
      </div>
    </>
  );
}
