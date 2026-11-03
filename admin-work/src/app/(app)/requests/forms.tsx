"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { RequestStatus } from "@prisma/client";
import type { ActionResult } from "@/lib/errors";
import { PRIORITY, PRIORITIES, REQUEST_STATUS, REQUEST_TYPE, REQUEST_TYPES } from "@/lib/labels";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, NoResetForm, SubmitButton } from "@/components/client-ui";
import { PersonPicker } from "@/components/person-picker";
import { addActionAction, deleteRequestAction, transitionAction } from "./actions";

type Opt = { id: string | number; name: string };

export type RequestFormValues = {
  receivedAt: string;
  applicantName: string;
  applicant: { id: string; serial: number; fullName: string } | null;
  type: string;
  description: string;
  authorityId: number | null;
  ownerId: string | null;
  priority: string;
  followUpDate: string;
};

export function RequestForm({
  action,
  authorities,
  owners,
  initial,
  today,
  submitLabel,
}: {
  action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  authorities: Opt[];
  owners: Opt[];
  initial?: RequestFormValues;
  today: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <NoResetForm action={formAction} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="تاريخ الاستلام" htmlFor="receivedAt" required error={fe?.receivedAt}>
          <input id="receivedAt" name="receivedAt" type="date" max={today} defaultValue={initial?.receivedAt ?? today} className="field-input ltr-num" required />
        </Field>
        <Field label="نوع الطلب" htmlFor="type" required error={fe?.type}>
          <select id="type" name="type" defaultValue={initial?.type ?? ""} className="field-input" required>
            <option value="" disabled>
              — اختر —
            </option>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="درجة الأولوية" htmlFor="priority">
          <select id="priority" name="priority" defaultValue={initial?.priority ?? "NORMAL"} className="field-input">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p].label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="اسم مقدم الطلب" htmlFor="applicantName" required error={fe?.applicantName}>
          <input ref={nameRef} id="applicantName" name="applicantName" defaultValue={initial?.applicantName} className="field-input" required maxLength={150} />
        </Field>
        <Field label="ربط بسجل في قاعدة الأشخاص" htmlFor="applicantSearch" hint="اختياري. يملأ اسم مقدم الطلب تلقائياً">
          <PersonPicker
            id="applicantSearch"
            name="applicantId"
            initial={initial?.applicant}
            onPick={(p) => {
              if (p && nameRef.current) nameRef.current.value = p.fullName;
            }}
          />
        </Field>
      </div>
      <Field label="وصف الطلب" htmlFor="description" required error={fe?.description}>
        <textarea id="description" name="description" rows={4} defaultValue={initial?.description} className="field-input" required maxLength={4000} />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="الجهة المختصة" htmlFor="authorityId">
          <select id="authorityId" name="authorityId" defaultValue={initial?.authorityId ?? ""} className="field-input">
            <option value="">— غير محددة —</option>
            {authorities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="المسؤول عن المتابعة" htmlFor="ownerId">
          <select id="ownerId" name="ownerId" defaultValue={initial?.ownerId ?? ""} className="field-input">
            <option value="">— غير محدد —</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="موعد المتابعة" htmlFor="followUpDate" error={fe?.followUpDate}>
          <input id="followUpDate" name="followUpDate" type="date" defaultValue={initial?.followUpDate} className="field-input ltr-num" />
        </Field>
      </div>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </NoResetForm>
  );
}

function useResetOnSuccess(state: ActionResult | null) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function TransitionForm({ id, allowed, authorities, currentAuthorityId }: { id: string; allowed: RequestStatus[]; authorities: Opt[]; currentAuthorityId: number | null }) {
  const [state, action] = useActionState(transitionAction.bind(null, id), null);
  const [to, setTo] = useState<RequestStatus | "">("");
  const ref = useResetOnSuccess(state);
  useEffect(() => {
    if (state?.ok) setTo("");
  }, [state]);
  if (allowed.length === 0) return <p className="text-sm text-muted">لا توجد حالات يمكنك نقل الطلب إليها.</p>;
  return (
    <NoResetForm action={action} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="الحالة الجديدة" htmlFor="to" required>
        <select id="to" name="to" value={to} onChange={(e) => setTo(e.target.value as RequestStatus)} className="field-input" required>
          <option value="" disabled>
            — اختر —
          </option>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {s === "CLOSED" ? "مغلق (اعتماد الإغلاق)" : REQUEST_STATUS[s].label}
            </option>
          ))}
        </select>
      </Field>
      {to === "REFERRED" && (
        <Field label="الجهة المختصة المحال إليها" htmlFor="tAuthority" required>
          <select id="tAuthority" name="authorityId" defaultValue={currentAuthorityId ?? ""} className="field-input">
            <option value="">— اختر —</option>
            {authorities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {to === "FAILED" && (
        <Field label="سبب التعذر" htmlFor="failureReason" required>
          <textarea id="failureReason" name="failureReason" rows={2} className="field-input" maxLength={1000} />
        </Field>
      )}
      {to && to !== "CLOSED" && to !== "DONE" && to !== "FAILED" && (
        <Field label="موعد المتابعة القادم" htmlFor="tFollow" hint="اختياري">
          <input id="tFollow" name="followUpDate" type="date" className="field-input ltr-num" />
        </Field>
      )}
      <Field label="الإجراء المتخذ" htmlFor="tNote" required hint="يُسجَّل كآخر إجراء وفي السجل الزمني">
        <textarea id="tNote" name="note" rows={2} className="field-input" maxLength={1000} />
      </Field>
      <div>
        <SubmitButton>تحديث الحالة</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function AddActionForm({ id }: { id: string }) {
  const [state, action] = useActionState(addActionAction.bind(null, id), null);
  const ref = useResetOnSuccess(state);
  return (
    <NoResetForm action={action} ref={ref} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="الإجراء" htmlFor="aNote" required hint="اتصال، مراجعة، رد جزئي... دون تغيير الحالة">
        <textarea id="aNote" name="note" rows={2} className="field-input" maxLength={1000} />
      </Field>
      <Field label="موعد متابعة جديد" htmlFor="aFollow" hint="اختياري">
        <input id="aFollow" name="followUpDate" type="date" className="field-input ltr-num" />
      </Field>
      <div>
        <SubmitButton variant="secondary">تسجيل الإجراء</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function DeleteRequestForm({ id }: { id: string }) {
  const [state, action] = useActionState(deleteRequestAction.bind(null, id), null);
  return (
    <NoResetForm action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <Field label="سبب الحذف" htmlFor="dReason" required>
        <input id="dReason" name="reason" className="field-input" maxLength={300} />
      </Field>
      <div>
        <ConfirmButton variant="danger" title="حذف الطلب" message="سيختفي الطلب من القوائم والمؤشرات، ويبقى في سجل التدقيق.">
          حذف الطلب
        </ConfirmButton>
      </div>
    </NoResetForm>
  );
}
