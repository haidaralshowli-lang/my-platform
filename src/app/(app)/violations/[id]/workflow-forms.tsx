"use client";

import { useActionState, useState, useTransition } from "react";
import { assessmentAction, gateDecisionAction, legalRefAction, searchArticlesAction, warningAction, type ArticleHit } from "../../workflow-actions";
import { Field, buttonClass } from "@/components/ui";
import { ConfirmButton, FormMessage, SubmitButton, NoResetForm } from "@/components/client-ui";

type Decision = { value: string; label: string; variant?: "primary" | "danger" | "secondary"; needsReason?: boolean; confirm: string };

/// نموذج قرار موحد: يتطلب ملاحظات عند الإعادة أو الرفض، ويؤكد قبل التنفيذ
export function DecisionForm({ violationId, version, gate, decisions, title }: { violationId: string; version: number; gate: string; decisions: Decision[]; title: string }) {
  const [state, action] = useActionState(gateDecisionAction, null);
  return (
    <NoResetForm action={action} className="flex flex-col gap-3">
      <input type="hidden" name="violationId" value={violationId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="gate" value={gate} />
      <FormMessage state={state} />
      <Field label={`ملاحظات ${title}`} htmlFor={`notes-${gate}`} hint="إلزامية عند الإعادة أو الرفض أو طلب الإيضاح، وتُحفظ مع القرار باسمك ودورك ووقته">
        <textarea id={`notes-${gate}`} name="notes" rows={3} className="field-input" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => (
          <ConfirmButton key={d.value} name="decision" value={d.value} variant={d.variant ?? "secondary"} title={d.label} message={d.confirm}>
            {d.label}
          </ConfirmButton>
        ))}
      </div>
    </NoResetForm>
  );
}

export function AssessmentForm({ violationId, kind, initial, fields }: {
  violationId: string;
  kind: "technical" | "legal";
  initial: Record<string, string>;
  fields: { name: string; label: string; required?: boolean; rows?: number }[];
}) {
  const [state, action] = useActionState(assessmentAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <NoResetForm action={action} className="flex flex-col gap-3">
      <input type="hidden" name="violationId" value={violationId} />
      <input type="hidden" name="kind" value={kind} />
      <FormMessage state={state} />
      {fields.map((f) => (
        <Field key={f.name} label={f.label} htmlFor={`${kind}-${f.name}`} required={f.required} error={fe?.[f.name]}>
          <textarea id={`${kind}-${f.name}`} name={f.name} rows={f.rows ?? 3} defaultValue={initial[f.name] ?? ""} className="field-input" />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary" name="op" value="save">حفظ المسودة</SubmitButton>
        <ConfirmButton name="op" value="submit" title={kind === "technical" ? "تقديم الموقف الفني" : "تقديم الرأي القانوني"}
          message={kind === "technical" ? "يُقدَّم الموقف الفني بحالته الحالية، ولا يُعدَّل بعد ذلك إلا إذا أُعيد." : "يُقدَّم الرأي القانوني للمصادقة، ولا يُعدَّل بعد ذلك إلا إذا أُعيد."}>
          تقديم
        </ConfirmButton>
      </div>
    </NoResetForm>
  );
}

export function LinkArticleForm({ violationId, purposes }: { violationId: string; purposes: { value: string; label: string }[] }) {
  const [state, action] = useActionState(legalRefAction, null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ArticleHit[] | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-md bg-band p-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بعنوان الوثيقة أو رقمها أو رقم المادة أو نصها" aria-label="بحث في المواد"
          className="field-input max-w-md flex-1" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); start(async () => setHits(await searchArticlesAction(q))); } }} />
        <button type="button" className={buttonClass("secondary")} disabled={pending} onClick={() => start(async () => setHits(await searchArticlesAction(q)))}>
          {pending ? "جارٍ البحث…" : "بحث في المكتبة"}
        </button>
      </div>
      {hits && hits.length === 0 && <p className="text-xs text-muted">لا توجد مواد مطابقة. تُضاف المواد من «اللوائح والقوانين والتعليمات».</p>}
      {hits && hits.length > 0 && (
        <ul className="flex flex-col gap-2">
          {hits.map((h) => (
            <li key={h.id} className="rounded-md border border-line bg-white p-3">
              <div className="text-sm font-medium">{h.label}</div>
              <p className="mt-1 text-xs text-muted">{h.text}</p>
              {h.status === "DRAFT" || h.status === "ARCHIVED" ? (
                <p className="mt-2 text-xs text-tone-danger">الوثيقة غير معتمدة أو مؤرشفة ولا يجوز الاستناد إليها.</p>
              ) : (
                <NoResetForm action={action} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="violationId" value={violationId} />
                  <input type="hidden" name="articleId" value={h.id} />
                  <select name="purpose" className="field-input w-auto" aria-label="غرض الربط">
                    {purposes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <input name="note" placeholder="ملاحظة (اختيارية)" className="field-input w-56" aria-label="ملاحظة" />
                  <SubmitButton variant="secondary">ربط المادة</SubmitButton>
                </NoResetForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UnlinkRefForm({ violationId, refId }: { violationId: string; refId: string }) {
  const [state, action] = useActionState(legalRefAction, null);
  return (
    <NoResetForm action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="violationId" value={violationId} />
      <input type="hidden" name="refId" value={refId} />
      <input type="hidden" name="op" value="unlink" />
      <input name="reason" required placeholder="سبب الإزالة" className="field-input w-40 py-1 text-xs" aria-label="سبب الإزالة" />
      <ConfirmButton variant="ghost" title="إزالة السند" message="تُزال المادة من سندات المخالفة، ويُسجَّل الإجراء وسببه في سجل التدقيق.">إزالة</ConfirmButton>
      <FormMessage state={state} />
    </NoResetForm>
  );
}

export function PrepareWarningForm({ violationId, templates }: { violationId: string; templates: { id: string; name: string }[] }) {
  const [state, action] = useActionState(warningAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <NoResetForm action={action} className="flex flex-col gap-3">
      <input type="hidden" name="violationId" value={violationId} />
      <input type="hidden" name="op" value="prepare" />
      <FormMessage state={state} />
      <Field label="القالب المعتمد" htmlFor="templateId" required error={fe?.templateId}>
        <select id="templateId" name="templateId" className="field-input">
          <option value="">—</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="الإجراء المطلوب من الجهة المخالفة" htmlFor="requiredAction" required error={fe?.requiredAction}>
        <textarea id="requiredAction" name="requiredAction" rows={3} className="field-input" />
      </Field>
      <Field label="المدة المحددة للاستجابة (كما تُكتب في الإنذار)" htmlFor="responsePeriodText" required error={fe?.responsePeriodText}
        hint="نص يظهر في الإنذار فقط. احتساب المدة الفعلي يجري وفق قاعدة المدد المعتمدة من تاريخ الاستلام">
        <input id="responsePeriodText" name="responsePeriodText" className="field-input" />
      </Field>
      <div><ConfirmButton title="إعداد الإنذار" message="سيولّد النظام رقم الإنذار ويحفظ نصه كما هو. يمكن إلغاؤه وإعادة إعداده قبل رفع النسخة الموقعة.">إعداد الإنذار</ConfirmButton></div>
    </NoResetForm>
  );
}

export function SignedWarningForm({ violationId, warningId, canCancel, canUpload }: { violationId: string; warningId: string; canCancel: boolean; canUpload: boolean }) {
  const [state, action] = useActionState(warningAction, null);
  return (
    <div className="flex flex-col gap-4">
      <FormMessage state={state} />
      {canUpload && (
        <NoResetForm action={action} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="violationId" value={violationId} />
          <input type="hidden" name="warningId" value={warningId} />
          <input type="hidden" name="op" value="signed" />
          <Field label="اسم صاحب التوقيع" htmlFor="signerName" required><input id="signerName" name="signerName" className="field-input" /></Field>
          <Field label="تاريخ التوقيع" htmlFor="signedAt" required><input id="signedAt" name="signedAt" type="date" className="field-input" /></Field>
          <Field label="النسخة الضوئية الموقعة يدوياً" htmlFor="signedFile" required className="sm:col-span-2">
            <input id="signedFile" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required className="field-input" />
          </Field>
          <div className="sm:col-span-2">
            <ConfirmButton title="رفع النسخة الموقعة" message="يُعد الإنذار موقعاً برفع نسخته الضوئية الموقعة، وتنتقل المعاملة إلى مرحلة التبليغ.">رفع النسخة الموقعة</ConfirmButton>
          </div>
        </NoResetForm>
      )}
      {canCancel && (
        <NoResetForm action={action} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <input type="hidden" name="violationId" value={violationId} />
          <input type="hidden" name="warningId" value={warningId} />
          <input type="hidden" name="op" value="cancel" />
          <label className="flex flex-col gap-1 text-xs text-muted">سبب إلغاء الإنذار المعد<input name="reason" required className="field-input w-64" /></label>
          <ConfirmButton variant="danger" title="إلغاء الإنذار" message="يُلغى الإنذار غير الموقع ويبقى محفوظاً في السجل، وتعود المعاملة لمرحلة إعداد الإنذار.">إلغاء وإعادة الإعداد</ConfirmButton>
        </NoResetForm>
      )}
    </div>
  );
}
