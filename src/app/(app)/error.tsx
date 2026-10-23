"use client";

import { buttonClass } from "@/components/ui";

/// صفحة خطأ عامة: لا تعرض أي تفاصيل داخلية للمستخدم
export default function AppErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-line bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-bold text-brand">تعذر إكمال الطلب</h1>
      <p className="mt-3 text-sm text-muted">حدث خطأ غير متوقع. يرجى المحاولة مجدداً، وإذا تكرر الخطأ راجع مدير النظام.</p>
      <button type="button" onClick={reset} className={`${buttonClass("primary")} mt-6`}>إعادة المحاولة</button>
    </div>
  );
}
