import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/auth/server";
import { can } from "@/lib/rbac/actor";
import { orNotFound } from "@/lib/page-helpers";
import { getCaseForActor } from "@/lib/services/criminal";
import { Alert, Badge, Card, Field, PageHeader } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { DEFAULT_TZ, formatDate, formatDateTime, localDateKey } from "@/lib/datetime";
import { CASE_DOC_TYPES, CASE_STATUS_LABELS as CASE_STATUS, docTypeLabel } from "@/lib/documents";
import { STAGE_LABELS } from "@/lib/workflow/labels";
import { caseAction } from "../../workflow-actions";

export const metadata = { title: "ملف الدعوى الجزائية" };
const PROC = { UNKNOWN: "غير معلومة", NOT_FINAL: "غير مكتسب الدرجة القطعية", APPEALED: "مطعون فيه", FINAL: "مكتسب الدرجة القطعية" } as const;
const DONE: Record<string, string> = {
  opened: "اعتُمد عدم الاستجابة وفُتح ملف الدعوى الجزائية.", update: "حُفظت بيانات الدعوى.", referral: "سُجِّلت الإحالة.", event: "أُضيف الإجراء القضائي.",
  docs: "رُفعت المستندات.", judgment: "سُجِّل الحكم.", approve_judgment: "اعتُمدت بيانات الحكم.", judgment_status: "حُدِّثت الحالة الإجرائية للحكم.",
};

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const c = await orNotFound(getCaseForActor(actor, id));
  const v = c.violation;
  const manage = can(actor, "criminal.manage") && c.status !== "CLOSED";
  const [warning, delivery, deadline, coreDocs, caseDocs, tech, legal, users, resultTypes] = await Promise.all([
    c.warningId ? prisma.warning.findUnique({ where: { id: c.warningId } }) : null,
    prisma.deliveryRecord.findFirst({ where: { warning: { violationId: v.id }, receivedAt: { not: null } }, orderBy: { receivedAt: "desc" } }),
    prisma.deadlineCalculation.findFirst({ where: { violationId: v.id }, orderBy: { computedAt: "desc" } }),
    prisma.attachment.findMany({ where: { violationId: v.id, ownerType: { in: ["Violation", "Warning", "DeliveryRecord"] }, withdrawnAt: null }, include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } } }),
    prisma.attachment.findMany({ where: { ownerType: "CriminalCase", ownerId: c.id }, include: { versions: { orderBy: { versionNo: "desc" } } }, orderBy: { createdAt: "asc" } }),
    prisma.technicalAssessment.findFirst({ where: { violationId: v.id, status: "APPROVED" }, orderBy: { createdAt: "desc" } }),
    prisma.legalAssessment.findFirst({ where: { violationId: v.id, status: "APPROVED" }, orderBy: { createdAt: "desc" } }),
    prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: "criminal.manage" } } } } } } }, select: { id: true, fullName: true } }),
    prisma.judgmentResultType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" } }),
  ]);
  const today = localDateKey(new Date(), DEFAULT_TZ);
  const fileLink = (a: { versions: { id: string; originalName: string }[] }) => a.versions[0] && (
    <a className="text-brand underline" href={`/api/files/${a.versions[0].id}`} target="_blank" rel="noopener">{a.versions[0].originalName}</a>
  );

  return (
    <>
      <PageHeader title={`ملف الدعوى ${c.number}`} description={`${v.offenderName} — المخالفة ${v.number}`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="legal">{CASE_STATUS[c.status]}</Badge>
        <Badge tone="info">{STAGE_LABELS[v.stage]}</Badge>
        <Link href={`/violations/${v.id}`} className="text-sm text-brand underline">ملف المخالفة الأصلي</Link>
      </div>
      {sp.done && DONE[sp.done] && <div className="mb-4"><Alert tone="success">{DONE[sp.done]}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card title="بيانات الدعوى">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-xs text-muted">رقم الإنذار وتاريخه</dt><dd><bdi>{warning?.number ?? "—"}</bdi> {formatDate(warning?.preparedAt)}</dd></div>
              <div><dt className="text-xs text-muted">تاريخ استلام الإنذار</dt><dd>{formatDateTime(delivery?.receivedAt)}</dd></div>
              <div><dt className="text-xs text-muted">انتهاء المدة القانونية</dt><dd>{formatDateTime(deadline?.dueDate)}</dd></div>
              <div><dt className="text-xs text-muted">تاريخ الإحالة</dt><dd>{formatDate(c.referralAt, undefined, "UTC")}</dd></div>
              <div><dt className="text-xs text-muted">رقم الدعوى القضائية</dt><dd><bdi>{c.courtCaseNumber ?? "—"}</bdi></dd></div>
              <div><dt className="text-xs text-muted">المحكمة</dt><dd>{c.courtName ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">تاريخ تسجيل الدعوى</dt><dd>{formatDate(c.courtRegisteredAt, undefined, "UTC")}</dd></div>
              <div><dt className="text-xs text-muted">المسؤول عن المتابعة</dt><dd>{c.followUpOwner?.fullName ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted">آخر إجراء</dt><dd>{c.lastAction ?? "—"}</dd></div>
              <div className="sm:col-span-3"><dt className="text-xs text-muted">إثبات عدم الاستجابة</dt><dd>{c.nonResponseProof}</dd></div>
              {c.notes && <div className="sm:col-span-3"><dt className="text-xs text-muted">ملاحظات</dt><dd>{c.notes}</dd></div>}
            </dl>
            {manage && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-brand">تحديث بيانات الدعوى</summary>
                <ActForm action={caseAction} hidden={{ caseId: c.id, op: "update" }} submit="حفظ" className="mt-3 grid sm:grid-cols-2">
                  <Field label="رقم الدعوى القضائية" htmlFor="ccn"><input id="ccn" name="courtCaseNumber" defaultValue={c.courtCaseNumber ?? ""} className="field-input" /></Field>
                  <Field label="اسم المحكمة أو الجهة القضائية" htmlFor="cn"><input id="cn" name="courtName" defaultValue={c.courtName ?? ""} className="field-input" /></Field>
                  <Field label="تاريخ تسجيل الدعوى" htmlFor="cra"><input id="cra" name="courtRegisteredAt" type="date" max={today} defaultValue={c.courtRegisteredAt?.toISOString().slice(0, 10)} className="field-input" /></Field>
                  <Field label="المسؤول عن المتابعة" htmlFor="fo">
                    <select id="fo" name="followUpOwnerId" defaultValue={c.followUpOwnerId ?? ""} className="field-input"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
                  </Field>
                  <Field label="آخر إجراء قضائي" htmlFor="la" className="sm:col-span-2"><input id="la" name="lastAction" defaultValue={c.lastAction ?? ""} className="field-input" /></Field>
                  <Field label="ملاحظات" htmlFor="cno" className="sm:col-span-2"><textarea id="cno" name="notes" rows={2} defaultValue={c.notes ?? ""} className="field-input" /></Field>
                </ActForm>
              </details>
            )}
          </Card>

          {c.status === "PREPARING" && manage && (
            <Card title="إحالة الدعوى">
              <ActForm action={caseAction} hidden={{ caseId: c.id, op: "referral" }} submit="تسجيل الإحالة" className="grid sm:grid-cols-3"
                confirm={{ title: "تسجيل الإحالة", message: "تنتقل المعاملة إلى «بانتظار الحكم أو استكمال مستندات الدعوى»." }}>
                <Field label="تاريخ الإحالة" htmlFor="ra" required><input id="ra" name="referralAt" type="date" max={today} className="field-input" /></Field>
                <Field label="رقم كتاب الإحالة" htmlFor="rn"><input id="rn" name="letterNumber" className="field-input" /></Field>
                <Field label="مستند الإحالة" htmlFor="rf" required><input id="rf" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" className="field-input" /></Field>
              </ActForm>
            </Card>
          )}

          <Card title="الإجراءات والجلسات">
            {c.events.length === 0 ? <p className="text-sm text-muted">لا توجد إجراءات مسجلة.</p> : (
              <ol className="flex flex-col gap-3 border-s-2 border-line ps-4">
                {c.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="font-medium">{e.eventType} — {formatDate(e.eventAt, undefined, "UTC")}</div>
                    <p>{e.description}</p>
                    {e.nextHearingAt && <p className="text-xs text-muted">الجلسة القادمة: {formatDate(e.nextHearingAt, undefined, "UTC")}</p>}
                  </li>
                ))}
              </ol>
            )}
            {manage && c.status !== "PREPARING" && (
              <ActForm action={caseAction} hidden={{ caseId: c.id, op: "event" }} submit="إضافة إجراء" variant="secondary" className="mt-4 grid sm:grid-cols-3">
                <Field label="نوع الإجراء" htmlFor="et" required><input id="et" name="eventType" placeholder="جلسة، قرار تمهيدي، تبليغ…" className="field-input" /></Field>
                <Field label="تاريخه" htmlFor="ea" required><input id="ea" name="eventAt" type="date" max={today} className="field-input" /></Field>
                <Field label="موعد الجلسة القادمة" htmlFor="en"><input id="en" name="nextHearingAt" type="date" className="field-input" /></Field>
                <Field label="الوصف" htmlFor="ed" required className="sm:col-span-3"><input id="ed" name="description" className="field-input" /></Field>
              </ActForm>
            )}
          </Card>

          <Card title="الأحكام القضائية">
            {c.judgments.length === 0 ? <p className="text-sm text-muted">لم يُسجَّل حكم.</p> : (
              <ul className="flex flex-col divide-y divide-line">
                {c.judgments.map((j) => (
                  <li key={j.id} className="flex flex-col gap-1 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">الحكم <bdi>{j.number}</bdi></span>
                      <span>{formatDate(j.judgmentDate, undefined, "UTC")} — {j.courtName}</span>
                      <Badge tone={j.proceduralStatus === "FINAL" ? "success" : "warning"}>{PROC[j.proceduralStatus]}</Badge>
                      {j.approvedById ? <Badge tone="success">معتمد</Badge> : <Badge tone="warning">بانتظار الاعتماد</Badge>}
                      {j.resultType && <Badge tone="legal">{j.resultType.nameAr}</Badge>}
                    </div>
                    <p>{j.summary}</p>
                    {j.appealNote && <p className="text-xs">الطعن أو الإجراء اللاحق: {j.appealNote}</p>}
                    {j.legalNotes && <p className="text-xs">ملاحظات الدائرة القانونية: {j.legalNotes}</p>}
                    <p className="text-xs text-muted">استلام النسخة: {formatDate(j.copyReceivedAt, undefined, "UTC")} — أدخله في {formatDateTime(j.createdAt)}{j.approvedAt && ` — اعتُمد في ${formatDateTime(j.approvedAt)}`}</p>
                    {!j.approvedById && can(actor, "judgment.approve") && j.enteredById !== actor.id && (
                      <ActForm action={caseAction} hidden={{ caseId: c.id, op: "approve_judgment", judgmentId: j.id }} submit="اعتماد بيانات الحكم" variant="secondary"
                        confirm={{ title: "اعتماد بيانات الحكم", message: "ينتقل الملف إلى التحقق النهائي. الإغلاق بمسار الدعوى يتطلب حكماً مكتسب الدرجة القطعية." }} />
                    )}
                    {can(actor, "judgment.record") && v.generalStatus === "OPEN" && (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand">تحديث الحالة الإجرائية</summary>
                        <ActForm action={caseAction} hidden={{ caseId: c.id, op: "judgment_status", judgmentId: j.id }} submit="تحديث" variant="secondary" className="mt-2 grid sm:grid-cols-2">
                          <select name="proceduralStatus" defaultValue={j.proceduralStatus} aria-label="الحالة الإجرائية" className="field-input">{Object.entries(PROC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                          <input name="note" required placeholder="السند (إلزامي)" aria-label="سند التحديث" className="field-input" />
                        </ActForm>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {v.stage === "AWAITING_JUDGMENT" && can(actor, "judgment.record") && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-brand">تسجيل حكم صادر</summary>
                <ActForm action={caseAction} hidden={{ caseId: c.id, op: "judgment" }} submit="تسجيل الحكم" className="mt-3 grid sm:grid-cols-3"
                  confirm={{ title: "تسجيل الحكم", message: "لا يُعد الحكم نهائياً لمجرد رفع نسخته؛ حدد حالته الإجرائية المعلومة." }}>
                  <Field label="رقم الحكم" htmlFor="jn" required><input id="jn" name="number" className="field-input" /></Field>
                  <Field label="تاريخ الحكم" htmlFor="jd" required><input id="jd" name="judgmentDate" type="date" max={today} className="field-input" /></Field>
                  <Field label="اسم المحكمة" htmlFor="jc" required><input id="jc" name="courtName" defaultValue={c.courtName ?? ""} className="field-input" /></Field>
                  <Field label="منطوق الحكم أو ملخصه الرسمي" htmlFor="js" required className="sm:col-span-3"><textarea id="js" name="summary" rows={3} className="field-input" /></Field>
                  <Field label="نتيجة الحكم (التصنيف المعتمد)" htmlFor="jr" hint={resultTypes.length ? undefined : "لا توجد تصنيفات؛ تُضاف من إعدادات النظام"}>
                    <select id="jr" name="resultTypeId" className="field-input"><option value="">—</option>{resultTypes.map((r) => <option key={r.id} value={r.id}>{r.nameAr}</option>)}</select>
                  </Field>
                  <Field label="الحالة الإجرائية" htmlFor="jp" required>
                    <select id="jp" name="proceduralStatus" defaultValue="UNKNOWN" className="field-input">{Object.entries(PROC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </Field>
                  <Field label="تاريخ استلام نسخة الحكم" htmlFor="jq"><input id="jq" name="copyReceivedAt" type="date" max={today} className="field-input" /></Field>
                  <Field label="الطعن أو الإجراء اللاحق" htmlFor="ja"><input id="ja" name="appealNote" className="field-input" /></Field>
                  <Field label="ملاحظات الدائرة القانونية" htmlFor="jl" className="sm:col-span-2"><input id="jl" name="legalNotes" className="field-input" /></Field>
                  <Field label="نسخة ضوئية من الحكم" htmlFor="jf" required className="sm:col-span-3"><input id="jf" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="field-input" /></Field>
                </ActForm>
              </details>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="مستندات المخالفة الأصلية">
            <ul className="flex flex-col gap-2 text-sm">
              {coreDocs.map((a) => <li key={a.id}>{docTypeLabel(a.documentType)}: {fileLink(a)}</li>)}
              <li>الموقف الفني: {tech ? `معتمد في ${formatDate(tech.completedAt)}` : "—"}</li>
              <li>المصادقة القانونية: {legal ? `معتمدة في ${formatDate(legal.approvedAt)}` : "—"}</li>
            </ul>
          </Card>
          <Card title={`مستندات الدعوى (${caseDocs.length})`}>
            <ul className="flex flex-col gap-2 text-sm">
              {caseDocs.map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{docTypeLabel(a.documentType)}</span>{a.letterNumber && <> — <bdi>{a.letterNumber}</bdi></>}{a.letterDate && ` — ${formatDate(a.letterDate, undefined, "UTC")}`}
                  <div className="text-xs">{fileLink(a)} — {formatDateTime(a.createdAt)}{a.versions.length > 1 && ` — ${a.versions.length} إصدارات`}</div>
                </li>
              ))}
            </ul>
            {manage && (
              <ActForm action={caseAction} hidden={{ caseId: c.id, op: "docs" }} submit="رفع" variant="secondary" className="mt-4">
                <Field label="نوع المستند" htmlFor="dt" required><select id="dt" name="documentType" className="field-input">{Object.entries(CASE_DOC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="رقمه" htmlFor="dn"><input id="dn" name="letterNumber" className="field-input" /></Field>
                <Field label="تاريخه" htmlFor="dd"><input id="dd" name="letterDate" type="date" className="field-input" /></Field>
                <Field label="الملفات" htmlFor="df" required><input id="df" name="files" type="file" multiple className="field-input" /></Field>
              </ActForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
