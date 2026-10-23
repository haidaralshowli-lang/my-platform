import Link from "next/link";
import type { ClosurePath, Violation, ViolationOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Actor } from "@/lib/rbac/actor";
import { Alert, Badge, Card, Field, LinkButton } from "@/components/ui";
import { ActForm } from "@/components/act-form";
import { formatDateTime } from "@/lib/datetime";
import { OUTCOME_LABELS } from "@/lib/workflow/labels";
import { closureChecklist } from "@/lib/services/closure";
import { docTypeLabel } from "@/lib/documents";
import { closureAction, nonResponseAction } from "../../workflow-actions";

const PATH_LABELS: Record<ClosurePath, string> = { RESPONSE: "استجابة", CRIMINAL_CASE: "دعوى جزائية", NOT_APPROVED: "عدم الموافقة", OTHER: "نتيجة أخرى معتمدة" };
const REQ = { PENDING: "بانتظار الاعتماد", APPROVED: "معتمد", REJECTED: "مرفوض", WITHDRAWN: "مسحوب" } as const;

/// المسار والنتيجة المقترحان للإغلاق بحسب ما آلت إليه المعاملة (يمكن للمستخدم تغييرهما ضمن المسموح)
function suggested(v: Violation): { path: ClosurePath; outcome: ViolationOutcome } {
  if (v.stage === "NOT_APPROVED") return { path: "NOT_APPROVED", outcome: "NOT_APPROVED" };
  if (v.outcome === "NON_RESPONSE_CRIMINAL") return { path: "CRIMINAL_CASE", outcome: "NON_RESPONSE_CRIMINAL" };
  if (v.outcome === "OBJECTION_APPEAL") return { path: "OTHER", outcome: "OBJECTION_APPEAL" };
  if (v.outcome && ["FINANCIAL_RESPONSE", "TECHNICAL_RESPONSE", "LEGAL_RESPONSE", "FULL_REMOVAL"].includes(v.outcome)) return { path: "RESPONSE", outcome: v.outcome };
  return { path: "OTHER", outcome: "OTHER" };
}

export async function CaseClosureSections({ actor, v }: { actor: Actor; v: Violation }) {
  const [criminalCase, closures, reopens, attachments] = await Promise.all([
    prisma.criminalCase.findUnique({ where: { violationId: v.id }, include: { judgments: { orderBy: { judgmentDate: "desc" }, take: 1 } } }),
    prisma.closureRequest.findMany({ where: { violationId: v.id }, orderBy: { requestedAt: "desc" } }),
    prisma.reopenRecord.findMany({ where: { violationId: v.id }, orderBy: { reopenedAt: "desc" } }),
    prisma.attachment.findMany({ where: { violationId: v.id, withdrawnAt: null }, include: { versions: { orderBy: { versionNo: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = new Set([...closures.flatMap((c) => [c.requestedById, c.decidedById]), ...reopens.map((r) => r.reopenedById)].filter(Boolean) as string[]);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const pending = closures.find((c) => c.status === "PENDING");
  const closable = (v.stage === "AWAITING_FINAL_VERIFICATION" || v.stage === "NOT_APPROVED") && !pending;
  const sug = suggested(v);
  const missing = closable ? await closureChecklist(prisma, v, { path: sug.path, finalOutcome: sug.outcome, supportingAttachmentIds: [] }) : [];
  const showNonResponse = v.stage === "DEADLINE_EXPIRED" || v.stage === "AWAITING_NON_RESPONSE_APPROVAL";

  return (
    <>
      {showNonResponse && (
        <Card title="عدم الاستجابة">
          {v.stage === "DEADLINE_EXPIRED" && (
            <>
              <Alert tone="danger">انتهت المدة القانونية المثبتة دون تسجيل استجابة. لا يُحال الملف إلى الدعوى الجزائية تلقائياً؛ يجب أن يتحقق الموظف المخول ويبدأ الإجراء، ثم يعتمده صاحب الصلاحية.</Alert>
              {can(actor, "nonresponse.initiate") && (
                <ActForm action={nonResponseAction} hidden={{ violationId: v.id, version: String(v.version), op: "initiate" }} submit="بدء إجراء عدم الاستجابة" className="mt-3"
                  confirm={{ title: "بدء إجراء عدم الاستجابة", message: "يُرفع الإجراء لاعتماد صاحب الصلاحية. لن يُفتح ملف الدعوى إلا بعد الاعتماد." }}>
                  <Field label="إثبات عدم الاستجابة وما تحقق منه الموظف" htmlFor="proof" required hint="مثل: مراجعة سجل الوارد والبريد الرسمي حتى تاريخ انتهاء المدة دون ورود أي استجابة">
                    <textarea id="proof" name="proof" rows={3} className="field-input" />
                  </Field>
                </ActForm>
              )}
            </>
          )}
          {v.stage === "AWAITING_NON_RESPONSE_APPROVAL" && (can(actor, "nonresponse.approve") ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ActForm action={nonResponseAction} hidden={{ violationId: v.id, version: String(v.version), op: "approve" }} submit="اعتماد عدم الاستجابة وفتح ملف الدعوى"
                confirm={{ title: "اعتماد عدم الاستجابة", message: "يُنشأ ملف دعوى جزائية مستقل برقم داخلي، مرتبط بالمخالفة، مع بقاء جميع مراحلها السابقة." }}>
                <input name="notes" placeholder="ملاحظات" aria-label="ملاحظات الاعتماد" className="field-input" />
              </ActForm>
              <ActForm action={nonResponseAction} hidden={{ violationId: v.id, version: String(v.version), op: "return" }} submit="إعادة للاستكمال" variant="secondary">
                <input name="notes" required placeholder="السبب (إلزامي)" aria-label="سبب الإعادة" className="field-input" />
              </ActForm>
            </div>
          ) : <p className="text-sm text-muted">بانتظار اعتماد صاحب الصلاحية.</p>)}
        </Card>
      )}

      {criminalCase && (
        <Card title="ملف الدعوى الجزائية" actions={<LinkButton size="sm" variant="secondary" href={`/criminal-cases/${criminalCase.id}`}>فتح ملف الدعوى</LinkButton>}>
          <div className="flex flex-wrap gap-3 text-sm">
            <span>رقم الملف: <bdi className="font-semibold">{criminalCase.number}</bdi></span>
            {criminalCase.courtCaseNumber && <span>رقم الدعوى: <bdi>{criminalCase.courtCaseNumber}</bdi></span>}
            {criminalCase.courtName && <span>{criminalCase.courtName}</span>}
            {criminalCase.lastAction && <span className="text-muted">آخر إجراء: {criminalCase.lastAction}</span>}
            {criminalCase.judgments[0] && <span>الحكم: <bdi>{criminalCase.judgments[0].number}</bdi></span>}
          </div>
        </Card>
      )}

      {(closable || closures.length > 0 || v.generalStatus === "CLOSED" || reopens.length > 0) && (
        <Card title="الإغلاق">
          {closures.length > 0 && (
            <ul className="mb-4 flex flex-col divide-y divide-line">
              {closures.map((c) => (
                <li key={c.id} className="flex flex-col gap-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "danger" : "warning"}>{REQ[c.status]}</Badge>
                    <span>مسار: {PATH_LABELS[c.path]} — النتيجة: {OUTCOME_LABELS[c.finalOutcome]}</span>
                  </div>
                  <p>السبب: {c.reason}</p>
                  {c.notes && <p className="text-xs">ملاحظات: {c.notes}</p>}
                  {c.supportingAttachmentIds.length > 0 && (
                    <p className="text-xs">المستندات المستند إليها: {attachments.filter((a) => c.supportingAttachmentIds.includes(a.id)).map((a) => `${docTypeLabel(a.documentType)} (${a.versions[0]?.originalName})`).join("، ")}</p>
                  )}
                  <p className="text-xs text-muted">طلبه {names.get(c.requestedById)} في {formatDateTime(c.requestedAt)}{c.decidedById && ` — قرار ${names.get(c.decidedById)} في ${formatDateTime(c.decidedAt)}${c.decisionNotes ? `: ${c.decisionNotes}` : ""}`}</p>
                  {c.status === "PENDING" && can(actor, "closure.approve") && c.requestedById !== actor.id && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <ActForm action={closureAction} hidden={{ violationId: v.id, requestId: c.id, op: "approve" }} submit="اعتماد الإغلاق"
                        confirm={{ title: "اعتماد إغلاق المخالفة", message: "يُعاد فحص اكتمال الملف ثم تُغلق المخالفة بالنتيجة النهائية المسجلة. إعادة الفتح لاحقاً تتطلب صلاحية خاصة." }}>
                        <input name="notes" placeholder="ملاحظات" aria-label="ملاحظات الاعتماد" className="field-input" />
                      </ActForm>
                      <ActForm action={closureAction} hidden={{ violationId: v.id, requestId: c.id, op: "reject" }} submit="رفض الطلب" variant="danger">
                        <input name="notes" required placeholder="السبب (إلزامي)" aria-label="سبب الرفض" className="field-input" />
                      </ActForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {reopens.map((r) => (
            <p key={r.id} className="mb-2 text-xs text-tone-warning">أُعيد فتح المخالفة في {formatDateTime(r.reopenedAt)} بواسطة {names.get(r.reopenedById)}: {r.reason}</p>
          ))}

          {closable && (
            <>
              {missing.length > 0 ? (
                <Alert tone="warning">لا يمكن طلب الإغلاق بالمسار المقترح ({PATH_LABELS[sug.path]}) لنقص: {missing.join("؛ ")}</Alert>
              ) : (
                <Alert tone="success">الملف مستوفٍ لشروط الإغلاق بمسار «{PATH_LABELS[sug.path]}» ونتيجة «{OUTCOME_LABELS[sug.outcome]}».</Alert>
              )}
              {can(actor, "closure.request") && (
                <ActForm action={closureAction} hidden={{ violationId: v.id, op: "request" }} submit="طلب إغلاق المخالفة" className="mt-3 grid sm:grid-cols-2"
                  confirm={{ title: "طلب إغلاق المخالفة", message: "يُرفع الطلب لاعتماد صاحب الصلاحية (من غيرك). لا تُعد المخالفة مغلقة قبل الاعتماد." }}>
                  <Field label="مسار الإغلاق" htmlFor="cpath" required>
                    <select id="cpath" name="path" defaultValue={sug.path} className="field-input">{Object.entries(PATH_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </Field>
                  <Field label="النتيجة النهائية" htmlFor="cout" required>
                    <select id="cout" name="finalOutcome" defaultValue={sug.outcome} className="field-input">{Object.entries(OUTCOME_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </Field>
                  <Field label="سبب الإغلاق" htmlFor="creason" required className="sm:col-span-2"><textarea id="creason" name="reason" rows={2} className="field-input" /></Field>
                  <Field label="ملاحظات" htmlFor="cnotes" className="sm:col-span-2"><input id="cnotes" name="notes" className="field-input" /></Field>
                  <fieldset className="sm:col-span-2">
                    <legend className="mb-1 text-sm font-medium">المستندات التي يستند إليها الإغلاق</legend>
                    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2 text-sm">
                      {attachments.map((a) => (
                        <label key={a.id} className="flex items-center gap-2"><input type="checkbox" name="supportingAttachmentIds" value={a.id} />{docTypeLabel(a.documentType)} — {a.versions[0]?.originalName}</label>
                      ))}
                    </div>
                  </fieldset>
                </ActForm>
              )}
            </>
          )}

          {v.generalStatus === "CLOSED" && (
            <>
              <Alert tone="success">المخالفة مغلقة بالنتيجة: {v.outcome ? OUTCOME_LABELS[v.outcome] : "—"}.</Alert>
              {can(actor, "violation.reopen") && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-brand">إعادة فتح المخالفة (صلاحية خاصة)</summary>
                  <ActForm action={closureAction} hidden={{ violationId: v.id, op: "reopen" }} submit="إعادة الفتح" variant="danger" className="mt-3"
                    confirm={{ title: "إعادة فتح المخالفة", message: "تعود المخالفة مفتوحة إلى مرحلة التحقق النهائي، ويبقى سجل الإغلاق السابق محفوظاً." }}>
                    <Field label="سبب إعادة الفتح" htmlFor="rreason" required><textarea id="rreason" name="reason" rows={2} className="field-input" /></Field>
                  </ActForm>
                </details>
              )}
            </>
          )}
          {criminalCase && v.stage === "AWAITING_JUDGMENT" && <p className="mt-2 text-xs text-muted">الدعوى قيد النظر؛ تبقى المخالفة مفتوحة حتى اعتماد حكم مكتسب الدرجة القطعية. <Link className="text-brand underline" href={`/criminal-cases/${criminalCase.id}`}>متابعة الدعوى</Link></p>}
        </Card>
      )}
    </>
  );
}
