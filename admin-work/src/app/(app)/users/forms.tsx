"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, NoResetForm, SubmitButton } from "@/components/client-ui";
import { createUserAction, resetPasswordAction, revokeSessionsAction, setActiveAction, updateUserAction } from "./actions";

type PermOption = { code: string; label: string; group: string };

function TempPassword({ value, username }: { value: string; username?: string }) {
  return (
    <div role="status" className="rounded-md border border-tone-warning/30 bg-tone-warning-bg p-3 text-sm text-tone-warning">
      <p className="font-semibold">كلمة المرور المؤقتة{username ? ` للمستخدم ${username}` : ""} (تُعرض مرة واحدة فقط):</p>
      <p className="ltr-num mt-1 font-mono text-base tracking-wider select-all">{value}</p>
      <p className="mt-1 text-xs">سلّمها لصاحب الحساب بطريقة آمنة. سيُطلب منه تغييرها عند أول دخول.</p>
    </div>
  );
}

export function PermissionChecklist({ options, selected }: { options: PermOption[]; selected: string[] }) {
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <fieldset className="rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-medium">الصلاحيات التشغيلية للمنسق</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-xs font-semibold text-brand">{g}</div>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <label key={o.code} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" name="permissions" value={o.code} defaultChecked={selected.includes(o.code)} className="h-4 w-4 accent-brand" />
                  {o.label}
                </label>
              ))}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function CreateUserForm({ options, defaults }: { options: PermOption[]; defaults: string[] }) {
  const [state, action] = useActionState(createUserAction, null);
  const [role, setRole] = useState("COORDINATOR");
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <NoResetForm action={action} className="flex flex-col gap-4" key={state?.ok ? state.data?.username : "form"}>
      {state?.ok && state.data?.tempPassword ? <TempPassword value={state.data.tempPassword} username={state.data.username} /> : <FormMessage state={state} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="اسم المستخدم" htmlFor="username" required hint="حروف لاتينية صغيرة وأرقام" error={fe?.username}>
          <input id="username" name="username" dir="ltr" autoComplete="off" className="field-input text-start" required />
        </Field>
        <Field label="الاسم الكامل" htmlFor="fullName" required error={fe?.fullName}>
          <input id="fullName" name="fullName" className="field-input" required />
        </Field>
        <Field label="الدور" htmlFor="role" required>
          <select id="role" name="role" className="field-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="COORDINATOR">المنسق العام</option>
            <option value="ADMIN">مدير النظام</option>
          </select>
        </Field>
      </div>
      {role === "COORDINATOR" ? (
        <PermissionChecklist options={options} selected={defaults} />
      ) : (
        <p className="rounded-md bg-tone-info-bg px-3 py-2 text-sm text-tone-info">حساب المدير يملك جميع الصلاحيات تلقائياً.</p>
      )}
      <div>
        <SubmitButton>إنشاء الحساب</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function EditUserForm({ userId, fullName, isAdmin, options, selected }: { userId: string; fullName: string; isAdmin: boolean; options: PermOption[]; selected: string[] }) {
  const [state, action] = useActionState(updateUserAction.bind(null, userId), null);
  return (
    <NoResetForm action={action} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <Field label="الاسم الكامل" htmlFor="fullName" required>
        <input id="fullName" name="fullName" defaultValue={fullName} className="field-input" required />
      </Field>
      {isAdmin ? (
        <p className="rounded-md bg-tone-info-bg px-3 py-2 text-sm text-tone-info">حساب المدير يملك جميع الصلاحيات تلقائياً.</p>
      ) : (
        <PermissionChecklist options={options} selected={selected} />
      )}
      <div>
        <SubmitButton>حفظ</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function AccountActions({ userId, isActive, isSelf }: { userId: string; isActive: boolean; isSelf: boolean }) {
  const [activeState, activeAction] = useActionState(setActiveAction.bind(null, userId, !isActive), null);
  const [resetState, resetAction] = useActionState(resetPasswordAction.bind(null, userId), null);
  const [revokeState, revokeAction] = useActionState(revokeSessionsAction.bind(null, userId), null);
  return (
    <div className="flex flex-col gap-4">
      {resetState?.ok && resetState.data?.tempPassword ? <TempPassword value={resetState.data.tempPassword} /> : <FormMessage state={resetState} />}
      <FormMessage state={revokeState} />
      <FormMessage state={activeState} />
      <div className="flex flex-wrap gap-2">
        {!isSelf && (
          <NoResetForm action={resetAction}>
            <ConfirmButton variant="secondary" title="إعادة تعيين كلمة المرور" message="ستُصدر كلمة مرور مؤقتة جديدة وتُنهى جميع جلسات المستخدم.">
              إعادة تعيين كلمة المرور
            </ConfirmButton>
          </NoResetForm>
        )}
        <NoResetForm action={revokeAction}>
          <ConfirmButton variant="secondary" title="إنهاء الجلسات" message="سيُطلب من المستخدم تسجيل الدخول مجدداً على جميع الأجهزة.">
            إنهاء جميع الجلسات
          </ConfirmButton>
        </NoResetForm>
      </div>
      {!isSelf && (
        <NoResetForm action={activeAction} className="flex flex-col gap-2 rounded-md border border-line p-3">
          {isActive && (
            <Field label="سبب التعطيل" htmlFor="reason" required>
              <input id="reason" name="reason" className="field-input" />
            </Field>
          )}
          <div>
            <ConfirmButton
              variant={isActive ? "danger" : "primary"}
              title={isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
              message={isActive ? "لن يتمكن المستخدم من الدخول، وستُنهى جلساته فوراً." : "سيتمكن المستخدم من الدخول مجدداً."}
            >
              {isActive ? "تعطيل الحساب" : "تفعيل الحساب"}
            </ConfirmButton>
          </div>
        </NoResetForm>
      )}
    </div>
  );
}
