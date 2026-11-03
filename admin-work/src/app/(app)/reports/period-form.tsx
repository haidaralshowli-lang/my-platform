import { todayStr } from "@/lib/dates";
import type { Period, ReportKey } from "@/lib/services/reports";
import { REPORTS } from "@/lib/services/reports";

/// نموذج الفترة حسب نوع التقرير (نطاق تاريخين، أسبوع ينتهي بتاريخ، أو شهر)
export function PeriodForm({ reportKey, period, action }: { reportKey: ReportKey; period: Period | null; action: string }) {
  const mode = REPORTS[reportKey].period;
  if (mode === "none") return <p className="text-sm text-muted">هذا التقرير يعكس الحالة الحالية لقاعدة البيانات حتى تاريخ إعداده.</p>;
  const t = todayStr();
  return (
    <form method="get" action={action} className="no-print flex flex-wrap items-end gap-3">
      {mode === "month" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${reportKey}-month`} className="text-sm font-medium">
            الشهر
          </label>
          <input id={`${reportKey}-month`} name="month" type="month" max={t.slice(0, 7)} defaultValue={period?.from.slice(0, 7) ?? t.slice(0, 7)} className="field-input ltr-num w-44" />
        </div>
      )}
      {mode === "week" && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${reportKey}-to`} className="text-sm font-medium">
            الأيام السبعة المنتهية في
          </label>
          <input id={`${reportKey}-to`} name="to" type="date" max={t} defaultValue={period?.to ?? t} className="field-input ltr-num w-44" />
        </div>
      )}
      {(mode === "range" || mode === "optional") && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${reportKey}-from`} className="text-sm font-medium">
              من
            </label>
            <input id={`${reportKey}-from`} name="from" type="date" max={t} defaultValue={period?.from} className="field-input ltr-num w-44" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${reportKey}-to`} className="text-sm font-medium">
              إلى
            </label>
            <input id={`${reportKey}-to`} name="to" type="date" max={t} defaultValue={period?.to} className="field-input ltr-num w-44" />
          </div>
        </>
      )}
      <button type="submit" className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
        إعداد التقرير
      </button>
      {mode === "optional" && <span className="text-xs text-muted">الفترة اختيارية: تحدد عدد السجلات المضافة خلالها.</span>}
    </form>
  );
}
