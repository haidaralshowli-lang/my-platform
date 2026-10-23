"use client";

import { useActionState } from "react";
import { userAdminAction } from "../actions";
import { ConfirmButton, FormMessage } from "@/components/client-ui";

export function UserAdminPanel({ id, active }: { id: string; active: boolean }) {
  const [state, action] = useActionState(userAdminAction, null);
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
      <FormMessage state={state} />
      {state?.ok && state.data?.tempPassword && (
        <div className="rounded-md bg-tone-warning-bg p-3 text-sm text-tone-warning">
          كلمة المرور المؤقتة (تُعرض مرة واحدة):
          <div dir="ltr" className="mt-1 font-mono select-all">{state.data.tempPassword}</div>
        </div>
      )}
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="op" value={active ? "deactivate" : "activate"} />
        <label htmlFor="reason" className="text-xs text-muted">سبب {active ? "التعطيل" : "التفعيل"} (إلزامي)</label>
        <input id="reason" name="reason" required className="field-input" />
        <ConfirmButton variant={active ? "danger" : "primary"} title={active ? "تعطيل الحساب" : "تفعيل الحساب"} message={active ? "سيُمنع المستخدم من الدخول وتُنهى جميع جلساته." : "سيتمكن المستخدم من الدخول مجدداً."}>
          {active ? "تعطيل الحساب" : "تفعيل الحساب"}
        </ConfirmButton>
      </form>
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} />
        <ConfirmButton variant="secondary" name="op" value="reset" title="إعادة تعيين كلمة المرور" message="ستُولَّد كلمة مرور مؤقتة جديدة وتُنهى جميع جلسات المستخدم.">
          إعادة تعيين كلمة المرور
        </ConfirmButton>
        <ConfirmButton variant="secondary" name="op" value="revoke" title="إنهاء الجلسات" message="سيتم تسجيل خروج المستخدم من جميع الأجهزة.">
          إنهاء الجلسات
        </ConfirmButton>
      </form>
    </div>
  );
}
