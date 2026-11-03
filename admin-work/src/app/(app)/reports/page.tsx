import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/server";
import { REPORT_KEYS, REPORTS } from "@/lib/services/reports";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "التقارير" };

const PERIOD_HINT = { none: "حتى تاريخ الإعداد", optional: "فترة اختيارية", range: "فترة من تاريخ إلى تاريخ (افتراضياً آخر 30 يوماً)", week: "آخر 7 أيام", month: "شهر كامل" } as const;

export default async function ReportsPage() {
  await requirePagePermission("reports.view");
  return (
    <>
      <PageHeader title="التقارير الإدارية" description="تقارير قابلة للطباعة والتصدير إلى PDF وExcel، يتضمن كل منها الفترة الزمنية وتاريخ الإعداد والإحصائيات." />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {REPORT_KEYS.map((k, i) => (
          <li key={k}>
            <Link href={`/reports/${k}`} className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
              <span className="flex items-center gap-2 text-brand">
                <FileBarChart className="h-5 w-5 shrink-0" aria-hidden />
                <span className="font-semibold">
                  <span className="ltr-num">{i + 1}.</span> {REPORTS[k].title}
                </span>
              </span>
              <span className="mt-2 flex-1 text-sm text-muted">{REPORTS[k].description}</span>
              <span className="mt-3 text-xs text-accent">{PERIOD_HINT[REPORTS[k].period]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
