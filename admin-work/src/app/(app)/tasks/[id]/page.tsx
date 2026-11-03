import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/server";
import { can } from "@/lib/rbac";
import { orNotFound } from "@/lib/page-helpers";
import { dayInput, fmtDay, todayStr } from "@/lib/dates";
import { fmtDateTime } from "@/lib/format";
import { CONSENT, PRIORITY, REQUEST_STATUS, TASK_STATUS } from "@/lib/labels";
import { getTask, isTaskOverdue } from "@/lib/services/tasks";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ProgressBar } from "@/components/list";
import { cancelAction, closeAction, deleteTaskAction, reopenAction } from "../actions";
import { ConsentForm, DecideChangeForm, DetailsForm, ProgressForm, ReassignForm, ReasonForm } from "../forms";

export const metadata = { title: "تفاصيل المهمة" };

const EVENT_LABELS: Record<string, string> = {
  created: "إنشاء المهمة",
  updated: "تعديل البيانات",
  accepted: "موافقة المكلف",
  declined: "اعتذار المكلف",
  change_requested: "طلب تعديل الموعد",
  change_approved: "اعتماد الموعد الجديد",
  change_rejected: "رفض تعديل الموعد",
  reassigned: "إعادة الإسناد",
  progress: "تحديث الإنجاز",
  closed: "اعتماد الإغلاق",
  reopened: "إعادة الفتح",
  cancelled: "إلغاء",
  deleted: "حذف",
};

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("tasks.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await orNotFound(getTask(id));
  const today = todayStr();
  const canUpdate = can(actor, "tasks.update");
  const canClose = can(actor, "tasks.close");
  const finished = !!t.closedAt || t.status === "CANCELLED";
  const late = isTaskOverdue(t);
  const accepted = t.consentStatus === "ACCEPTED";

  return (
    <>
      <PageHeader
        title={t.title}
        description={`المهمة ${t.number}`}
        actions={
          <Link href="/tasks" className="text-sm text-brand hover:underline">
            ← العودة إلى المهام
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        {sp.created === "1" && t.events.length === 1 && <Alert tone="success">أُنشئت المهمة برقم {t.number}، وهي بانتظار تسجيل موافقة المكلف.</Alert>}
        {!finished && t.consentStatus === "PENDING" && <Alert tone="warning">المهمة ليست تكليفاً نافذاً بعد: بانتظار موافقة {t.assignee.fullName} على المهمة والموعد {fmtDay(t.dueDate)}.</Alert>}
        {!finished && t.consentStatus === "DECLINED" && <Alert tone="danger">اعتذر المكلف عن المهمة. أعد إسنادها لشخص آخر أو ألغها.</Alert>}
        {!finished && t.consentStatus === "CHANGE_REQUESTED" && (
          <Alert tone="info">
            طلب المكلف تعديل الموعد من {fmtDay(t.dueDate)} إلى {fmtDay(t.proposedDueDate)}. القرار مطلوب.
          </Alert>
        )}
        {late && <Alert tone="danger">المهمة متأخرة عن موعدها ({fmtDay(t.dueDate)}).</Alert>}
        {t.status === "DONE" && !t.closedAt && <Alert tone="info">المهمة منجزة وبانتظار اعتماد الإغلاق من مدير النظام.</Alert>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="بيانات المهمة" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">الحالة</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                {t.closedAt && t.status === "DONE" && <Badge tone="neutral">مغلقة</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">موافقة المكلف</dt>
              <dd className="mt-0.5">
                <Badge tone={CONSENT[t.consentStatus].tone}>{CONSENT[t.consentStatus].label}</Badge>
                {t.consentAt && <span className="ltr-num ms-2 text-xs text-muted">{fmtDateTime(t.consentAt)}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted">الشخص المكلف</dt>
              <dd>
                <Link href={`/people/${t.assignee.id}`} className="text-brand hover:underline">
                  {t.assignee.fullName}
                </Link>{" "}
                <span className="ltr-num text-xs text-muted">
                  #{t.assignee.serial}
                  {t.assignee.phone && ` · ${t.assignee.phone}`}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">نسبة الإنجاز</dt>
              <dd className="mt-1">
                <ProgressBar value={t.progress} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">تاريخ التكليف</dt>
              <dd className="ltr-num">{fmtDateTime(t.assignedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted">الموعد المحدد</dt>
              <dd className={`ltr-num ${late ? "font-semibold text-tone-danger" : ""}`}>{fmtDay(t.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-muted">الأولوية</dt>
              <dd>
                <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted">آخر تحديث</dt>
              <dd className="ltr-num">{fmtDateTime(t.lastUpdateAt)}</dd>
            </div>
            {t.request && (
              <div>
                <dt className="text-muted">الطلب المرتبط</dt>
                <dd>
                  <Link href={`/requests/${t.request.id}`} className="ltr-num text-brand hover:underline">
                    {t.request.number}
                  </Link>{" "}
                  <span className="text-xs text-muted">({REQUEST_STATUS[t.request.status].label})</span>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-muted">أنشأها</dt>
              <dd>{t.createdBy?.fullName ?? "—"}</dd>
            </div>
            {t.details && (
              <div className="sm:col-span-2">
                <dt className="text-muted">التفاصيل</dt>
                <dd className="whitespace-pre-line">{t.details}</dd>
              </div>
            )}
            {t.consentNote && (
              <div className="sm:col-span-2">
                <dt className="text-muted">ملاحظة المكلف</dt>
                <dd>{t.consentNote}</dd>
              </div>
            )}
            {t.obstacles && (
              <div className="sm:col-span-2">
                <dt className="text-muted">المعوقات</dt>
                <dd className="text-tone-danger">{t.obstacles}</dd>
              </div>
            )}
            {t.finalResult && (
              <div className="sm:col-span-2">
                <dt className="text-muted">النتيجة النهائية</dt>
                <dd className="text-tone-success">{t.finalResult}</dd>
              </div>
            )}
          </dl>
        </Card>

        <div className="flex flex-col gap-4">
          {canUpdate && !finished && t.consentStatus === "PENDING" && (
            <Card title="تسجيل رد المكلف">
              <ConsentForm id={t.id} mode="pending" today={today} dueDate={fmtDay(t.dueDate)} />
            </Card>
          )}
          {canUpdate && !finished && t.consentStatus === "CHANGE_REQUESTED" && (
            <Card title="قرار تعديل الموعد">
              <p className="mb-3 text-sm">
                الموعد الحالي <span className="ltr-num font-medium">{fmtDay(t.dueDate)}</span>، والمقترح <span className="ltr-num font-medium">{fmtDay(t.proposedDueDate)}</span>.
              </p>
              <DecideChangeForm id={t.id} />
            </Card>
          )}
          {canUpdate && !finished && accepted && t.status !== "DONE" && (
            <Card title="تحديث مرحلة الإنجاز">
              <ProgressForm id={t.id} current={{ status: t.status, progress: t.progress, obstacles: t.obstacles }} />
            </Card>
          )}
          {canUpdate && !finished && accepted && t.status !== "DONE" && (
            <Card title="اعتذار أو طلب تعديل الموعد">
              <ConsentForm id={t.id} mode="accepted" today={today} dueDate={fmtDay(t.dueDate)} />
            </Card>
          )}
          {canUpdate && !finished && !accepted && (
            <Card title="إعادة الإسناد">
              <ReassignForm id={t.id} today={today} />
            </Card>
          )}
          {canClose && t.status === "DONE" && !t.closedAt && (
            <Card title="اعتماد الإغلاق">
              <ReasonForm action={closeAction.bind(null, t.id)} field="note" label="ملاحظة" button="اعتماد إغلاق المهمة" confirm="ستُغلق المهمة ولا يُسجَّل عليها تحديث إلا بعد إعادة فتحها." />
            </Card>
          )}
          {canClose && t.status === "DONE" && !t.closedAt && (
            <Card title="إعادة للتنفيذ">
              <ReasonForm action={reopenAction.bind(null, t.id)} field="reason" label="سبب الإعادة" required button="إعادة المهمة للتنفيذ" variant="secondary" confirm="ستعود المهمة إلى «قيد التنفيذ»." />
            </Card>
          )}
          {canClose && finished && (
            <Card title="إعادة فتح المهمة">
              <ReasonForm action={reopenAction.bind(null, t.id)} field="reason" label="سبب إعادة الفتح" required button="إعادة الفتح" variant="secondary" confirm="ستعود المهمة مفتوحة وقابلة للتحديث." />
            </Card>
          )}
          {canClose && !finished && t.status !== "DONE" && (
            <Card title="إلغاء المهمة">
              <ReasonForm action={cancelAction.bind(null, t.id)} field="reason" label="سبب الإلغاء" required button="إلغاء المهمة" variant="danger" confirm="ستُلغى المهمة وتُستبعد من نسبة الإنجاز." />
            </Card>
          )}
        </div>

        <Card title="السجل الزمني للمهمة" className="lg:col-span-2">
          <ol className="relative space-y-4 border-s border-line ps-4">
            {t.events.map((e) => (
              <li key={String(e.id)} className="text-sm">
                <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-accent" aria-hidden />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span>
                  {e.fromStatus && e.toStatus && (
                    <span className="text-xs">
                      {TASK_STATUS[e.fromStatus].label} ← <b>{TASK_STATUS[e.toStatus].label}</b>
                    </span>
                  )}
                  {e.progress !== null && <span className="ltr-num text-xs">{e.progress}%</span>}
                  <span className="ltr-num text-xs text-muted">{fmtDateTime(e.at)}</span>
                  <span className="text-xs text-muted">بواسطة {e.user?.fullName ?? "—"}</span>
                </div>
                {e.note && <p className="mt-0.5 text-muted">{e.note}</p>}
              </li>
            ))}
          </ol>
        </Card>

        {canUpdate && !finished && (
          <Card title="تعديل بيانات المهمة">
            <details>
              <summary className="cursor-pointer text-sm text-brand">عرض نموذج التعديل</summary>
              <div className="mt-4">
                <DetailsForm
                  id={t.id}
                  today={today}
                  dueLocked={accepted || t.consentStatus === "CHANGE_REQUESTED"}
                  initial={{ title: t.title, details: t.details, priority: t.priority, dueDate: dayInput(t.dueDate) }}
                />
              </div>
            </details>
          </Card>
        )}
        {can(actor, "tasks.delete") && (
          <Card title="حذف المهمة">
            <ReasonForm action={deleteTaskAction.bind(null, t.id)} field="reason" label="سبب الحذف" required button="حذف المهمة" variant="danger" confirm="ستختفي المهمة من القوائم والمؤشرات، وتبقى في سجل التدقيق." />
          </Card>
        )}
      </div>
    </>
  );
}
