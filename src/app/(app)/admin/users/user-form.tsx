"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/client-ui";
import type { ActionResult } from "@/lib/errors";

type Opt = { id: string; nameAr: string };
type Office = Opt & { governorateId: string };
export type UserFormValues = {
  id?: string; username?: string; fullName?: string; email?: string | null; jobTitle?: string | null;
  scope?: string; governorateId?: string | null; officeId?: string | null; roleIds?: string[];
};

export function UserForm({ action, initial, governorates, offices, roles, submitLabel }: {
  action: (p: ActionResult<{ tempPassword: string; id: string }> | null, f: FormData) => Promise<ActionResult<{ tempPassword: string; id: string }>>;
  initial?: UserFormValues;
  governorates: Opt[];
  offices: Office[];
  roles: (Opt & { description: string | null })[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [gov, setGov] = useState(initial?.governorateId ?? "");
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const created = state?.ok && state.data?.tempPassword ? state.data : null;
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      {created && (
        <div className="rounded-md border border-tone-warning/30 bg-tone-warning-bg p-4 text-sm text-tone-warning sm:col-span-2">
          كلمة المرور المؤقتة (تُعرض مرة واحدة فقط، سلّمها للموظف بطريقة آمنة):
          <div className="mt-2 font-mono text-base select-all ltr-num" dir="ltr">{created.tempPassword}</div>
          <a className="mt-2 inline-block underline" href={`/admin/users/${created.id}`}>فتح الحساب</a>
        </div>
      )}
      <Field label="اسم المستخدم" htmlFor="username" required error={fe?.username} hint="حروف لاتينية صغيرة وأرقام">
        <input id="username" name="username" defaultValue={initial?.username} disabled={!!initial?.id} dir="ltr" className="field-input text-start" />
      </Field>
      <Field label="الاسم الكامل" htmlFor="fullName" required error={fe?.fullName}>
        <input id="fullName" name="fullName" defaultValue={initial?.fullName} className="field-input" />
      </Field>
      <Field label="البريد الإلكتروني" htmlFor="email" error={fe?.email}>
        <input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} dir="ltr" className="field-input text-start" />
      </Field>
      <Field label="العنوان الوظيفي" htmlFor="jobTitle" error={fe?.jobTitle}>
        <input id="jobTitle" name="jobTitle" defaultValue={initial?.jobTitle ?? ""} className="field-input" />
      </Field>
      <Field label="نطاق الاطلاع" htmlFor="scope" required error={fe?.scope} hint="المركزي يُمنح عادة عبر صلاحية الاطلاع المركزي في الدور">
        <select id="scope" name="scope" defaultValue={initial?.scope ?? "OFFICE"} className="field-input">
          <option value="OFFICE">المكتب أو الفرع</option>
          <option value="GOVERNORATE">المحافظة</option>
          <option value="CENTRAL">مركزي (جميع المحافظات)</option>
        </select>
      </Field>
      <Field label="المحافظة" htmlFor="governorateId" error={fe?.governorateId}>
        <select id="governorateId" name="governorateId" value={gov} onChange={(e) => setGov(e.target.value)} className="field-input">
          <option value="">—</option>
          {governorates.map((g) => <option key={g.id} value={g.id}>{g.nameAr}</option>)}
        </select>
      </Field>
      <Field label="المكتب أو الفرع" htmlFor="officeId" error={fe?.officeId}>
        <select id="officeId" name="officeId" defaultValue={initial?.officeId ?? ""} className="field-input">
          <option value="">—</option>
          {offices.filter((o) => !gov || o.governorateId === gov).map((o) => <option key={o.id} value={o.id}>{o.nameAr}</option>)}
        </select>
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium">الأدوار <span className="text-tone-danger">*</span></legend>
        {fe?.roleIds && <p className="mb-2 text-xs text-tone-danger">{fe.roleIds[0]}</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <label key={r.id} className="flex items-start gap-2 rounded-md border border-line p-3 text-sm hover:bg-band">
              <input type="checkbox" name="roleIds" value={r.id} defaultChecked={initial?.roleIds?.includes(r.id)} className="mt-1" />
              <span><span className="font-medium">{r.nameAr}</span>{r.description && <span className="block text-xs text-muted">{r.description}</span>}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2"><SubmitButton>{submitLabel}</SubmitButton></div>
    </form>
  );
}
