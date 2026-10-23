import type { Violation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/rbac/actor";
import { Alert, Badge, Card, Field } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { DEFAULT_TZ, formatDate, formatDateTime, localDateKey } from "@/lib/datetime";
import { daysRemaining } from "@/lib/deadlines/compute";
import { readSnapshot } from "@/lib/services/deadlines";
import { deliveryAction, extensionAction } from "../../workflow-actions";

const METHOD_LABELS = { HAND: "تسليم باليد", REGISTERED_MAIL: "بريد مسجل", OFFICIAL_COURIER: "مراسل رسمي", EMAIL: "بريد إلكتروني", OTHER: "أخرى" } as const;
export const DEADLINE_LABELS = {
  NOT_STARTED: "لم يبدأ الاحتساب", RUNNING: "المدة سارية", NEAR_EXPIRY: "اقترب انتهاء المدة", EXPIRED: "انتهت المدة دون تسجيل استجابة",
  EXTENDED: "المدة ممددة بموافقة معتمدة", SUSPENDED: "المدة معلقة بقرار موثق", PENDING_REVIEW: "بانتظار مراجعة الموظف المختص", STOPPED: "توقف الاحتساب",
} as const;
export const DEADLINE_TONE = { NOT_STARTED: "neutral", RUNNING: "info", NEAR_EXPIRY: "warning", EXPIRED: "danger", EXTENDED: "info", SUSPENDED: "neutral", PENDING_REVIEW: "warning", STOPPED: "neutral" } as const;
const UNIT = { CALENDAR_DAYS: "يوماً تقويمياً", WORKING_DAYS: "يوم عمل" } as const;
const START = { RECEIPT_DATE: "من يوم الاستلام (يُحتسب يوم الاستلام)", DAY_AFTER_RECEIPT: "من اليوم التالي للاستلام" } as const;
const REQ = { PENDING: "قيد المراجعة", APPROVED: "موافق عليه", REJECTED: "مرفوض", WITHDRAWN: "مسحوب" } as const;

export async function DeliverySections({ actor, v }: { actor: Actor; v: Violation }) {
  const [warnings, deadlines, extensions] = await Promise.all([
    prisma.warning.findMany({
      where: { violationId: v.id, status: { in: ["SIGNED", "SENT", "DELIVERED"] } },
      include: { deliveries: { orderBy: { recordedAt: "asc" }, include: { corrections: { orderBy: { createdAt: "asc" } } } } },
    }),
    prisma.deadlineCalculation.findMany({ where: { violationId: v.id }, orderBy: { computedAt: "desc" } }),
    prisma.extensionRequest.findMany({ where: { violationId: v.id }, orderBy: { createdAt: "desc" } }),
  ]);
  if (warnings.length === 0) return null;
  const ids = new Set([...warnings.flatMap((w) => w.deliveries.flatMap((d) => [d.recordedById, ...d.corrections.map((c) => c.approvedById)])), ...extensions.flatMap((e) => [e.createdById, e.decidedById])].filter(Boolean) as string[]);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const current = deadlines.find((d) => d.isCurrent);
  const snap = current ? readSnapshot(current) : null;
  const today = localDateKey(new Date(), DEFAULT_TZ);
  const pendingExt = extensions.find((e) => e.status === "PENDING");

  return (
    <>
      <Card title="التبليغ ووصل الاستلام">
        {warnings.map((w) => (
          <div key={w.id} className="flex flex-col gap-3">
            <div className="text-sm">الإنذار <bdi className="font-semibold">{w.number}</bdi> — وُقِّع في {formatDate(w.signedAt)}</div>
            {w.deliveries.map((d) => (
              <dl key={d.id} className="grid gap-x-6 gap-y-1 rounded-md bg-band p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-muted">تاريخ الإرسال</dt><dd>{formatDate(d.sentAt)}</dd></div>
                <div><dt className="text-xs text-muted">طريقة التبليغ</dt><dd>{METHOD_LABELS[d.method]}</dd></div>
                <div><dt className="text-xs text-muted">تاريخ الاستلام الفعلي</dt><dd>{d.receivedAt ? formatDateTime(d.receivedAt) : <Badge tone="warning">بانتظار إثبات التبليغ</Badge>}</dd></div>
                <div><dt className="text-xs text-muted">المستلم وصفته</dt><dd>{d.recipientName ? `${d.recipientName}${d.recipientCapacity ? ` (${d.recipientCapacity})` : ""}` : "—"}</dd></div>
                <div><dt className="text-xs text-muted">رقم وصل الاستلام</dt><dd><bdi>{d.receiptNumber ?? "—"}</bdi></dd></div>
                <div><dt className="text-xs text-muted">سجّله</dt><dd>{names.get(d.recordedById)} — {formatDateTime(d.recordedAt)}</dd></div>
                {d.notes && <div className="sm:col-span-3"><dt className="text-xs text-muted">ملاحظات التبليغ</dt><dd>{d.notes}</dd></div>}
                {d.corrections.map((c) => (
                  <div key={c.id} className="text-xs text-tone-warning sm:col-span-3">
                    تصحيح تاريخ الاستلام من {formatDateTime(c.oldReceivedAt)} إلى {formatDateTime(c.newReceivedAt)} — {c.reason} — اعتمده {names.get(c.approvedById)} في {formatDateTime(c.createdAt)}
                  </div>
                ))}
                {!d.receivedAt && can(actor, "delivery.record") && (
                  <div className="sm:col-span-3">
                    <ActForm action={deliveryAction} hidden={{ violationId: v.id, deliveryId: d.id, op: "receipt" }} submit="تسجيل الاستلام"
                      confirm={{ title: "تسجيل استلام الإنذار", message: "يبدأ احتساب المدة القانونية من تاريخ الاستلام المسجل وفق القاعدة المعتمدة." }} className="mt-2 grid sm:grid-cols-2">
                      <Field label="تاريخ الاستلام الفعلي" htmlFor={`rd-${d.id}`} required><input id={`rd-${d.id}`} name="receivedDate" type="date" max={today} className="field-input" /></Field>
                      <Field label="وقت الاستلام" htmlFor={`rt-${d.id}`} hint="اختياري"><input id={`rt-${d.id}`} name="receivedTime" type="time" className="field-input" /></Field>
                      <Field label="اسم المستلم" htmlFor={`rn-${d.id}`} required><input id={`rn-${d.id}`} name="recipientName" className="field-input" /></Field>
                      <Field label="صفة المستلم" htmlFor={`rc-${d.id}`}><input id={`rc-${d.id}`} name="recipientCapacity" className="field-input" /></Field>
                      <Field label="رقم وصل الاستلام" htmlFor={`rr-${d.id}`} required><input id={`rr-${d.id}`} name="receiptNumber" className="field-input" /></Field>
                      <Field label="صورة ضوئية من الوصل" htmlFor={`rf-${d.id}`} required><input id={`rf-${d.id}`} name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="field-input" /></Field>
                      <Field label="ملاحظات" htmlFor={`rx-${d.id}`} className="sm:col-span-2"><input id={`rx-${d.id}`} name="notes" className="field-input" /></Field>
                    </ActForm>
                  </div>
                )}
                {d.receivedAt && can(actor, "delivery.correct_receipt") && v.generalStatus === "OPEN" && (
                  <details className="sm:col-span-3">
                    <summary className="cursor-pointer text-xs text-brand">تصحيح تاريخ الاستلام</summary>
                    <ActForm action={deliveryAction} hidden={{ violationId: v.id, deliveryId: d.id, op: "correct" }} submit="اعتماد التصحيح" variant="secondary"
                      confirm={{ title: "تصحيح تاريخ الاستلام", message: "تُحفظ القيمة السابقة والجديدة والسبب وهويتك، ويُعاد احتساب المدة بقاعدتها المحفوظة." }} className="mt-2 grid sm:grid-cols-3">
                      <Field label="التاريخ الصحيح" htmlFor={`cd-${d.id}`} required><input id={`cd-${d.id}`} name="receivedDate" type="date" max={today} className="field-input" /></Field>
                      <Field label="الوقت" htmlFor={`ct-${d.id}`}><input id={`ct-${d.id}`} name="receivedTime" type="time" className="field-input" /></Field>
                      <Field label="سبب التصحيح" htmlFor={`cr-${d.id}`} required><input id={`cr-${d.id}`} name="reason" className="field-input" /></Field>
                    </ActForm>
                  </details>
                )}
              </dl>
            ))}
            {w.status === "SIGNED" && v.stage === "AWAITING_DELIVERY" && can(actor, "delivery.record") && (
              <ActForm action={deliveryAction} hidden={{ violationId: v.id, warningId: w.id, op: "dispatch" }} submit="تسجيل إرسال الإنذار" className="grid sm:grid-cols-3">
                <Field label="تاريخ إرسال الإنذار" htmlFor="sentAt" required><input id="sentAt" name="sentAt" type="date" max={today} className="field-input" /></Field>
                <Field label="طريقة التبليغ" htmlFor="method" required>
                  <select id="method" name="method" className="field-input">{Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </Field>
                <Field label="ملاحظات التبليغ" htmlFor="dnotes"><input id="dnotes" name="notes" className="field-input" /></Field>
              </ActForm>
            )}
          </div>
        ))}
      </Card>

      <Card title="المدة القانونية">
        {!current ? (
          <Alert tone="neutral">لم يبدأ الاحتساب: يبدأ فقط بعد توثيق تاريخ استلام الإنذار وإثباته.</Alert>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={DEADLINE_TONE[current.status]}>{DEADLINE_LABELS[current.status]}</Badge>
              {current.dueDate && current.status !== "EXPIRED" && (() => {
                const left = daysRemaining(current.dueDate, new Date(), DEFAULT_TZ);
                return <span className="text-xs text-muted">{left === 0 ? "تنتهي اليوم" : `متبقٍ ${left} يوماً تقويمياً`}</span>;
              })()}
            </div>
            {current.status === "PENDING_REVIEW" && (
              <>
                <Alert tone="warning">لا توجد قاعدة مدة سارية بتاريخ الاستلام لنوع هذه المخالفة، فلم تُحتسب مدة. بعد إضافة القاعدة المعتمدة من «المدد القانونية» تُطبَّق هنا.</Alert>
                {(can(actor, "deadline.rules_manage") || can(actor, "delivery.correct_receipt")) && (
                  <ActForm action={deliveryAction} hidden={{ violationId: v.id, op: "apply_rule" }} submit="تطبيق القاعدة السارية" variant="secondary" />
                )}
              </>
            )}
            {snap && (
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-muted">القاعدة</dt><dd>{snap.rule.nameAr}</dd></div>
                <div><dt className="text-xs text-muted">المدة</dt><dd>{snap.rule.duration} {UNIT[snap.rule.unit]}{snap.rule.unit === "CALENDAR_DAYS" && snap.rule.excludeHolidays ? " (تمتد إذا صادف آخرها عطلة)" : ""}</dd></div>
                <div><dt className="text-xs text-muted">بدء الاحتساب</dt><dd>{START[snap.rule.startEvent]}</dd></div>
                <div><dt className="text-xs text-muted">اليوم الأول</dt><dd>{formatDate(current.startDate, undefined, "UTC")}</dd></div>
                <div><dt className="text-xs text-muted">تاريخ الانتهاء الأصلي</dt><dd>{formatDateTime(current.originalDueDate)}</dd></div>
                <div><dt className="text-xs text-muted">تاريخ الانتهاء الحالي</dt><dd className="font-semibold">{formatDateTime(current.dueDate)}</dd></div>
                <div><dt className="text-xs text-muted">مجموع التمديد</dt><dd>{current.totalExtensionDays} يوماً</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted">السند</dt><dd>{snap.rule.legalBasis}</dd></div>
              </dl>
            )}
            {deadlines.length > 1 && <p className="text-xs text-muted">توجد {deadlines.length - 1} عملية احتساب سابقة محفوظة.</p>}
          </div>
        )}
      </Card>

      {(current || extensions.length > 0) && (
        <Card title="طلبات التمديد">
          {extensions.length === 0 && <p className="text-sm text-muted">لا توجد طلبات تمديد.</p>}
          <ul className="flex flex-col divide-y divide-line">
            {extensions.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.status === "APPROVED" ? "success" : e.status === "REJECTED" ? "danger" : "warning"}>{REQ[e.status]}</Badge>
                  <span>طلب {e.requestedDays} يوماً بتاريخ {formatDate(e.requestedAt, undefined, "UTC")}</span>
                  {e.grantedDays && <span>— مُنح {e.grantedDays} يوماً، الاستحقاق الجديد {formatDateTime(e.newDueDate)}</span>}
                </div>
                <p className="text-xs">الأسباب: {e.reasons}</p>
                {e.opinion && <p className="text-xs">الرأي: {e.opinion}</p>}
                <p className="text-xs text-muted">سجّله {names.get(e.createdById)}{e.decidedById && ` — قرار ${names.get(e.decidedById)} في ${formatDateTime(e.decidedAt)}${e.decisionNotes ? `: ${e.decisionNotes}` : ""}`}</p>
                {e.status === "PENDING" && can(actor, "extension.decide") && (
                  <div className="mt-2 grid gap-3 rounded-md bg-band p-3 sm:grid-cols-2">
                    <ActForm action={extensionAction} hidden={{ violationId: v.id, requestId: e.id, op: "approve" }} submit="الموافقة على التمديد"
                      confirm={{ title: "الموافقة على التمديد", message: "يُحتسب تاريخ الاستحقاق الجديد من تاريخ الانتهاء الحالي بوحدة القاعدة المعتمدة." }}>
                      <Field label="المدة الممنوحة (يوم)" htmlFor={`gd-${e.id}`}><input id={`gd-${e.id}`} name="grantedDays" type="number" min={1} defaultValue={e.requestedDays} className="field-input" /></Field>
                      <Field label="ملاحظات القرار" htmlFor={`gn-${e.id}`}><input id={`gn-${e.id}`} name="notes" className="field-input" /></Field>
                    </ActForm>
                    <ActForm action={extensionAction} hidden={{ violationId: v.id, requestId: e.id, op: "reject" }} submit="رفض الطلب" variant="danger"
                      confirm={{ title: "رفض طلب التمديد", message: "يبقى تاريخ الاستحقاق كما هو." }}>
                      <Field label="سبب الرفض" htmlFor={`rj-${e.id}`} required><input id={`rj-${e.id}`} name="notes" className="field-input" /></Field>
                    </ActForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {current && snap && !pendingExt && can(actor, "extension.record") && ["DEADLINE_RUNNING", "DEADLINE_EXPIRED"].includes(v.stage) && (
            snap.rule.extensionAllowed ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-brand">تسجيل طلب تمديد من الجهة المخالفة</summary>
                <ActForm action={extensionAction} hidden={{ violationId: v.id, op: "record" }} submit="تسجيل الطلب" className="mt-3 grid sm:grid-cols-2">
                  <Field label="تاريخ الطلب" htmlFor="xr" required><input id="xr" name="requestedAt" type="date" max={today} className="field-input" /></Field>
                  <Field label="المدة الإضافية المطلوبة (يوم)" htmlFor="xd" required hint={snap.rule.maxExtensionDays ? `الحد الأقصى في القاعدة: ${snap.rule.maxExtensionDays} يوماً` : undefined}>
                    <input id="xd" name="requestedDays" type="number" min={1} className="field-input" />
                  </Field>
                  <Field label="أسباب الطلب" htmlFor="xs" required className="sm:col-span-2"><textarea id="xs" name="reasons" rows={2} className="field-input" /></Field>
                  <Field label="الرأي الفني أو القانوني" htmlFor="xo" className="sm:col-span-2"><textarea id="xo" name="opinion" rows={2} className="field-input" /></Field>
                  <Field label="المرفقات" htmlFor="xf"><input id="xf" name="files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx" className="field-input" /></Field>
                  <p className="text-xs text-muted sm:col-span-2">تقديم الطلب لا يغيّر تاريخ الاستحقاق؛ يُمنح التمديد فقط بعد موافقة صاحب الصلاحية.</p>
                </ActForm>
              </details>
            ) : <p className="mt-3 text-xs text-muted">قاعدة المدة المعتمدة لهذه المخالفة لا تجيز التمديد.</p>
          )}
        </Card>
      )}
    </>
  );
}
