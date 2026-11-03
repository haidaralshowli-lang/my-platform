"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormMessage, NoResetForm, SubmitButton } from "@/components/client-ui";
import type { ListItem, ListKind } from "@/lib/services/lists";
import { addItemAction, updateItemAction, updateSettingAction } from "./actions";

export function AddItemForm({ kind }: { kind: ListKind }) {
  const [state, action] = useActionState(addItemAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <NoResetForm action={action} className="flex flex-col gap-2" ref={ref}>
      <FormMessage state={state} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-2">
        <label htmlFor={`new-${kind}`} className="sr-only">
          اسم العنصر الجديد
        </label>
        <input id={`new-${kind}`} name="name" placeholder="اسم جديد" className="field-input" required />
        <SubmitButton>إضافة</SubmitButton>
      </div>
    </NoResetForm>
  );
}

export function ItemRow({ kind, item }: { kind: ListKind; item: ListItem }) {
  const [state, action] = useActionState(updateItemAction, null);
  return (
    <li className="py-2">
      <NoResetForm action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={item.id} />
        <label htmlFor={`${kind}-${item.id}`} className="sr-only">
          الاسم
        </label>
        <input id={`${kind}-${item.id}`} name="name" defaultValue={item.name} className="field-input min-w-0 flex-1" />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={item.isActive} className="h-4 w-4 accent-brand" />
          مفعّل
        </label>
        <SubmitButton variant="secondary" pendingText="…">
          حفظ
        </SubmitButton>
      </NoResetForm>
      {state && !state.ok && <div className="mt-1"><FormMessage state={state} /></div>}
    </li>
  );
}

export function SettingForm({ settingKey, label, value, min, max }: { settingKey: string; label: string; value: number; min: number; max: number }) {
  const [state, action] = useActionState(updateSettingAction, null);
  const id = `setting-${settingKey}`;
  return (
    <NoResetForm action={action} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input type="hidden" name="key" value={settingKey} />
      <div className="flex gap-2">
        <input id={id} name="value" type="number" min={min} max={max} defaultValue={value} className="field-input ltr-num w-32" required />
        <SubmitButton variant="secondary" pendingText="…">
          حفظ
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </NoResetForm>
  );
}
