"use client";

import { useState, useTransition } from "react";
import { verifyChainAction } from "./actions";
import { buttonClass } from "@/components/ui";

export function VerifyChain() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<Awaited<ReturnType<typeof verifyChainAction>> | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div><button type="button" disabled={pending} className={buttonClass("secondary")} onClick={() => start(async () => setR(await verifyChainAction()))}>{pending ? "جارٍ التحقق…" : "التحقق من سلامة السجل"}</button></div>
      {r && !r.ok && <p role="alert" className="text-sm text-tone-danger">{r.error}</p>}
      {r?.ok && r.data && (
        r.data.ok ? (
          <div role="status" className="rounded-md bg-tone-success-bg p-3 text-sm text-tone-success">
            السلسلة سليمة: تحقق من {r.data.checked} قيداً دون أي تعديل أو حذف.
            <div className="mt-1 text-xs">بصمة آخر قيد (احفظها في موقع منفصل للمقارنة لاحقاً): <code dir="ltr" className="break-all select-all">{r.data.lastHash}</code></div>
          </div>
        ) : (
          <div role="alert" className="rounded-md bg-tone-danger-bg p-3 text-sm text-tone-danger">تحذير: انكسرت سلسلة التجزئة عند القيد رقم {r.data.brokenAt}. يدل ذلك على تعديل أو حذف خارج المنصة. يجب إبلاغ المسؤول الأمني.</div>
        )
      )}
    </div>
  );
}
