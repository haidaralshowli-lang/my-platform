"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/errors";
import { PRIORITY, PRIORITIES, TASK_STATUS } from "@/lib/labels";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, NoResetForm, SubmitButton } from "@/components/client-ui";
import { PersonPicker } from "@/components/person-picker";
import type { ButtonVariant } from "@/components/ui";
import { consentAction, createTaskAction, decideChangeAction, detailsAction, progressAction, reassignAction } from "./actions";

type Action = (p: ActionResult | null, f: FormData) => Promise<ActionResult>;

function useAction(action: Action) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return { state, formAction, ref, fe };
}

function PrioritySelect({ defaultValue = "NORMAL" }: { defaultValue?: string }) {
  return (
    <Field label="الأولوية" htmlFor="priority">
      <select id="priority" name="priority" defaultValue={defaultValue} className="field-input">
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY[p].label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TaskForm({ today, request, assignee }: { today: string; request?: { id: string; number: string } | null; assignee?: { id: string; serial: number; fullName: string } | null }) {
  const { state, formAction, fe } = useAction(createTaskAction);
  return (
    <NoResetForm action={formAction} className="flex flex-col gap-4">
      <FormMessage state={state} />
      {request && (
        <p className="rounded-md bg-brand-soft px-3 py-2 text-sm">
          مرتبطة بالطلب <span className="ltr-num font-medium">{request.number}</span>
          <input type="hidden" name="requestId" value={request.id} />
        </p>
      )}
      <Field label="عنوان المهمة" htmlFor="title" required error={fe?.title}>
        <input id="title" name="title" className="field-input" required maxLength={200} />
      </Field>
      <Field label="تفاصيل المهمة" htmlFor="details" error={fe?.details}>
        <textarea id="details" name="details" rows={4} className="field-input" maxLength={4000} />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الشخص المكلف" htmlFor="assigneeSearch" required error={fe?.assigneeId} hint="من قاعدة بيانات الأشخاص">
          <PersonPicker id="assigneeSearch" name="assigneeId" initial={assignee} required />
        </Field>
        <Field label="الموعد المحدد" htmlFor="dueDate" required error={fe?.dueDate}>
          <input id="dueDate" name="dueDate" type="date" min={today} className="field-input ltr-num" required />
        </Field>
        <PrioritySelect />
      </div>
      <p className="rounded-md border border-tone-warning/30 bg-tone-warning-bg px-3 py-2 text-xs text-tone-warning">
        تُنشأ المهمة «بانتظار موافقة المكلف». لا تصبح تكليفاً نافذاً، ولا يُسجَّل عليها إنجاز، إلا بعد تسجيل موافقته على المهمة والموعد.
      </p>
      <div>
        <SubmitButton>إنشاء المهمة</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function DetailsForm({ id, initial, dueLocked, today }: { id: string; initial: { title: string; details: string | null; priority: string; dueDate: string }; dueLocked: boolean; today: string }) {
  const [state, formAction] = useActionState(detailsAction.bind(null, id), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <NoResetForm action={formAction} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <Field label="عنوان المهمة" htmlFor="title" required error={fe?.title}>
        <input id="title" name="title" defaultValue={initial.title} className="field-input" required maxLength={200} />
      </Field>
      <Field label="تفاصيل المهمة" htmlFor="details">
        <textarea id="details" name="details" rows={3} defaultValue={initial.details ?? ""} className="field-input" maxLength={4000} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الموعد المحدد" htmlFor="dDue" hint={dueLocked ? "متفق عليه مع المكلف؛ يُعدَّل عبر طلب تعديل الموعد" : undefined}>
          <input id="dDue" name="dueDate" type="date" min={dueLocked ? undefined : today} defaultValue={initial.dueDate} disabled={dueLocked} className="field-input ltr-num" />
        </Field>
        <PrioritySelect defaultValue={initial.priority} />
      </div>
      <div>
        <SubmitButton variant="secondary">حفظ التعديلات</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function ConsentForm({ id, mode, today, dueDate }: { id: string; mode: "pending" | "accepted"; today: string; dueDate: string }) {
  const { state, formAction, ref } = useAction(consentAction.bind(null, id));
  const [response, setResponse] = useState(mode === "pending" ? "ACCEPT" : "REQUEST_CHANGE");
  const options =
    mode === "pending"
      ? [
          { v: "ACCEPT", l: `وافق على المهمة والموعد (${dueDate})` },
          { v: "REQUEST_CHANGE", l: "طلب تعديل الموعد" },
          { v: "DECLINE", l: "اعتذر عن المهمة" },
        ]
      : [
          { v: "REQUEST_CHANGE", l: "طلب تعديل الموعد" },
          { v: "DECLINE", l: "اعتذر عن الاستمرار" },
        ];
  return (
    <NoResetForm action={formAction} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">رد الشخص المكلف</legend>
        {options.map((o) => (
          <label key={o.v} className="flex items-center gap-2 text-sm">
            <input type="radio" name="response" value={o.v} checked={response === o.v} onChange={() => setResponse(o.v)} className="h-4 w-4 accent-brand" />
            {o.l}
          </label>
        ))}
      </fieldset>
      {response === "REQUEST_CHANGE" && (
        <Field label="الموعد المقترح" htmlFor="proposedDueDate" required>
          <input id="proposedDueDate" name="proposedDueDate" type="date" min={today} className="field-input ltr-num" />
        </Field>
      )}
      <Field label={response === "DECLINE" ? "سبب الاعتذار" : "ملاحظة"} htmlFor="cNote" required={response === "DECLINE"}>
        <textarea id="cNote" name="note" rows={2} className="field-input" maxLength={1000} />
      </Field>
      <div>
        <SubmitButton variant={response === "DECLINE" ? "danger" : "primary"}>تسجيل الرد</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function DecideChangeForm({ id }: { id: string }) {
  const { state, formAction, ref } = useAction(decideChangeAction.bind(null, id));
  return (
    <NoResetForm action={formAction} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="ملاحظة" htmlFor="dcNote">
        <input id="dcNote" name="note" className="field-input" maxLength={1000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approve">
          اعتماد الموعد المقترح
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="secondary">
          رفض والإبقاء على الموعد
        </SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function ReassignForm({ id, today }: { id: string; today: string }) {
  const { state, formAction, ref, fe } = useAction(reassignAction.bind(null, id));
  return (
    <NoResetForm action={formAction} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="المكلف الجديد" htmlFor="raSearch" required error={fe?.assigneeId}>
        <PersonPicker id="raSearch" name="assigneeId" />
      </Field>
      <Field label="موعد جديد" htmlFor="raDue" hint="اختياري؛ يبقى الموعد الحالي إن تُرك فارغاً">
        <input id="raDue" name="dueDate" type="date" min={today} className="field-input ltr-num" />
      </Field>
      <Field label="ملاحظة" htmlFor="raNote">
        <input id="raNote" name="note" className="field-input" maxLength={1000} />
      </Field>
      <div>
        <SubmitButton variant="secondary">إعادة الإسناد</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function ProgressForm({ id, current }: { id: string; current: { status: string; progress: number; obstacles: string | null } }) {
  const { state, formAction, ref } = useAction(progressAction.bind(null, id));
  const initialStatus = ["IN_PROGRESS", "WAITING", "STUCK", "DONE"].includes(current.status) ? current.status : "IN_PROGRESS";
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState(Math.min(current.progress, 99));
  useEffect(() => {
    if (state?.ok) setStatus((s) => s);
  }, [state]);
  return (
    <NoResetForm action={formAction} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المرحلة" htmlFor="pStatus" required>
          <select id="pStatus" name="status" value={status} onChange={(e) => setStatus(e.target.value)} className="field-input">
            {(["IN_PROGRESS", "WAITING", "STUCK", "DONE"] as const).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
        {status !== "DONE" && (
          <Field label={`نسبة الإنجاز: ${progress}%`} htmlFor="pProgress">
            <input id="pProgress" name="progress" type="range" min={0} max={99} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="accent-brand" />
          </Field>
        )}
        {status === "DONE" && <input type="hidden" name="progress" value={100} />}
      </div>
      {(status === "STUCK" || status === "WAITING") && (
        <Field label="المعوقات" htmlFor="pObs" required={status === "STUCK"}>
          <textarea id="pObs" name="obstacles" rows={2} defaultValue={current.obstacles ?? ""} className="field-input" maxLength={2000} />
        </Field>
      )}
      {status === "DONE" && (
        <Field label="النتيجة النهائية" htmlFor="pResult" required>
          <textarea id="pResult" name="finalResult" rows={2} className="field-input" maxLength={2000} />
        </Field>
      )}
      <Field label="ملاحظة التحديث" htmlFor="pNote">
        <input id="pNote" name="note" className="field-input" maxLength={1000} />
      </Field>
      <div>
        <SubmitButton>تحديث الإنجاز</SubmitButton>
      </div>
    </NoResetForm>
  );
}

/// نموذج إجراء بسبب أو ملاحظة مع تأكيد (اعتماد الإغلاق، الإلغاء، إعادة الفتح، الحذف)
export function ReasonForm({
  action,
  field,
  label,
  required,
  button,
  variant = "primary",
  confirm,
}: {
  action: Action;
  field: "reason" | "note";
  label: string;
  required?: boolean;
  button: string;
  variant?: ButtonVariant;
  confirm: string;
}) {
  const { state, formAction, ref } = useAction(action);
  const id = `${button}-${field}`.replace(/\s/g, "-");
  return (
    <NoResetForm action={formAction} ref={ref} className="flex flex-col gap-2">
      <FormMessage state={state} />
      <Field label={label} htmlFor={id} required={required}>
        <input id={id} name={field} className="field-input" maxLength={500} />
      </Field>
      <div>
        <ConfirmButton variant={variant} title={button} message={confirm}>
          {button}
        </ConfirmButton>
      </div>
    </NoResetForm>
  );
}
