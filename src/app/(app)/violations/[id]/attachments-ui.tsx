"use client";

import { useActionState, useEffect, useRef } from "react";
import { attachmentCommandAction, uploadAttachmentsAction } from "../actions";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, SubmitButton, NoResetForm } from "@/components/client-ui";

export function UploadForm({ violationId, accept, docTypes, supplementary, canConfidential, defaultType }: {
  violationId: string; accept: string; docTypes: Record<string, string>; supplementary: boolean; canConfidential: boolean; defaultType: string;
}) {
  const [state, action] = useActionState(uploadAttachmentsAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <NoResetForm ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="violationId" value={violationId} />
      <h3 className="text-sm font-semibold text-brand sm:col-span-2">رفع مستندات</h3>
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      <Field label="نوع المستند" htmlFor="documentType" required>
        <select id="documentType" name="documentType" defaultValue={defaultType} className="field-input">
          {Object.entries(docTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="مستوى السرية" htmlFor="confidentiality">
        <select id="confidentiality" name="confidentiality" className="field-input" defaultValue="NORMAL">
          <option value="NORMAL">عادي</option>
          {canConfidential && <option value="RESTRICTED">محدود التداول</option>}
          {canConfidential && <option value="CONFIDENTIAL">سري</option>}
        </select>
      </Field>
      <Field label="الملفات" htmlFor="files" required hint="PDF، صور، Word، Excel، صوت، فيديو. يُتحقق من النوع الحقيقي للملف" className="sm:col-span-2">
        <input id="files" name="files" type="file" multiple accept={accept} required className="field-input file:me-3 file:rounded file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-brand" />
      </Field>
      <Field label="وصف المستند" htmlFor="description">
        <input id="description" name="description" className="field-input" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="رقم الكتاب" htmlFor="letterNumber"><input id="letterNumber" name="letterNumber" className="field-input" /></Field>
        <Field label="تاريخ الكتاب" htmlFor="letterDate"><input id="letterDate" name="letterDate" type="date" className="field-input" /></Field>
      </div>
      {supplementary && (
        <Field label="سبب إضافة المرفق التكميلي" htmlFor="additionReason" required className="sm:col-span-2">
          <input id="additionReason" name="additionReason" required className="field-input" />
        </Field>
      )}
      <div className="sm:col-span-2"><SubmitButton pendingText="جارٍ الرفع والتحقق…">رفع</SubmitButton></div>
    </NoResetForm>
  );
}

export function AttachmentRowActions({ violationId, attachmentId, approved, accept, canWithdraw }: {
  violationId: string; attachmentId: string; approved: boolean; accept: string; canWithdraw: boolean;
}) {
  const [state, action] = useActionState(attachmentCommandAction, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-brand">إجراءات المستند</summary>
      <div className="mt-2 flex flex-col gap-3 rounded-md bg-band p-3">
        <FormMessage state={state} />
        <NoResetForm action={action} className="flex flex-col gap-2">
          <input type="hidden" name="violationId" value={violationId} />
          <input type="hidden" name="attachmentId" value={attachmentId} />
          <input type="hidden" name="op" value="version" />
          <label className="text-xs">إصدار جديد (يبقى الإصدار الحالي محفوظاً){approved && " — المستند معتمد وسيُسجَّل الاستبدال في التدقيق"}</label>
          <input name="file" type="file" accept={accept} required className="field-input" aria-label="ملف الإصدار الجديد" />
          <input name="reason" required placeholder="سبب الإصدار الجديد" className="field-input" aria-label="سبب الإصدار الجديد" />
          <div><SubmitButton variant="secondary" pendingText="جارٍ الرفع…">رفع الإصدار</SubmitButton></div>
        </NoResetForm>
        {canWithdraw && (
          <NoResetForm action={action} className="flex flex-col gap-2">
            <input type="hidden" name="violationId" value={violationId} />
            <input type="hidden" name="attachmentId" value={attachmentId} />
            <input type="hidden" name="op" value="withdraw" />
            <input name="reason" required placeholder="سبب السحب" className="field-input" aria-label="سبب السحب" />
            <div>
              <ConfirmButton variant="danger" title="سحب المستند" message="يُعلَّم المستند مسحوباً ويبقى محفوظاً بكل إصداراته. لا يُحذف فعلياً.">سحب المستند</ConfirmButton>
            </div>
          </NoResetForm>
        )}
      </div>
    </details>
  );
}
