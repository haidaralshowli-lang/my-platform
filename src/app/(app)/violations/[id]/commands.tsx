"use client";

import { useActionState } from "react";
import { violationCommandAction } from "../actions";
import { ConfirmButton, FormMessage, NoResetForm } from "@/components/client-ui";

const OPS: Record<string, { op: string; message: string }> = {
  register: { op: "register", message: "سيولّد النظام الرقم الرسمي للمخالفة. لا يمكن التراجع عن التسجيل الرسمي." },
  submit_for_approval: { op: "submit", message: "ستُحال المعاملة إلى رئيس الهيئة للمصادقة النهائية، وتُعتمد مرفقاتها، ولن يمكن تعديل بياناتها الأساسية بعد ذلك." },
};

export function ViolationCommands({ id, version, transitions, canArchive, hasReport }: {
  id: string; version: number; transitions: { action: string; label: string }[]; canArchive: boolean; hasReport: boolean;
}) {
  const [state, action] = useActionState(violationCommandAction, null);
  return (
    <div className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-3">
        {transitions.filter((t) => OPS[t.action]).map((t) => (
          <NoResetForm key={t.action} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="op" value={OPS[t.action].op} />
            <ConfirmButton title={t.label} message={OPS[t.action].message}>{t.label}</ConfirmButton>
          </NoResetForm>
        ))}
        {canArchive && (
          <NoResetForm action={action} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="op" value="archive" />
            <label className="flex flex-col gap-1 text-xs text-muted">
              سبب أرشفة المسودة
              <input name="reason" required className="field-input w-56" />
            </label>
            <ConfirmButton variant="danger" title="أرشفة المسودة" message="ستُخفى المسودة من القوائم مع بقائها محفوظة في قاعدة البيانات وسجل التدقيق.">أرشفة المسودة</ConfirmButton>
          </NoResetForm>
        )}
      </div>
      {transitions.some((t) => t.action === "submit_for_approval") && !hasReport && (
        <p className="text-xs text-tone-warning">الإحالة للمصادقة تتطلب رفع المحضر الأصلي أولاً.</p>
      )}
    </div>
  );
}
