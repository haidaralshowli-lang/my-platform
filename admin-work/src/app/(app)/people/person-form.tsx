"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import type { SimilarPerson } from "@/lib/services/people";
import { Field } from "@/components/ui";
import { FormMessage, NoResetForm, SubmitButton } from "@/components/client-ui";
import { similarAction } from "./actions";

type Option = { id: string | number; name: string };

export type PersonFormValues = {
  fullName: string;
  phone: string | null;
  regionId: number | null;
  followUpOwnerId: string | null;
  engagementLevel: string;
  availableForWork: boolean;
  needsUpdate: boolean;
  notes: string | null;
};

const ENGAGEMENT_OPTIONS = [
  { v: "NONE", l: "غير متفاعل" },
  { v: "LOW", l: "منخفض" },
  { v: "MEDIUM", l: "متوسط" },
  { v: "HIGH", l: "مرتفع" },
];

export function PersonForm({
  action,
  regions,
  owners,
  initial,
  personId,
  submitLabel,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  regions: Option[];
  owners: Option[];
  initial?: PersonFormValues;
  personId?: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const [similar, setSimilar] = useState<SimilarPerson[]>([]);
  const [checking, startCheck] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChecked = useRef(initial?.fullName ?? "");

  const check = (name: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const n = name.trim();
      if (n === lastChecked.current) return;
      lastChecked.current = n;
      if (n.length < 3) return setSimilar([]);
      startCheck(async () => setSimilar(await similarAction(n, personId)));
    }, 450);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const exact = similar.some((s) => s.score >= 0.999);
  const showConfirm = exact || (state && !state.ok && /بالاسم نفسه/.test(state.error));

  return (
    <NoResetForm action={formAction} className="flex flex-col gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="الاسم الكامل" htmlFor="fullName" required error={fe?.fullName}>
          <input id="fullName" name="fullName" defaultValue={initial?.fullName} className="field-input" required maxLength={150} autoComplete="off" onChange={(e) => check(e.target.value)} />
        </Field>
        <Field label="رقم الهاتف" htmlFor="phone" hint="اختياري. رقم عراقي يبدأ بـ 07" error={fe?.phone}>
          <input id="phone" name="phone" defaultValue={initial?.phone ?? ""} dir="ltr" inputMode="tel" className="field-input text-start" maxLength={20} />
        </Field>
      </div>

      {(similar.length > 0 || checking) && (
        <div role="status" className="rounded-md border border-tone-warning/30 bg-tone-warning-bg p-3 text-sm text-tone-warning">
          {checking && similar.length === 0 ? (
            "جارٍ البحث عن أسماء متشابهة…"
          ) : (
            <>
              <p className="font-semibold">{exact ? "يوجد سجل بالاسم نفسه:" : "أسماء متشابهة موجودة. تأكد أنك لا تكرر سجلاً قائماً:"}</p>
              <ul className="mt-1.5 space-y-1">
                {similar.map((s) => (
                  <li key={s.id}>
                    <Link href={`/people/${s.id}`} target="_blank" className="underline">
                      <span className="ltr-num">#{s.serial}</span> {s.fullName}
                    </Link>
                    <span className="text-xs">
                      {" "}— {s.regionName ?? "دون محافظة"}
                      {s.phone && <span className="ltr-num"> · {s.phone}</span>} · تشابه <span className="ltr-num">{Math.round(s.score * 100)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {showConfirm && (
        <label className="flex items-start gap-2 rounded-md border border-line bg-band p-3 text-sm">
          <input type="checkbox" name="confirmDistinct" className="mt-0.5 h-4 w-4 accent-brand" />
          <span>راجعتُ السجل الموجود، وأؤكد أن هذا شخص مختلف يحمل الاسم نفسه.</span>
        </label>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="المحافظة أو المنطقة" htmlFor="regionId">
          <select id="regionId" name="regionId" defaultValue={initial?.regionId ?? ""} className="field-input">
            <option value="">— غير محددة —</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مسؤول المتابعة" htmlFor="followUpOwnerId">
          <select id="followUpOwnerId" name="followUpOwnerId" defaultValue={initial?.followUpOwnerId ?? ""} className="field-input">
            <option value="">— غير محدد —</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="مستوى التفاعل الإداري" htmlFor="engagementLevel">
          <select id="engagementLevel" name="engagementLevel" defaultValue={initial?.engagementLevel ?? "NONE"} className="field-input">
            {ENGAGEMENT_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="availableForWork" defaultChecked={initial?.availableForWork} className="h-4 w-4 accent-brand" />
          متاح للتعاون الإداري
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="needsUpdate" defaultChecked={initial?.needsUpdate} className="h-4 w-4 accent-brand" />
          بيانات السجل بانتظار التحديث
        </label>
      </div>

      <Field label="ملاحظات إدارية" htmlFor="notes" hint="معلومات إدارية غير حساسة فقط. لا تُسجَّل آراء أو انتماءات أو تفضيلات." error={fe?.notes}>
        <textarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} rows={3} maxLength={1000} className="field-input" />
      </Field>

      <p className="text-xs text-muted">تُحتسب حالة البيانات تلقائياً: يكتمل السجل بتحديد المحافظة/المنطقة ومسؤول المتابعة، ما لم يُعلَّم «بانتظار التحديث».</p>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </NoResetForm>
  );
}
