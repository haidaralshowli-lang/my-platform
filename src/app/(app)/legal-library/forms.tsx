"use client";

import { useActionState, useRef, useEffect } from "react";
import { createLegalDocAction, legalDocAction } from "../workflow-actions";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/client-ui";
import { LEGAL_DOC_STATUS_LABELS, LEGAL_DOC_TYPE_LABELS } from "@/lib/documents";

export function CreateLegalDocForm({ docs }: { docs: { id: string; title: string }[] }) {
  const [state, action] = useActionState(createLegalDocAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3"><FormMessage state={state} /></div>
      <Field label="عنوان الوثيقة" htmlFor="title" required error={fe?.title} className="sm:col-span-2"><input id="title" name="title" className="field-input" /></Field>
      <Field label="نوع الوثيقة" htmlFor="docType" required>
        <select id="docType" name="docType" className="field-input">{Object.entries(LEGAL_DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Field>
      <Field label="رقمها" htmlFor="number"><input id="number" name="number" className="field-input" /></Field>
      <Field label="تاريخ صدورها" htmlFor="issuedAt"><input id="issuedAt" name="issuedAt" type="date" className="field-input" /></Field>
      <Field label="تاريخ النفاذ" htmlFor="effectiveAt"><input id="effectiveAt" name="effectiveAt" type="date" className="field-input" /></Field>
      <Field label="الجهة المصدرة" htmlFor="issuer"><input id="issuer" name="issuer" className="field-input" /></Field>
      <Field label="الوثيقة السابقة المرتبطة" htmlFor="previousDocumentId">
        <select id="previousDocumentId" name="previousDocumentId" className="field-input"><option value="">—</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
      </Field>
      <Field label="الكلمات المفتاحية" htmlFor="keywords" hint="مفصولة بفاصلة"><input id="keywords" name="keywords" className="field-input" /></Field>
      <Field label="وصف مختصر" htmlFor="description" className="sm:col-span-2 lg:col-span-3"><textarea id="description" name="description" rows={2} className="field-input" /></Field>
      <Field label="الملفات (PDF أو Word)" htmlFor="files" className="sm:col-span-2"><input id="files" name="files" type="file" multiple accept=".pdf,.docx,.doc" className="field-input" /></Field>
      <Field label="ملاحظات الإصدار" htmlFor="versionNotes"><input id="versionNotes" name="versionNotes" className="field-input" /></Field>
      <Field label="النص المستخرج (اختياري، لدعم البحث النصي)" htmlFor="extractedText" hint="لا يتوفر استخراج نص تلقائي (OCR) في هذه البيئة؛ يمكن لصق النص يدوياً" className="sm:col-span-2 lg:col-span-3">
        <textarea id="extractedText" name="extractedText" rows={3} className="field-input" />
      </Field>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">تُنشأ الوثيقة بحالة «مسودة» ولا يُستند إليها قبل أن يحدد المخول حالتها.</p>
      <div><SubmitButton>إضافة الوثيقة</SubmitButton></div>
    </form>
  );
}

export function LegalDocActions({ documentId, versionId, status }: { documentId: string; versionId: string; status: string }) {
  const [state, action] = useActionState(legalDocAction, null);
  const articleRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) articleRef.current?.reset(); }, [state]);
  return (
    <div className="flex flex-col gap-6">
      <FormMessage state={state} />
      <form ref={articleRef} action={action} className="grid gap-3 sm:grid-cols-4">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="op" value="article" />
        <h3 className="text-sm font-semibold text-brand sm:col-span-4">فهرسة مادة في الإصدار الحالي</h3>
        <Field label="رقم المادة" htmlFor="articleNumber" required><input id="articleNumber" name="articleNumber" className="field-input" /></Field>
        <Field label="الفقرة" htmlFor="paragraph"><input id="paragraph" name="paragraph" className="field-input" /></Field>
        <Field label="النص المرجعي المعتمد" htmlFor="text" required className="sm:col-span-4"><textarea id="text" name="text" rows={3} className="field-input" /></Field>
        <div><SubmitButton variant="secondary">إضافة المادة</SubmitButton></div>
      </form>
      <form action={action} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="op" value="status" />
        <Field label="حالة الوثيقة" htmlFor="status">
          <select id="status" name="status" defaultValue={status} className="field-input w-48">{Object.entries(LEGAL_DOC_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="سند تغيير الحالة" htmlFor="statusReason"><input id="statusReason" name="reason" required className="field-input w-72" /></Field>
        <ConfirmButton title="تغيير حالة الوثيقة" message="حالة «نافذة» تجعل الوثيقة متاحة سنداً للمخالفات. يُسجَّل التغيير وسنده في سجل التدقيق.">تغيير الحالة</ConfirmButton>
      </form>
      <form action={action} className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="op" value="version" />
        <h3 className="text-sm font-semibold text-brand sm:col-span-2">إصدار جديد (تعديل أو نسخة محدثة)</h3>
        <Field label="وصف الإصدار أو سببه" htmlFor="vnotes" required><input id="vnotes" name="notes" className="field-input" /></Field>
        <Field label="الملفات" htmlFor="vfiles"><input id="vfiles" name="files" type="file" multiple accept=".pdf,.docx,.doc" className="field-input" /></Field>
        <Field label="النص المستخرج" htmlFor="vtext" className="sm:col-span-2"><textarea id="vtext" name="extractedText" rows={2} className="field-input" /></Field>
        <p className="text-xs text-muted sm:col-span-2">المخالفات المرتبطة بالإصدارات السابقة تبقى مرتبطة بها ولا تنتقل تلقائياً إلى الإصدار الجديد.</p>
        <div><ConfirmButton variant="secondary" title="إضافة إصدار" message="يُنشأ إصدار جديد مع بقاء الإصدارات السابقة ومحتواها كما هي.">إضافة إصدار</ConfirmButton></div>
      </form>
    </div>
  );
}
