"use client";

import { useActionState } from "react";
import { changePasswordAction } from "../actions";
import { Field } from "@/components/ui";
import { FormMessage, SubmitButton, NoResetForm } from "@/components/client-ui";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <NoResetForm action={action} className="mt-6 flex flex-col gap-4">
      <FormMessage state={state} />
      <Field label="كلمة المرور الحالية" htmlFor="current" required error={fe?.current}>
        <input id="current" name="current" type="password" autoComplete="current-password" dir="ltr" className="field-input text-start" />
      </Field>
      <Field label="كلمة المرور الجديدة" htmlFor="next" required error={fe?.next}>
        <input id="next" name="next" type="password" autoComplete="new-password" dir="ltr" className="field-input text-start" />
      </Field>
      <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirm" required error={fe?.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" dir="ltr" className="field-input text-start" />
      </Field>
      <SubmitButton>حفظ كلمة المرور</SubmitButton>
    </NoResetForm>
  );
}
