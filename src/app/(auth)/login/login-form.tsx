"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";
import { Field } from "@/components/ui";
import { FormMessage, SubmitButton } from "@/components/client-ui";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="اسم المستخدم" htmlFor="username" required>
        <input id="username" name="username" autoComplete="username" required dir="ltr" className="field-input text-start" />
      </Field>
      <Field label="كلمة المرور" htmlFor="password" required>
        <input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" className="field-input text-start" />
      </Field>
      <SubmitButton pendingText="جارٍ التحقق…">دخول</SubmitButton>
    </form>
  );
}
