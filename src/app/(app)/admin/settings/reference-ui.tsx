"use client";

import { useActionState } from "react";
import { addReferenceAction, editReferenceAction } from "./actions";
import { FormMessage, SubmitButton } from "@/components/client-ui";
import { Badge } from "@/components/ui";

type Item = { id: string; nameAr: string; code?: string; description?: string | null; isActive: boolean; extra?: string };

export function ReferenceListEditor({ list, items, hasCode, hasDescription, parents, parentField, parentLabel }: {
  list: string; items: Item[]; hasCode: boolean; hasDescription: boolean;
  parents?: { id: string; nameAr: string }[]; parentField?: "governorateId" | "officeId"; parentLabel?: string;
}) {
  const [addState, add] = useActionState(addReferenceAction, null);
  const [editState, edit] = useActionState(editReferenceAction, null);
  return (
    <div className="flex flex-col gap-4">
      <FormMessage state={editState} />
      <ul className="flex flex-col divide-y divide-line">
        {items.length === 0 && <li className="py-2 text-sm text-muted">لا توجد عناصر.</li>}
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
            <form action={edit} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="hidden" name="list" value={list} />
              <input type="hidden" name="id" value={i.id} />
              <input type="hidden" name="op" value="rename" />
              {i.code && <span dir="ltr" className="font-mono text-xs text-muted">{i.code}</span>}
              <input name="nameAr" defaultValue={i.nameAr} aria-label="الاسم" className="field-input max-w-xs" />
              {hasDescription && <input name="description" defaultValue={i.description ?? ""} placeholder="الوصف" aria-label="الوصف" className="field-input max-w-sm" />}
              {i.extra && <span className="text-xs text-muted">{i.extra}</span>}
              <SubmitButton variant="ghost">حفظ</SubmitButton>
            </form>
            <form action={edit} className="flex items-center gap-2">
              <input type="hidden" name="list" value={list} />
              <input type="hidden" name="id" value={i.id} />
              <input type="hidden" name="op" value="toggle" />
              <input type="hidden" name="isActive" value={String(i.isActive)} />
              {i.isActive ? <Badge tone="success">مفعّل</Badge> : <Badge tone="danger">معطّل</Badge>}
              <SubmitButton variant="secondary">{i.isActive ? "تعطيل" : "تفعيل"}</SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      <form action={add} className="flex flex-wrap items-end gap-2 rounded-md bg-band p-3">
        <input type="hidden" name="list" value={list} />
        {hasCode && <label className="flex flex-col gap-1 text-xs">الرمز<input name="code" dir="ltr" required className="field-input w-28" /></label>}
        <label className="flex flex-col gap-1 text-xs">الاسم<input name="nameAr" required className="field-input w-56" /></label>
        {hasDescription && <label className="flex flex-col gap-1 text-xs">الوصف<input name="description" className="field-input w-64" /></label>}
        {parents && parentField && (
          <label className="flex flex-col gap-1 text-xs">{parentLabel}
            <select name={parentField} required={parentField === "governorateId"} className="field-input w-48">
              <option value="">{parentField === "officeId" ? "جميع المكاتب" : "—"}</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
            </select>
          </label>
        )}
        <SubmitButton>إضافة</SubmitButton>
        <FormMessage state={addState} />
      </form>
    </div>
  );
}
