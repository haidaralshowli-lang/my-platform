"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Alert, DataTable } from "@/components/ui";
import { NoResetForm, SubmitButton } from "@/components/client-ui";
import { importAction, type ImportState } from "../actions";

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importAction, null);
  const [hasFile, setHasFile] = useState(false);
  const preview = state?.ok ? state.preview : null;

  return (
    <div className="flex flex-col gap-4">
      <NoResetForm action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            ملف Excel ‏(.xlsx، حتى 5 ميغابايت و5000 صف)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="field-input file:me-3 file:rounded file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-brand"
            onChange={(e) => setHasFile(!!e.target.files?.length)}
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="allowNameMatches" className="mt-0.5 h-4 w-4 accent-brand" />
          <span>استيراد الصفوف التي تطابق أسماؤها سجلات موجودة أيضاً (بعد التأكد أنهم أشخاص مختلفون). الأرقام المكررة تُرفض دائماً.</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant="secondary" name="mode" value="preview" pendingText="جارٍ التنفيذ…">
            معاينة وفحص الملف
          </SubmitButton>
          {preview && state?.ok && state.mode === "preview" && preview.ok > 0 && hasFile && (
            <SubmitButton name="mode" value="commit" pendingText="جارٍ الاستيراد…">
              استيراد {preview.ok} صفاً سليماً
            </SubmitButton>
          )}
        </div>
      </NoResetForm>

      {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
      {state?.ok && state.mode === "commit" && (
        <Alert tone="success">
          تم استيراد <span className="ltr-num">{state.created}</span> سجلاً.{" "}
          <Link href="/people?sort=createdAt" className="underline">
            عرض السجلات
          </Link>
        </Alert>
      )}
      {preview && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-md bg-band p-3">
              صفوف الملف: <b className="ltr-num">{preview.fileRows}</b>
            </div>
            <div className="rounded-md bg-tone-success-bg p-3 text-tone-success">
              سليمة: <b className="ltr-num">{preview.ok}</b>
            </div>
            <div className="rounded-md bg-tone-danger-bg p-3 text-tone-danger">
              فيها أخطاء: <b className="ltr-num">{preview.errors}</b>
            </div>
            <div className="rounded-md bg-tone-warning-bg p-3 text-tone-warning">
              أسماء مطابقة لسجلات قائمة: <b className="ltr-num">{preview.nameMatches}</b>
            </div>
          </div>
          {preview.rows.length > 0 && (
            <DataTable>
              <thead>
                <tr>
                  <th>الصف</th>
                  <th>الاسم</th>
                  <th>الحالة</th>
                  <th>الملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="ltr-num">{r.row}</td>
                    <td>{r.fullName || "—"}</td>
                    <td className="whitespace-nowrap">{r.status === "error" ? "لن يُستورد" : r.status === "name_match" ? "يحتاج تأكيداً" : "سيُستورد"}</td>
                    <td className="text-xs">{r.messages.join("؛ ")}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
      )}
    </div>
  );
}
