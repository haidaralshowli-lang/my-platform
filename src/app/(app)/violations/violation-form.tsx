"use client";

import { useActionState, useState } from "react";
import { Field } from "@/components/ui";
import { FormMessage, SubmitButton, NoResetForm } from "@/components/client-ui";
import { saveViolationAction } from "./actions";
import type { ViolationFormOptions } from "./form-data";

export type ViolationFormValues = Partial<Record<
  | "paperReportNumber" | "officialLetterNumber" | "discoveredAt" | "governorateId" | "officeId" | "divisionId" | "violationTypeId"
  | "offenderName" | "entityTypeId" | "offenderLicenseNo" | "activityTypeId" | "offenderAddress" | "latitude" | "longitude"
  | "description" | "detectionSourceId" | "organizerName" | "priority" | "internalNotes",
  string
>>;

type Opt = { id: string; nameAr: string };

function Select({ name, label, options, value, required, error, onChange, hint }: {
  name: string; label: string; options: Opt[]; value?: string; required?: boolean; error?: string[]; onChange?: (v: string) => void; hint?: string;
}) {
  return (
    <Field label={label} htmlFor={name} required={required} error={error} hint={hint}>
      <select id={name} name={name} defaultValue={onChange ? undefined : value ?? ""} value={onChange ? value ?? "" : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined} className="field-input" aria-invalid={!!error}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.nameAr}</option>)}
      </select>
    </Field>
  );
}

export function ViolationForm({ options, initial, id, version, registered }: {
  options: ViolationFormOptions;
  initial?: ViolationFormValues;
  id?: string;
  version?: number;
  /// بعد التسجيل الرسمي يُطلب سبب التعديل
  registered?: boolean;
}) {
  const [state, action] = useActionState(saveViolationAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const [gov, setGov] = useState(initial?.governorateId ?? (options.governorates.length === 1 ? options.governorates[0].id : ""));
  const officesForGov = options.offices.filter((o) => o.governorateId === gov);
  const [office, setOffice] = useState(initial?.officeId ?? (officesForGov.length === 1 ? officesForGov[0].id : ""));
  const divisions = options.divisions.filter((d) => !d.officeId || d.officeId === office);
  const text = (name: keyof ViolationFormValues, label: string, o: { required?: boolean; dir?: "ltr"; hint?: string; type?: string } = {}) => (
    <Field label={label} htmlFor={name} required={o.required} error={fe?.[name]} hint={o.hint}>
      <input id={name} name={name} type={o.type ?? "text"} defaultValue={initial?.[name] ?? ""} dir={o.dir} className={`field-input ${o.dir ? "text-start" : ""}`} aria-invalid={!!fe?.[name]} />
    </Field>
  );

  return (
    <NoResetForm action={action} className="flex flex-col gap-6">
      {id && <input type="hidden" name="id" value={id} />}
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <FormMessage state={state} />
      {options.violationTypes.length === 0 && (
        <p className="rounded-md bg-tone-warning-bg px-3 py-2 text-sm text-tone-warning">
          لم تُعرَّف أنواع المخالفات بعد. يمكن حفظ المسودة، لكن التسجيل الرسمي يتطلب أن يضيف المخول الأنواع من «إعدادات النظام».
        </p>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-base font-semibold text-brand">المراجع والتواريخ</legend>
        {text("paperReportNumber", "رقم المحضر الورقي")}
        {text("officialLetterNumber", "رقم الكتاب الرسمي", { hint: "إن وجد" })}
        {text("discoveredAt", "تاريخ اكتشاف المخالفة", { required: true, type: "date" })}
        <Select name="governorateId" label="المحافظة" required options={options.governorates} value={gov} error={fe?.governorateId}
          onChange={(v) => { setGov(v); setOffice(""); }} />
        <Select name="officeId" label="الفرع أو المكتب" required options={officesForGov} value={office} error={fe?.officeId} onChange={setOffice} />
        <Select name="divisionId" label="الشعبة المختصة" options={divisions} value={initial?.divisionId} error={fe?.divisionId} />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-base font-semibold text-brand">الجهة المخالفة</legend>
        {text("offenderName", "اسم الجهة المخالفة", { required: true })}
        <Select name="entityTypeId" label="نوع الجهة" options={options.entityTypes} value={initial?.entityTypeId} error={fe?.entityTypeId} />
        {text("offenderLicenseNo", "رقم إجازة الجهة", { hint: "إن وجد", dir: "ltr" })}
        <Select name="activityTypeId" label="نوع النشاط الإعلامي أو الاتصالي" options={options.activityTypes} value={initial?.activityTypeId} error={fe?.activityTypeId} />
        <div className="sm:col-span-2">{text("offenderAddress", "عنوان الجهة المخالفة")}</div>
        {text("latitude", "خط العرض", { dir: "ltr", hint: "اختياري، مثل 33.3152" })}
        {text("longitude", "خط الطول", { dir: "ltr", hint: "اختياري، مثل 44.3661" })}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-base font-semibold text-brand">المخالفة</legend>
        <Select name="violationTypeId" label="نوع المخالفة" required options={options.violationTypes} value={initial?.violationTypeId} error={fe?.violationTypeId} />
        <Select name="detectionSourceId" label="مصدر اكتشافها" required options={options.detectionSources} value={initial?.detectionSourceId} error={fe?.detectionSourceId} />
        <Field label="درجة الأولوية" htmlFor="priority" error={fe?.priority}>
          <select id="priority" name="priority" defaultValue={initial?.priority ?? "NORMAL"} className="field-input">
            <option value="LOW">منخفضة</option><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="URGENT">عاجلة</option>
          </select>
        </Field>
        <Field label="وصف المخالفة" htmlFor="description" required error={fe?.description} className="sm:col-span-2 lg:col-span-3">
          <textarea id="description" name="description" rows={5} defaultValue={initial?.description ?? ""} className="field-input" />
        </Field>
        {text("organizerName", "اسم الموظف المنظم للمحضر", { required: true })}
        <Field label="ملاحظات داخلية" htmlFor="internalNotes" error={fe?.internalNotes} className="sm:col-span-2" hint="لا تظهر في الإنذارات أو المراسلات الخارجية">
          <textarea id="internalNotes" name="internalNotes" rows={2} defaultValue={initial?.internalNotes ?? ""} className="field-input" />
        </Field>
      </fieldset>
      <p className="text-xs text-muted">الحقول المعلَّمة (*) إلزامية للتسجيل الرسمي. يمكن حفظ المسودة واستكمالها لاحقاً. ربط المواد التنظيمية المحتملة يتاح من صفحة المخالفة بعد تفعيل المكتبة القانونية (الجزء الثالث).</p>

      {registered && (
        <Field label="سبب التعديل" htmlFor="editReason" required hint="المخالفة مسجلة رسمياً؛ يُحفظ سبب التعديل والقيم السابقة في سجل التدقيق">
          <input id="editReason" name="editReason" className="field-input" />
        </Field>
      )}
      <div className="flex gap-2">
        <SubmitButton>{id ? "حفظ التعديلات" : "حفظ المسودة"}</SubmitButton>
      </div>
    </NoResetForm>
  );
}
