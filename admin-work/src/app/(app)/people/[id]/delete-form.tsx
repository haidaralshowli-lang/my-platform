"use client";

import { useActionState } from "react";
import { Field } from "@/components/ui";
import { ConfirmButton, FormMessage, NoResetForm } from "@/components/client-ui";
import { deletePersonAction } from "../actions";

export function DeletePersonForm({ id }: { id: string }) {
  const [state, action] = useActionState(deletePersonAction.bind(null, id), null);
  return (
    <NoResetForm action={action} className="flex flex-col gap-3">
      <p className="text-sm text-muted">الحذف ناعم: يختفي السجل من القوائم والمؤشرات، ويمكن استعادته لاحقاً.</p>
      <FormMessage state={state} />
      <Field label="سبب الحذف" htmlFor="reason" required>
        <input id="reason" name="reason" className="field-input" maxLength={300} />
      </Field>
      <div>
        <ConfirmButton variant="danger" title="حذف السجل" message="سيُحذف السجل من القوائم والمؤشرات. يمكن استعادته من «السجلات المحذوفة».">
          حذف السجل
        </ConfirmButton>
      </div>
    </NoResetForm>
  );
}
