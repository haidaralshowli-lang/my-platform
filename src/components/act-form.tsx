"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { ConfirmButton, FormMessage, SubmitButton, NoResetForm } from "./client-ui";
import { cn, type ButtonVariant } from "./ui";

/// نموذج إجراء عام: حقول مخفية + محتوى + زر تنفيذ (مع تأكيد اختياري للإجراءات الحساسة)
export function ActForm({ action, hidden, children, submit, confirm, variant = "primary", className }: {
  action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  hidden: Record<string, string>;
  children?: ReactNode;
  submit: string;
  confirm?: { title: string; message: string };
  variant?: ButtonVariant;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <NoResetForm action={formAction} className={cn("flex flex-col gap-3", className)}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FormMessage state={state} />
      {children}
      <div>
        {confirm ? (
          <ConfirmButton variant={variant} title={confirm.title} message={confirm.message}>{submit}</ConfirmButton>
        ) : (
          <SubmitButton variant={variant}>{submit}</SubmitButton>
        )}
      </div>
    </NoResetForm>
  );
}
