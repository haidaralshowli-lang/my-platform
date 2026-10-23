"use client";

import { useActionState, useRef } from "react";
import { createTemplateAction, templateAction } from "../workflow-actions";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, SubmitButton } from "@/components/client-ui";

function PlaceholderBar({ target, placeholders }: { target: React.RefObject<HTMLTextAreaElement | null>; placeholders: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(placeholders).map(([k, l]) => (
        <button key={k} type="button" className="rounded border border-line bg-white px-2 py-0.5 text-xs hover:bg-band"
          onClick={() => {
            const el = target.current;
            if (!el) return;
            const pos = el.selectionStart ?? el.value.length;
            el.setRangeText(`{{${k}}}`, pos, el.selectionEnd ?? pos, "end");
            el.focus();
          }}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function CreateTemplateForm({ placeholders }: { placeholders: Record<string, string> }) {
  const [state, action] = useActionState(createTemplateAction, null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="اسم القالب" htmlFor="name" required error={fe?.name}><input id="name" name="name" className="field-input" /></Field>
      <div className="text-xs text-muted">إدراج حقل يُعبأ تلقائياً:</div>
      <PlaceholderBar target={ref} placeholders={placeholders} />
      <Field label="نص القالب" htmlFor="body" required error={fe?.body} hint="كل سطر فقرة. الحقول بين {{ }} تُعبأ من بيانات المخالفة عند إعداد الإنذار. يكتب النص المعتمد من الجهة المختصة">
        <textarea ref={ref} id="body" name="body" rows={12} className="field-input leading-7" />
      </Field>
      <Field label="ملاحظات" htmlFor="notes"><input id="notes" name="notes" className="field-input" /></Field>
      <div><SubmitButton>حفظ القالب</SubmitButton></div>
    </form>
  );
}

export function EditTemplateForm({ templateId, body, active, placeholders }: { templateId: string; body: string; active: boolean; placeholders: Record<string, string> }) {
  const [state, action] = useActionState(templateAction, null);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <FormMessage state={state} />
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="templateId" value={templateId} />
        <input type="hidden" name="op" value="update" />
        <PlaceholderBar target={ref} placeholders={placeholders} />
        <textarea ref={ref} name="body" rows={12} defaultValue={body} aria-label="نص القالب" className="field-input leading-7" />
        <input name="notes" required placeholder="سبب التعديل (إلزامي)" aria-label="سبب التعديل" className="field-input" />
        <div><ConfirmButton title="حفظ إصدار جديد" message="يُنشأ إصدار جديد من القالب. الإنذارات الصادرة سابقاً تحتفظ بنصها كما صدر.">حفظ كإصدار جديد</ConfirmButton></div>
      </form>
      <form action={action}>
        <input type="hidden" name="templateId" value={templateId} />
        <input type="hidden" name="op" value="toggle" />
        <input type="hidden" name="active" value={String(active)} />
        <SubmitButton variant={active ? "danger" : "secondary"}>{active ? "تعطيل القالب" : "تفعيل القالب"}</SubmitButton>
      </form>
    </div>
  );
}
