"use client";

import { useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cn, type ButtonVariant } from "./ui";

/// زر إرسال يُعطَّل أثناء المعالجة لمنع الإرسال المزدوج
export function SubmitButton({ children, variant = "primary", pendingText = "جارٍ التنفيذ…", className, name, value }: {
  children: ReactNode;
  variant?: ButtonVariant;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={cn(buttonClass(variant), className)}>
      {pending ? pendingText : children}
    </button>
  );
}

/// زر لإجراء حساس: يفتح نافذة تأكيد قبل إرسال النموذج الذي يحتويه
export function ConfirmButton({ children, title, message, confirmText = "تأكيد", variant = "primary", name, value }: {
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmText?: string;
  variant?: ButtonVariant;
  name?: string;
  value?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { pending } = useFormStatus();
  return (
    <>
      <button type="button" disabled={pending} className={buttonClass(variant)} onClick={() => ref.current?.showModal()}>
        {pending ? "جارٍ التنفيذ…" : children}
      </button>
      <dialog ref={ref} className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line p-0 shadow-xl backdrop:bg-black/40">
        <div className="p-5">
          <h3 className="text-base font-semibold text-brand">{title}</h3>
          <div className="mt-2 text-sm text-muted">{message}</div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-band px-5 py-3">
          <button type="button" className={buttonClass("secondary")} onClick={() => ref.current?.close()}>
            إلغاء
          </button>
          <button
            type="submit"
            name={name}
            value={value}
            className={buttonClass(variant)}
            onClick={() => ref.current?.close()}
          >
            {confirmText}
          </button>
        </div>
      </dialog>
    </>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; error?: string; message?: string } | null | undefined }) {
  if (!state) return null;
  if (state.ok) return state.message ? <p role="status" className="rounded-md bg-tone-success-bg px-3 py-2 text-sm text-tone-success">{state.message}</p> : null;
  return <p role="alert" className="rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{state.error}</p>;
}
