"use client";

import { useActionState } from "react";
import { setRolePermissionsAction } from "../users/actions";
import { ConfirmButton, FormMessage } from "@/components/client-ui";

export function RolePermissionsForm({ roleId, groups, selected, disabledCodes, readOnly }: {
  roleId: string;
  groups: [string, { code: string; nameAr: string }[]][];
  selected: string[];
  disabledCodes: string[];
  readOnly: boolean;
}) {
  const [state, action] = useActionState(setRolePermissionsAction, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="roleId" value={roleId} />
      <FormMessage state={state} />
      {readOnly && <p className="text-xs text-tone-warning">لا يمكنك تعديل صلاحيات دور تحمله.</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map(([g, ps]) => (
          <fieldset key={g} className="rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-brand">{g}</legend>
            {ps.map((p) => (
              <label key={p.code} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" name="perm" value={p.code} defaultChecked={selected.includes(p.code)} disabled={readOnly || disabledCodes.includes(p.code)} />
                {p.nameAr}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {!readOnly && (
        <div>
          <ConfirmButton title="حفظ صلاحيات الدور" message="سيُطبَّق التغيير فوراً على جميع المستخدمين الذين يحملون هذا الدور، ويُسجَّل في سجل التدقيق.">حفظ الصلاحيات</ConfirmButton>
        </div>
      )}
    </form>
  );
}
