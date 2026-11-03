"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/errors";
import { buttonClass } from "@/components/ui";
import { distinctAction, mergeAction, restorePersonAction } from "./actions";

/// زر إجراء مع تأكيد بسيط ورسالة نتيجة، يُحدّث الصفحة بعد النجاح
function ActionButton({ label, confirm, run, variant = "secondary" }: { label: string; confirm: string; run: () => Promise<ActionResult>; variant?: "primary" | "secondary" | "danger" }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={buttonClass(variant, "sm")}
        onClick={() => {
          if (!window.confirm(confirm)) return;
          start(async () => {
            const r = await run();
            setMsg(r);
            if (r.ok) router.refresh();
          });
        }}
      >
        {pending ? "جارٍ التنفيذ…" : label}
      </button>
      {msg && !msg.ok && <span role="alert" className="text-xs text-tone-danger">{msg.error}</span>}
    </span>
  );
}

export function PairActions({ a, b, aSerial, bSerial, canMerge, canEdit }: { a: string; b: string; aSerial: number; bSerial: number; canMerge: boolean; canEdit: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {canMerge && (
        <>
          <ActionButton label={`دمج مع الإبقاء على ${aSerial}`} variant="primary" confirm={`سيُدمج السجل ${bSerial} في السجل ${aSerial}، وتُنقل إليه المهام والطلبات المرتبطة، ويُحذف ${bSerial}. متابعة؟`} run={() => mergeAction(a, b)} />
          <ActionButton label={`دمج مع الإبقاء على ${bSerial}`} variant="primary" confirm={`سيُدمج السجل ${aSerial} في السجل ${bSerial}، وتُنقل إليه المهام والطلبات المرتبطة، ويُحذف ${aSerial}. متابعة؟`} run={() => mergeAction(b, a)} />
        </>
      )}
      {canEdit && <ActionButton label="شخصان مختلفان" confirm="تأكيد أن السجلين لشخصين مختلفين؟ لن يظهر هذا الزوج مجدداً." run={() => distinctAction(a, b)} />}
    </div>
  );
}

export function RestoreButton({ id, run }: { id: string; run?: (id: string) => Promise<ActionResult> }) {
  return <ActionButton label="استعادة" confirm="استعادة هذا السجل إلى القوائم؟" run={() => (run ?? restorePersonAction)(id)} />;
}
